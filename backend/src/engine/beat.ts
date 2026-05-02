// processBeat(state) → state. The single state-mutating step the runner calls.
// This is intentionally written so a future pause system can yield between
// processBeat calls — there's no closure over mutable data, no globals.

import { SIM_CONSTANTS } from '~/consts/engine'
import { individualBrillianceTriggers, resolveChance } from '~/engine/resolution/goals'
import { foulProbability, resolveFoul, rollFoulInjury, rollPassiveInjury } from '~/engine/resolution/fouls'
import { adjustMomentumForHome, decayMomentum } from '~/engine/mechanics/momentum'
import { pickAttackingSide } from '~/engine/mechanics/possession'
import { adjustRating } from '~/engine/mechanics/ratings'
import type { RNG } from '~/lib/rng'
import { classifySetPiece, resolveSetPiece, type SetPieceResolution } from '~/engine/resolution/setPieces'
import { applyBeatStaminaDrain, applyGoalStaminaBoost } from '~/engine/mechanics/stamina'
import { tryAutoSub } from '~/engine/mechanics/subs'
import { sigmoid } from '~/engine/stats'
import type {
  BeatResult,
  ChanceDetail,
  FoulDetail,
  MatchState,
  Outcome,
  PlayerMatchState,
  Side,
  Squad,
  Zone
} from '~/types'
import { buildMatchup, pickZone, scoreMatchup } from '~/engine/zones'

// Look up a player's live match state by card id and side.
function getStateById(state: MatchState, side: Side, cardId: string): PlayerMatchState | undefined {
  const list = side === 'home' ? state.players.home : state.players.away
  return list.find((p) => p.cardId === cardId)
}

// Find the live state of whichever player is in slot 0 (GK) of the given
// side. Resilient to subs — if a backup GK has been brought on, this
// returns them instead of the original starter.
function findGkState(state: MatchState, side: Side): PlayerMatchState | undefined {
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const states = side === 'home' ? state.players.home : state.players.away
  const slot = squad.lineup.find((l) => l.slot === 0)
  if (!slot) return undefined
  return states.find((p) => p.cardId === slot.cardId)
}

// Identify which side a card belongs to.
function findCardSide(state: MatchState, cardId: string): Side | null {
  if (state.homeSquad.cards.some((c) => c.id === cardId)) return 'home'
  if (state.awaySquad.cards.some((c) => c.id === cardId)) return 'away'
  return null
}

// Run one beat of the match. Pure-ish: takes state in, returns the
// (mutated) state out with one new event appended. The caller-supplied
// RNG is the only source of randomness.
export function processBeat(state: MatchState, rng: RNG): MatchState {
  state.beat += 1

  // Advance the clock by 2 minutes (fixed at 2 by default).
  const minutesAdvanced = SIM_CONSTANTS.BEAT_MIN_MINUTES + Math.floor(rng.next() * (SIM_CONSTANTS.BEAT_MAX_MINUTES - SIM_CONSTANTS.BEAT_MIN_MINUTES + 1))
  state.minute = Math.min(120, state.minute + minutesAdvanced)

  // Step 1 — possession.
  const attackingSide = pickAttackingSide(state, rng.next())
  const defendingSide: Side = attackingSide === 'home' ? 'away' : 'home'
  const atkTactics = attackingSide === 'home' ? state.homeTactics : state.awayTactics
  const defTactics = attackingSide === 'home' ? state.awayTactics : state.homeTactics

  // Step 2 — zone.
  const zone = pickZone(atkTactics, defTactics, state.config.weather, rng)
  const matchup = buildMatchup(state, attackingSide, zone)
  const scores = scoreMatchup(matchup, state.config.weather)

  // Step 3 — beat outcome. Convert delta → probability via sigmoid,
  // then bucket by roll into chance / buildup / nothing. Attacking-
  // mentality teams get a flat threshold bonus when they're in possession
  // — payoff for the costs they pay defensively.
  const chanceProb = sigmoid(scores.delta / SIM_CONSTANTS.SCALE_FACTOR)
  const chanceThreshold =
    SIM_CONSTANTS.CHANCE_THRESHOLD +
    (atkTactics.mentality === 'attacking' ? SIM_CONSTANTS.ATTACKING_CHANCE_THRESHOLD_BONUS : 0)
  let outcome: Outcome = 'nothing'
  const roll = rng.next()
  if (roll < chanceProb * chanceThreshold) outcome = 'chance'
  else if (roll < chanceProb * SIM_CONSTANTS.BUILDUP_THRESHOLD) outcome = 'buildup'

  // Individual brilliance — small bonus chance to upgrade to chance.
  if (outcome !== 'chance' && individualBrillianceTriggers(matchup) && rng.chance(SIM_CONSTANTS.INDIVIDUAL_BRILLIANCE_CHANCE)) {
    outcome = 'chance'
  }

  // Step 4 — chance resolution.
  let chanceDetail: ChanceDetail | undefined
  let goalScored = false
  let isSave = false

  if (outcome === 'chance') {
    const cd = resolveChance(state, attackingSide, matchup, scores.delta, rng)
    if (!cd) {
      // Empty matchup — downgrade to nothing.
      outcome = 'nothing'
    } else {
      chanceDetail = cd
      if (chanceDetail.goal) {
        goalScored = true
        if (attackingSide === 'home') state.score.home += 1
        else state.score.away += 1
      }
      if (chanceDetail.onTarget && !chanceDetail.goal) isSave = true
    }
  }

  // Step 5 — corners (from saves and buildups, only if no goal).
  let cornerTaken = false
  if (!goalScored) {
    const cornerProb = isSave ? SIM_CONSTANTS.CORNER_AFTER_SAVE : outcome === 'buildup' ? SIM_CONSTANTS.CORNER_AFTER_BUILDUP : 0
    if (cornerProb > 0 && rng.chance(cornerProb)) {
      cornerTaken = true
      const cornerRes = resolveSetPiece('corner', state, attackingSide, matchup, rng)
      if (cornerRes.goal) {
        goalScored = true
        if (attackingSide === 'home') state.score.home += 1
        else state.score.away += 1
        // Promote outcome to chance with the corner result.
        chanceDetail = {
          quality: 'half_chance',
          shooter: cornerRes.shooterId ?? matchup.attackers[0]?.id ?? '',
          onTarget: true,
          saved: false,
          goal: true
        }
        outcome = 'chance'
      }
    }
  }

  // Step 6 — foul check (independent of beat outcome).
  const isTacticalFoul = outcome === 'chance' || outcome === 'buildup'
  const fp = foulProbability({
    matchup,
    defenderTeamMentality: defTactics.mentality
  })
  let foulDetail: FoulDetail | undefined
  if (rng.chance(fp)) {
    const foulOutcome = resolveFoul(matchup, state.config.refereeStrictness, isTacticalFoul, rng)
    if (foulOutcome) {
      const injured = rollFoulInjury(foulOutcome.victim, foulOutcome.victimState, state.config.weather, rng)
      if (injured) {
        foulOutcome.victimState.isInjured = true
        foulOutcome.victimState.isOnPitch = false
        const victimSide = findCardSide(state, foulOutcome.victim.id)
        if (victimSide) tryAutoSub(state, victimSide, foulOutcome.victim.id)
      }
      foulOutcome.foulerState.foulsCommitted += 1
      adjustRating(foulOutcome.foulerState, SIM_CONSTANTS.RATING_FOUL)
      if (foulOutcome.card === 'yellow') adjustRating(foulOutcome.foulerState, SIM_CONSTANTS.RATING_YELLOW)
      if (foulOutcome.card === 'red' || foulOutcome.card === 'second_yellow')
        adjustRating(foulOutcome.foulerState, SIM_CONSTANTS.RATING_RED)

      foulDetail = {
        fouler: foulOutcome.fouler.id,
        victim: foulOutcome.victim.id,
        card: foulOutcome.card,
        injury: injured
      }

      // If the beat was otherwise "nothing", mark its outcome as foul.
      if (outcome === 'nothing') outcome = 'foul'

      // Set piece resolution. If a goal results we bump score and chance detail.
      if (!goalScored) {
        const sp = classifySetPiece(matchup.zone, rng)
        if (sp) {
          const spRes = resolveSetPiece(sp, state, attackingSide, matchup, rng)
          foulDetail.setPiece = sp
          foulDetail.setPieceResult = { goal: spRes.goal, shooterId: spRes.shooterId, attempted: spRes.attempted }
          if (spRes.goal) {
            goalScored = true
            if (attackingSide === 'home') state.score.home += 1
            else state.score.away += 1
            // Track shooter goal.
            if (spRes.shooterId) {
              const shooterPS = getStateById(state, attackingSide, spRes.shooterId)
              if (shooterPS) {
                shooterPS.goals += 1
                adjustRating(shooterPS, SIM_CONSTANTS.RATING_GOAL)
              }
            }
          }
        }
      }
    }
  }

  // Step 7 — passive injury check. Roll ONE candidate per beat across both
  // teams (any on-pitch player) to keep the rate aligned with the spec's
  // target of ~1 injury every 5–8 matches.
  let passiveInjury: string | undefined
  if (!foulDetail?.injury) {
    const candidates: { ps: PlayerMatchState; side: Side }[] = []
    for (const ps of state.players.home) {
      if (ps.isOnPitch && !ps.isInjured) candidates.push({ ps, side: 'home' })
    }
    for (const ps of state.players.away) {
      if (ps.isOnPitch && !ps.isInjured) candidates.push({ ps, side: 'away' })
    }
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(rng.next() * candidates.length)]
      const squad = pick.side === 'home' ? state.homeSquad : state.awaySquad
      const card = squad.cards.find((c) => c.id === pick.ps.cardId)!
      if (rollPassiveInjury(card, pick.ps, state.config.weather, rng)) {
        pick.ps.isInjured = true
        pick.ps.isOnPitch = false
        tryAutoSub(state, pick.side, pick.ps.cardId)
        if (!foulDetail) {
          // No foul this beat — fold the injury into a synthetic foulDetail
          // so the existing event shape carries it.
          outcome = outcome === 'nothing' ? 'foul' : outcome
          foulDetail = {
            fouler: '',
            victim: pick.ps.cardId,
            injury: true
          }
        } else {
          // A foul already exists for someone else — surface this injury via
          // the dedicated passiveInjury field so it isn't silently swallowed.
          passiveInjury = pick.ps.cardId
        }
      }
    }
  }

  // Step 8 — apply ratings, momentum, stamina, attribution.
  // Track who was actively involved so stamina drain can hit them harder.
  const involvedHomeIds = new Set<string>()
  const involvedAwayIds = new Set<string>()
  if (attackingSide === 'home') {
    matchup.attackers.forEach((c) => involvedHomeIds.add(c.id))
    matchup.defenders.forEach((c) => involvedAwayIds.add(c.id))
  } else {
    matchup.attackers.forEach((c) => involvedAwayIds.add(c.id))
    matchup.defenders.forEach((c) => involvedHomeIds.add(c.id))
  }

  // Attribute goals, assists, and consequent rating swings.
  if (chanceDetail?.goal) {
    const shooterPS = getStateById(state, attackingSide, chanceDetail.shooter)
    if (shooterPS) {
      shooterPS.goals += 1
      adjustRating(shooterPS, SIM_CONSTANTS.RATING_GOAL)
    }
    if (chanceDetail.assister) {
      const assisterPS = getStateById(state, attackingSide, chanceDetail.assister)
      if (assisterPS) {
        assisterPS.assists += 1
        adjustRating(assisterPS, SIM_CONSTANTS.RATING_ASSIST)
      }
    }
    // Concede ratings for defenders + GK.
    const defSquad = defendingSide === 'home' ? state.homeSquad : state.awaySquad
    const defStates = defendingSide === 'home' ? state.players.home : state.players.away
    for (const slot of [0, 1, 2, 3, 4]) {
      const slotInfo = defSquad.lineup.find((l) => l.slot === slot)
      if (!slotInfo) continue
      const ps = defStates.find((p) => p.cardId === slotInfo.cardId)
      if (ps && ps.isOnPitch) adjustRating(ps, SIM_CONSTANTS.RATING_GOAL_CONCEDED)
    }
  } else if (outcome === 'chance') {
    // Chance created (no goal): shooter gets key-pass-equivalent bump,
    // assister gets it too if present.
    const shooterPS = getStateById(state, attackingSide, chanceDetail!.shooter)
    if (shooterPS) adjustRating(shooterPS, SIM_CONSTANTS.RATING_KEY_PASS)
    if (chanceDetail?.assister) {
      const assisterPS = getStateById(state, attackingSide, chanceDetail.assister)
      if (assisterPS) adjustRating(assisterPS, SIM_CONSTANTS.RATING_KEY_PASS)
    }
    // GK bonus for shots saved (on target, no goal).
    if (chanceDetail?.saved) {
      const gkPS = findGkState(state, defendingSide)
      if (gkPS && gkPS.isOnPitch) adjustRating(gkPS, SIM_CONSTANTS.RATING_SAVE)
    }
  } else if (outcome === 'buildup') {
    for (const c of matchup.attackers) {
      const ps = getStateById(state, attackingSide, c.id)
      if (ps) adjustRating(ps, SIM_CONSTANTS.RATING_BUILDUP)
    }
  } else if (outcome === 'nothing') {
    for (const c of matchup.defenders) {
      const ps = getStateById(state, defendingSide, c.id)
      if (ps) adjustRating(ps, SIM_CONSTANTS.RATING_GOOD_DEFENSE)
    }
  }

  // Momentum updates from home's perspective. Goals swing big, chances
  // are smaller, "good defense" gives a tiny bump to the defending side.
  let momentumDelta = 0
  if (chanceDetail?.goal) {
    momentumDelta += attackingSide === 'home' ? SIM_CONSTANTS.MOMENTUM_GOAL : SIM_CONSTANTS.MOMENTUM_CONCEDE * -1
    momentumDelta += defendingSide === 'home' ? SIM_CONSTANTS.MOMENTUM_CONCEDE : -SIM_CONSTANTS.MOMENTUM_CONCEDE * -1
    // Cleaner: just take the scoring side bonus.
    momentumDelta = attackingSide === 'home' ? SIM_CONSTANTS.MOMENTUM_GOAL : -SIM_CONSTANTS.MOMENTUM_GOAL
  } else if (outcome === 'chance') {
    momentumDelta = attackingSide === 'home' ? SIM_CONSTANTS.MOMENTUM_CHANCE : -SIM_CONSTANTS.MOMENTUM_CHANCE
    // Defender perspective: chance conceded.
    momentumDelta += attackingSide === 'home' ? 0 : SIM_CONSTANTS.MOMENTUM_CHANCE_CONCEDED * -1
  } else if (outcome === 'nothing') {
    // Good defense for defending side.
    momentumDelta = defendingSide === 'home' ? SIM_CONSTANTS.MOMENTUM_GOOD_DEFENSE : -SIM_CONSTANTS.MOMENTUM_GOOD_DEFENSE
  }
  state.momentum = decayMomentum(adjustMomentumForHome(state.momentum, momentumDelta))

  // Stamina drain.
  applyBeatStaminaDrain(state, involvedHomeIds, involvedAwayIds)

  // Adrenaline boost for the scoring side.
  if (goalScored) applyGoalStaminaBoost(state, attackingSide)

  // Minutes played for everyone on the pitch.
  for (const ps of [...state.players.home, ...state.players.away]) {
    if (ps.isOnPitch) ps.minutesPlayed += minutesAdvanced
  }

  // Half-time recovery if we just crossed beat HALFTIME_BEAT.
  if (state.beat === SIM_CONSTANTS.HALFTIME_BEAT) {
    for (const ps of [...state.players.home, ...state.players.away]) {
      if (ps.isOnPitch) {
        ps.currentFitness = Math.min(100, ps.currentFitness + SIM_CONSTANTS.HALFTIME_RECOVERY)
      }
    }
  }

  // Append the beat event and return the mutated state.
  const result: BeatResult = {
    beat: state.beat,
    minute: state.minute,
    attackingTeam: attackingSide,
    zone,
    outcome,
    chanceDetail,
    foulDetail,
    cornerTaken: cornerTaken || undefined,
    passiveInjury,
    momentum: state.momentum
  }
  state.events.push(result)

  return state
}

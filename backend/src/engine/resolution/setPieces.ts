// Set piece resolution — free kicks, penalties, corners. Each comes from
// either a foul or a buildup/save during open play.

import { SIM_CONSTANTS } from '~/consts/engine'
import type { RNG } from '~/lib/rng'
import { effective, getFatigueMultiplier } from '~/engine/stats'
import type { Card, MatchState, PlayerMatchState, SetPieceKind, Side, Squad, Zone, ZoneMatchup } from '~/types'

// Fetch the on-pitch GK (slot 0) for a squad, or null.
function findGK(squad: Squad, states: PlayerMatchState[]): { card: Card; state: PlayerMatchState } | null {
  const slot = squad.lineup.find((l) => l.slot === 0)
  if (!slot) return null
  const card = squad.cards.find((c) => c.id === slot.cardId)
  const ps = states.find((p) => p.cardId === slot.cardId)
  if (!card || !ps || !ps.isOnPitch) return null
  return { card, state: ps }
}

// Outcome of a single set piece resolution.
export type SetPieceResolution = {
  kind: SetPieceKind
  goal: boolean
  shooterId?: string
  // True if a shot was actually taken (stats use this to avoid counting
  // crosses that produced no header attempt). Always true for direct
  // shots — penalty and centre free kick. For corners / wing crosses,
  // false when resolveCorner's header-creation roll didn't fire.
  attempted: boolean
}

// Determine what set piece (if any) results from a foul in the given zone.
// Wing fouls produce free kicks (not corners) — corners can only be
// awarded for defensive touches over the goal line, which the engine
// models via open-play cornerTaken in beat.ts. The wing free kick is
// resolved cross-style internally (same logic as a corner) but stays
// labeled as a free kick in foulDetail.setPiece for accurate stats.
export function classifySetPiece(zone: Zone, rng: RNG): SetPieceKind | null {
  // Penalty: rare, regardless of zone (counts as the foul being inside the box).
  if (rng.chance(SIM_CONSTANTS.PENALTY_FRACTION_OF_FOUL)) return 'penalty'
  if (zone === 'centre') return 'free_kick'
  if (zone === 'left_wing' || zone === 'right_wing') return 'free_kick'
  return null
}

// Dispatch to the right resolver based on set piece kind. Falls through
// to a no-goal result if the matchup has no attackers left. For free
// kicks we branch on zone — centre is a direct shot, wing is a cross /
// header attempt (resolveCorner internally), since that's how wing
// free kicks are typically taken in real football.
export function resolveSetPiece(
  kind: SetPieceKind,
  state: MatchState,
  attackingSide: Side,
  matchup: ZoneMatchup,
  rng: RNG
): SetPieceResolution {
  if (matchup.attackers.length === 0) return { kind, goal: false, attempted: false }
  if (kind === 'penalty') return resolvePenalty(state, attackingSide, matchup, rng)
  if (kind === 'free_kick') {
    if (matchup.zone === 'left_wing' || matchup.zone === 'right_wing') {
      // Cross-style delivery — internally uses resolveCorner but stays
      // labeled as a free kick on the way out.
      const r = resolveCorner(state, attackingSide, matchup, rng)
      return { ...r, kind: 'free_kick' }
    }
    return resolveFreeKick(state, attackingSide, matchup, rng)
  }
  return resolveCorner(state, attackingSide, matchup, rng)
}

// The attacker with the highest shooting stat — used as the shot taker.
function bestShooter(matchup: ZoneMatchup): { card: Card; state: PlayerMatchState } {
  let idx = 0
  for (let i = 1; i < matchup.attackers.length; i++) {
    if (matchup.attackers[i].stats.shooting > matchup.attackers[idx].stats.shooting) {
      idx = i
    }
  }
  return { card: matchup.attackers[idx], state: matchup.attackerStates[idx] }
}

// The attacker with the highest passing — used as the corner/free-kick taker.
function bestPasser(matchup: ZoneMatchup): { card: Card; state: PlayerMatchState } {
  let idx = 0
  for (let i = 1; i < matchup.attackers.length; i++) {
    if (matchup.attackers[i].stats.passing > matchup.attackers[idx].stats.passing) {
      idx = i
    }
  }
  return { card: matchup.attackers[idx], state: matchup.attackerStates[idx] }
}

// Clamp helper.
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

// Penalty: clamped conversion based on the best shooter's shooting stat.
function resolvePenalty(state: MatchState, attackingSide: Side, matchup: ZoneMatchup, rng: RNG): SetPieceResolution {
  const shooter = bestShooter(matchup)
  const eff = effective(shooter.card, shooter.state, state.config.weather)
  const conv = clamp(
    (eff.shooting / 100) * SIM_CONSTANTS.PENALTY_CONVERSION_FACTOR,
    SIM_CONSTANTS.PENALTY_CONVERSION_MIN,
    SIM_CONSTANTS.PENALTY_CONVERSION_MAX
  )
  return {
    kind: 'penalty',
    goal: rng.chance(conv),
    shooterId: shooter.card.id,
    attempted: true
  }
}

// Direct free kick: shooter quality vs. GK quality, with a fatigue tax.
function resolveFreeKick(state: MatchState, attackingSide: Side, matchup: ZoneMatchup, rng: RNG): SetPieceResolution {
  const shooter = bestShooter(matchup)
  const eff = effective(shooter.card, shooter.state, state.config.weather)
  const fatigue = getFatigueMultiplier(shooter.state.currentFitness)
  const defendingSide: Side = attackingSide === 'home' ? 'away' : 'home'
  const defSquad = defendingSide === 'home' ? state.homeSquad : state.awaySquad
  const defStates = defendingSide === 'home' ? state.players.home : state.players.away
  const gk = findGK(defSquad, defStates)
  let saveProb = 0.5
  if (gk) {
    const gkEff = effective(gk.card, gk.state, state.config.weather)
    saveProb = (gkEff.defending * 0.3 + gkEff.positioning * 0.4 + gkEff.physicality * 0.3) / 100
  }
  // Free-kick base ~12%, scaled by shooter quality.
  const goalChance = clamp(
    SIM_CONSTANTS.FREE_KICK_BASE_CONVERSION * (eff.shooting / 75) * fatigue * (1 - saveProb * 0.6),
    0.03,
    0.4
  )
  return { kind: 'free_kick', goal: rng.chance(goalChance), shooterId: shooter.card.id, attempted: true }
}

// Corner / wing free kick: delivery quality + best aerial threat vs. CBs,
// then a header shot at the GK if a chance is created.
function resolveCorner(state: MatchState, attackingSide: Side, matchup: ZoneMatchup, rng: RNG): SetPieceResolution {
  const passer = bestPasser(matchup)
  const passerEff = effective(passer.card, passer.state, state.config.weather)
  const deliveryQuality = passerEff.passing / 100

  const attackAerialMax = Math.max(
    ...matchup.attackers.map((c, i) => {
      const e = effective(c, matchup.attackerStates[i], state.config.weather)
      return (e.physicality + e.positioning) / 200
    }),
    0
  )
  const defendingSide: Side = attackingSide === 'home' ? 'away' : 'home'
  const defSquad = defendingSide === 'home' ? state.homeSquad : state.awaySquad
  const defStates = defendingSide === 'home' ? state.players.home : state.players.away
  const cbSlots = [2, 3]
  const cbCards: Card[] = []
  const cbStates: PlayerMatchState[] = []
  for (const slot of cbSlots) {
    const slotInfo = defSquad.lineup.find((l) => l.slot === slot)
    if (!slotInfo) continue
    const c = defSquad.cards.find((x) => x.id === slotInfo.cardId)
    const ps = defStates.find((p) => p.cardId === slotInfo.cardId)
    if (c && ps && ps.isOnPitch) {
      cbCards.push(c)
      cbStates.push(ps)
    }
  }
  const defenseAerialMax = Math.max(
    ...cbCards.map((c, i) => {
      const e = effective(c, cbStates[i], state.config.weather)
      return (e.physicality + e.defending) / 200
    }),
    0
  )
  const cornerChance = clamp(
    deliveryQuality * SIM_CONSTANTS.CORNER_DELIVERY_WEIGHT * (attackAerialMax - defenseAerialMax + 0.5),
    0.02,
    0.4
  )

  let goal = false
  let shooterId: string | undefined
  let attempted = false
  if (rng.chance(cornerChance)) {
    // Resolve as a header chance: shoot vs GK.
    attempted = true
    const gk = findGK(defSquad, defStates)
    let gkSaveProb = 0.6
    if (gk) {
      const gkEff = effective(gk.card, gk.state, state.config.weather)
      gkSaveProb = clamp((gkEff.defending * 0.3 + gkEff.positioning * 0.4 + gkEff.physicality * 0.3) / 100, 0.1, 0.95)
    }
    // Best aerial threat takes the header.
    let bestIdx = 0
    let bestScore = -1
    for (let i = 0; i < matchup.attackers.length; i++) {
      const e = effective(matchup.attackers[i], matchup.attackerStates[i], state.config.weather)
      const s = e.physicality + e.positioning
      if (s > bestScore) {
        bestScore = s
        bestIdx = i
      }
    }
    shooterId = matchup.attackers[bestIdx]?.id
    goal = !rng.chance(gkSaveProb * 0.85)
  }

  return { kind: 'corner', goal, shooterId, attempted }
}

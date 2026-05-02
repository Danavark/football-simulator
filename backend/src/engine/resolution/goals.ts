// Three-stage goal resolution: chance quality → shot accuracy → GK save.

import { SIM_CONSTANTS } from '~/consts/engine'
import type { RNG } from '~/lib/rng'
import { effective, getFatigueMultiplier } from '~/engine/stats'
import type { Card, ChanceDetail, ChanceQuality, MatchState, PlayerMatchState, Side, Squad, ZoneMatchup } from '~/types'

// Clamp helper used by the probability calculations.
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

// Find the on-pitch GK (slot 0) for the given squad, or null if absent.
function findGoalkeeper(squad: Squad, states: PlayerMatchState[]): { card: Card; state: PlayerMatchState } | null {
  const gkSlot = squad.lineup.find((l) => l.slot === 0)
  if (!gkSlot) return null
  const card = squad.cards.find((c) => c.id === gkSlot.cardId)
  const ps = states.find((p) => p.cardId === gkSlot.cardId)
  if (!card || !ps || !ps.isOnPitch) return null
  return { card, state: ps }
}

// Resolve a created chance into a goal/save/miss outcome. Runs the three
// stages: quality classification, shot-on-target roll, GK save roll.
// Returns null if no attackers are available (matchup wiped out).
export function resolveChance(
  state: MatchState,
  attackingSide: Side,
  matchup: ZoneMatchup,
  delta: number,
  rng: RNG
): ChanceDetail | null {
  if (matchup.attackers.length === 0) return null
  // Stage 1 — chance quality. Attacking-mentality attackers get a flat
  // bonus to clear-cut probability — paired with the chance-threshold
  // bonus in beat.ts, this is the offensive payoff that justifies the
  // defensive vulnerability attacking teams trade off.
  const momentumForAttacker = attackingSide === 'home' ? state.momentum : -state.momentum
  const atkTactics = attackingSide === 'home' ? state.homeTactics : state.awayTactics
  const attackingMentalityBonus = atkTactics.mentality === 'attacking' ? SIM_CONSTANTS.ATTACKING_CLEAR_CUT_BONUS : 0
  const clearCutRaw =
    SIM_CONSTANTS.CLEAR_CUT_BASE +
    attackingMentalityBonus +
    delta * SIM_CONSTANTS.CLEAR_CUT_DELTA_WEIGHT +
    momentumForAttacker * SIM_CONSTANTS.CLEAR_CUT_MOMENTUM_WEIGHT
  const clearCutProbability = clamp(clearCutRaw, SIM_CONSTANTS.CLEAR_CUT_MIN, SIM_CONSTANTS.CLEAR_CUT_MAX)
  const quality: ChanceQuality = rng.chance(clearCutProbability) ? 'clear_cut' : 'half_chance'

  // Stage 2 — pick shooter (highest shooting among attackers).
  let shooterIdx = 0
  for (let i = 1; i < matchup.attackers.length; i++) {
    if (matchup.attackers[i].stats.shooting > matchup.attackers[shooterIdx].stats.shooting) {
      shooterIdx = i
    }
  }
  const shooterCard = matchup.attackers[shooterIdx]
  const shooterState = matchup.attackerStates[shooterIdx]
  const shooterEff = effective(shooterCard, shooterState, state.config.weather)
  const shooterFatigue = getFatigueMultiplier(shooterState.currentFitness)

  const baseAccuracy = (shooterEff.shooting * 0.7 + shooterEff.positioning * 0.3) / 100
  const accuracyMod = quality === 'clear_cut' ? SIM_CONSTANTS.CLEAR_CUT_MODIFIER_CLEAR : SIM_CONSTANTS.CLEAR_CUT_MODIFIER_HALF

  const onTargetProbability = clamp(baseAccuracy * accuracyMod, 0, 0.98)
  const onTarget = rng.chance(onTargetProbability)

  // Pick assister: highest passing among other attackers (skip the shooter).
  let assisterCardId: string | undefined
  let bestPassing = -1
  for (let i = 0; i < matchup.attackers.length; i++) {
    if (i === shooterIdx) continue
    const eff = effective(matchup.attackers[i], matchup.attackerStates[i], state.config.weather)
    if (eff.passing > bestPassing) {
      bestPassing = eff.passing
      assisterCardId = matchup.attackers[i].id
    }
  }

  if (!onTarget) {
    return {
      quality,
      shooter: shooterCard.id,
      assister: assisterCardId,
      onTarget: false,
      saved: false,
      goal: false
    }
  }

  // Stage 3 — GK save.
  const defendingSide: Side = attackingSide === 'home' ? 'away' : 'home'
  const defSquad = defendingSide === 'home' ? state.homeSquad : state.awaySquad
  const defStates = defendingSide === 'home' ? state.players.home : state.players.away
  const gk = findGoalkeeper(defSquad, defStates)

  let saveProbability: number
  if (!gk) {
    saveProbability = 0.05 // empty net basically
  } else {
    const gkEff = effective(gk.card, gk.state, state.config.weather)
    const gkFatigue = getFatigueMultiplier(gk.state.currentFitness)
    const gkScore = (gkEff.defending * 0.3 + gkEff.positioning * 0.4 + gkEff.physicality * 0.3) / 100
    const gkMod = quality === 'clear_cut' ? SIM_CONSTANTS.GK_MODIFIER_CLEAR : SIM_CONSTANTS.GK_MODIFIER_HALF
    saveProbability = clamp(gkScore * gkMod * gkFatigue, 0.02, 0.98)
  }

  const goal = !rng.chance(saveProbability)

  return {
    quality,
    shooter: shooterCard.id,
    assister: assisterCardId,
    onTarget: true,
    saved: !goal,
    goal
  }
}

// True if any attacker's dribbling exceeds every defender's defending by
// at least the brilliance gap — gives a small bonus chance of a clear chance.
export function individualBrillianceTriggers(matchup: ZoneMatchup): boolean {
  for (const atk of matchup.attackers) {
    const dribbling = atk.stats.dribbling
    let beatsAll = true
    if (matchup.defenders.length === 0) {
      beatsAll = false
      break
    }
    for (const def of matchup.defenders) {
      if (def.stats.defending + SIM_CONSTANTS.INDIVIDUAL_BRILLIANCE_GAP > dribbling) {
        beatsAll = false
        break
      }
    }
    if (beatsAll) return true
  }
  return false
}

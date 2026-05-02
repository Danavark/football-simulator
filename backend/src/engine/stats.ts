// Stat reads. ALL stat reads in the engine must go through getEffectiveStats.
// Composition:
//   base = card.stats[s] + (card.statBoosts?.[s] ?? 0)   -- earned overlay
//   then multipliers (left-to-right):
//     fatigue → chemistry → form → position-fit → legend → weather (per-stat) → mode (per-stat)
// Future modifiers slot in here.

import { POSITION_AFFINITY, SIM_CONSTANTS, WEATHER_MODS } from '@/consts/engine'
import type {
  Card,
  EffectiveStats,
  BeatContext,
  PlayerMatchState,
  Position,
  Stats,
  StatWeights,
  WeatherCondition
} from '@/types'

// Map remaining stamina (0–100) to a flat multiplier on outfield stats.
export function getFatigueMultiplier(stamina: number): number {
  if (stamina >= 80) return 1.0
  if (stamina >= 60) return 0.95
  if (stamina >= 40) return 0.85
  if (stamina >= 20) return 0.7
  return 0.55
}

// Chemistry boost — flat multiplier scaling with same-country teammate count.
// Pre-computed and stored on PlayerMatchState at match start.
function getChemistryMultiplier(chemistry: number): number {
  return 1 + chemistry * SIM_CONSTANTS.CHEMISTRY_BONUS_PER_TEAMMATE
}

// How well a card's natural position matches the slot they're playing in.
// Returns a multiplier from POSITION_FIT_EXACT (1.0) down to
// POSITION_FIT_UNRELATED (0.85). Used at match init and on substitutions —
// the stored result lives on PlayerMatchState.positionFit.
export function computePositionFit(actual: Position, expected: Position): number {
  if (actual === expected) return SIM_CONSTANTS.POSITION_FIT_EXACT
  const ladder = POSITION_AFFINITY[expected]
  const idx = ladder.indexOf(actual)
  if (idx === -1) return SIM_CONSTANTS.POSITION_FIT_UNRELATED
  if (idx === 1) return SIM_CONSTANTS.POSITION_FIT_NEIGHBOR
  if (idx === 2) return SIM_CONSTANTS.POSITION_FIT_TWO_AWAY
  return SIM_CONSTANTS.POSITION_FIT_THREE_AWAY
}

// Yellow-card "safe mode" reduces a defender's commitment in challenges.
// Mirror "aggressive" mode is unused but reserved for future user picks.
function getModeDefendingMultiplier(mode: PlayerMatchState['mode']): number {
  if (mode === 'safe') return SIM_CONSTANTS.MODE_SAFE_DEFENDING_MULTIPLIER
  if (mode === 'aggressive') return SIM_CONSTANTS.MODE_AGGRESSIVE_DEFENDING_MULTIPLIER
  return 1
}

// The single integration point for every stat read in the engine.
// Modifiers stack as multipliers; see file header for the order.
// Stamina-the-stat itself isn't faded by fatigue (it controls drain
// elsewhere), but is otherwise treated like the other 7 stats.
export function getEffectiveStats(card: Card, context: BeatContext): EffectiveStats {
  const { playerState, weather } = context
  const fatigue = getFatigueMultiplier(playerState.currentFitness)
  const chem = getChemistryMultiplier(playerState.chemistry)
  const form = card.form ?? 1
  const fit = playerState.positionFit
  const legend = playerState.legendBuff
  const wMods = WEATHER_MODS[weather].stats
  const modeDef = getModeDefendingMultiplier(playerState.mode)
  // Multipliers that apply to every stat (fatigue exempt for stamina).
  const allStat = chem * form * fit * legend
  const fatigued = fatigue * allStat
  const s = card.stats
  const b = card.statBoosts
  // Earned stat overlay — additive on top of natural rolls. Tiny `?? 0`
  // calls are inlined to keep the hot read path branch-free per stat.
  const pace = s.pace + (b?.pace ?? 0)
  const shooting = s.shooting + (b?.shooting ?? 0)
  const passing = s.passing + (b?.passing ?? 0)
  const dribbling = s.dribbling + (b?.dribbling ?? 0)
  const defending = s.defending + (b?.defending ?? 0)
  const physicality = s.physicality + (b?.physicality ?? 0)
  const positioning = s.positioning + (b?.positioning ?? 0)
  const stamina = s.stamina + (b?.stamina ?? 0)
  return {
    pace: pace * fatigued * (wMods.pace ?? 1),
    shooting: shooting * fatigued * (wMods.shooting ?? 1),
    passing: passing * fatigued * (wMods.passing ?? 1),
    dribbling: dribbling * fatigued * (wMods.dribbling ?? 1),
    defending: defending * fatigued * (wMods.defending ?? 1) * modeDef,
    physicality: physicality * fatigued * (wMods.physicality ?? 1),
    positioning: positioning * fatigued * (wMods.positioning ?? 1),
    // Stamina stat itself isn't fatigued. Other modifiers still apply.
    stamina: stamina * allStat * (wMods.stamina ?? 1)
  }
}

// Shorthand for the common case of "give me effective stats for this player
// in the given weather". Fatigue + chemistry + form + position-fit + mode
// all come from card / player state.
export function effective(card: Card, ps: PlayerMatchState, weather: WeatherCondition): EffectiveStats {
  return getEffectiveStats(card, { playerState: ps, weather })
}

// Sum stat values weighted by the given coefficients (used for attack/defense
// scoring where each zone weights stats differently).
export function weightedScore(stats: Stats, weights: StatWeights): number {
  let total = 0
  if (weights.pace) total += stats.pace * weights.pace
  if (weights.shooting) total += stats.shooting * weights.shooting
  if (weights.passing) total += stats.passing * weights.passing
  if (weights.dribbling) total += stats.dribbling * weights.dribbling
  if (weights.defending) total += stats.defending * weights.defending
  if (weights.physicality) total += stats.physicality * weights.physicality
  if (weights.positioning) total += stats.positioning * weights.positioning
  return total
}

// Standard logistic — used to convert a stat delta into a probability.
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

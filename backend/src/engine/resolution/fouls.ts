// Foul, card and injury rolls — run once per beat independently of the
// main attack/defense outcome.

import { SIM_CONSTANTS, WEATHER_MODS } from '@/consts/engine'
import type { RNG } from '@/lib/rng'
import type { Card, Mentality, PlayerMatchState, WeatherCondition, Zone, ZoneMatchup } from '@/types'

export type FoulRollInput = {
  matchup: ZoneMatchup
  defenderTeamMentality: Mentality
}

// Probability that a foul occurs in this beat. Higher when attackers
// outclass defenders, when defenders are tired, or when defenders press.
export function foulProbability(input: FoulRollInput): number {
  const { matchup, defenderTeamMentality } = input
  if (matchup.attackers.length === 0 || matchup.defenders.length === 0) {
    return SIM_CONSTANTS.BASE_FOUL_RATE
  }

  const avgAtkDribbling = avg(matchup.attackers.map((c) => c.stats.dribbling))
  const avgDefDefending = avg(matchup.defenders.map((c) => c.stats.defending))
  const avgAtkPhys = avg(matchup.attackers.map((c) => c.stats.physicality))
  const avgDefPhys = avg(matchup.defenders.map((c) => c.stats.physicality))
  const avgDefStamina = avg(matchup.defenderStates.map((p) => p.currentFitness))

  let p = SIM_CONSTANTS.BASE_FOUL_RATE
  p += Math.max(0, avgAtkDribbling - avgDefDefending) * SIM_CONSTANTS.FOUL_SKILL_WEIGHT
  if (avgDefPhys < avgAtkPhys) p += SIM_CONSTANTS.FOUL_PHYS_BONUS
  if (defenderTeamMentality === 'attacking') p += SIM_CONSTANTS.FOUL_MENTALITY_ATTACKING
  p += (1 - avgDefStamina / 100) * SIM_CONSTANTS.FOUL_STAMINA_WEIGHT

  return Math.max(0, Math.min(0.98, p))
}

// What a resolved foul produced.
export type FoulOutcome = {
  fouler: Card
  foulerState: PlayerMatchState
  victim: Card
  victimState: PlayerMatchState
  card?: 'yellow' | 'red' | 'second_yellow'
  injury: boolean
}

// Resolve a foul: pick the fouler and victim, decide whether a card
// is shown, and apply state mutations (yellows, reds, sending off).
export function resolveFoul(
  matchup: ZoneMatchup,
  refStrictness: number,
  isTacticalFoul: boolean,
  rng: RNG
): FoulOutcome | null {
  if (matchup.defenders.length === 0 || matchup.attackers.length === 0) {
    return null
  }
  // Pick a fouler (defender) — weighted toward lower defending and lower stamina.
  // Yellowed players are excluded entirely; if every candidate is on a yellow,
  // the team's "safe mode" wins out and the foul fizzles.
  const foulerIdx = pickWeightedDefender(matchup, rng)
  if (foulerIdx < 0) return null
  const fouler = matchup.defenders[foulerIdx]
  const foulerState = matchup.defenderStates[foulerIdx]
  // Pick a victim (attacker) — weighted toward higher dribbling.
  const victimIdx = pickWeightedAttacker(matchup, rng)
  const victim = matchup.attackers[victimIdx]
  const victimState = matchup.attackerStates[victimIdx]

  const isInAttackingZone = matchup.zone === 'centre' || matchup.zone === 'counter'

  // Card resolution.
  let card: 'yellow' | 'red' | 'second_yellow' | undefined
  let yellowChance = SIM_CONSTANTS.YELLOW_BASE_CHANCE * refStrictness
  if (isTacticalFoul) yellowChance *= SIM_CONSTANTS.TACTICAL_FOUL_MULTIPLIER
  if (isInAttackingZone) yellowChance *= SIM_CONSTANTS.ATTACKING_ZONE_MULTIPLIER
  yellowChance = Math.min(0.95, yellowChance)

  const redChance = SIM_CONSTANTS.RED_BASE_CHANCE * refStrictness

  if (rng.chance(redChance)) {
    card = 'red'
    foulerState.redCard = true
    foulerState.isOnPitch = false
  } else if (rng.chance(yellowChance)) {
    if (foulerState.yellowCards >= 1) {
      card = 'second_yellow'
      foulerState.yellowCards = 2
      foulerState.redCard = true
      foulerState.isOnPitch = false
    } else {
      card = 'yellow'
      foulerState.yellowCards = 1
      // Carded players go cautious — drops their effective defending and
      // makes them less likely to commit further fouls (handled by
      // pickWeightedDefender's yellow-exclusion + ALLOW_YELLOWED_FOUL).
      foulerState.mode = 'safe'
    }
  }

  return {
    fouler,
    foulerState,
    victim,
    victimState,
    card,
    injury: false
  }
}

// Elevated injury roll triggered by being fouled. Weather adds a flat
// bonus on top of the per-card factors (wet pitch, snow, etc.).
export function rollFoulInjury(
  victimCard: Card,
  victimState: PlayerMatchState,
  weather: WeatherCondition,
  rng: RNG
): boolean {
  const p =
    SIM_CONSTANTS.INJURY_FOUL_RATE +
    victimCard.injuryProneness * SIM_CONSTANTS.INJURY_FOUL_PRONENESS_WEIGHT +
    Math.max(0, 1 - victimState.currentFitness / 100) * SIM_CONSTANTS.INJURY_FOUL_FATIGUE_WEIGHT +
    Math.max(0, 1 - victimCard.stats.physicality / 100) * SIM_CONSTANTS.INJURY_FOUL_FRAILTY_WEIGHT +
    WEATHER_MODS[weather].injuryBonus
  return rng.chance(p)
}

// Background injury roll, run once per beat on a single random player.
// Tired and injury-prone players are at higher risk; weather adds a flat
// bonus.
export function rollPassiveInjury(card: Card, state: PlayerMatchState, weather: WeatherCondition, rng: RNG): boolean {
  // Persistent character growth (statBoosts) toughens players against
  // passive injury. Match-time conditions don't.
  const physStat = card.stats.physicality + (card.statBoosts?.physicality ?? 0)
  const p =
    SIM_CONSTANTS.INJURY_BASE_RATE +
    card.injuryProneness * SIM_CONSTANTS.INJURY_PRONENESS_WEIGHT +
    Math.max(0, 1 - state.currentFitness / 100) * SIM_CONSTANTS.INJURY_FATIGUE_WEIGHT +
    Math.max(0, 1 - physStat / 100) * SIM_CONSTANTS.INJURY_FRAILTY_WEIGHT +
    WEATHER_MODS[weather].injuryBonus
  return rng.chance(p)
}

// Average helper.
function avg(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// Probability that a yellowed defender breaks "safe mode" and commits
// a fresh foul this beat. Tuned to land second-yellow reds in spec range.
const ALLOW_YELLOWED_FOUL = 0.015

function pickWeightedDefender(matchup: ZoneMatchup, rng: RNG): number {
  // Mostly uniform — slight lean toward worse defenders and tired legs.
  // Yellowed defenders are excluded most of the time (simulating "safe
  // mode") but on rare beats they're allowed back in, producing second
  // yellows at a realistic rate.
  const allowYellowed = rng.next() < ALLOW_YELLOWED_FOUL

  const eligibleIdx: number[] = []
  const weights: number[] = []
  for (let i = 0; i < matchup.defenders.length; i++) {
    const ps = matchup.defenderStates[i]
    if (ps.yellowCards >= 1 && !allowYellowed) continue
    const d = matchup.defenders[i]
    eligibleIdx.push(i)
    weights.push(50 + Math.max(0, 100 - d.stats.defending) * 0.2 + (100 - ps.currentFitness) * 0.1)
  }
  if (eligibleIdx.length === 0) return -1
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return eligibleIdx[i]
  }
  return eligibleIdx[eligibleIdx.length - 1]
}

// Pick the attacker who got fouled — biased toward better dribblers since
// they're more often the ones being challenged.
function pickWeightedAttacker(matchup: ZoneMatchup, rng: RNG): number {
  const weights = matchup.attackers.map((a) => Math.max(0.1, a.stats.dribbling))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

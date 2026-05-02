// Zone selection and matchup building. Once we know who is attacking,
// this picks a zone and pulls the right players from each side.

import {
  ATTACK_WEIGHTS,
  ATTACKER_SLOTS,
  DEFENDER_SLOTS,
  DEFENSE_WEIGHTS,
  FORMATION_ZONE_BIAS,
  SIM_CONSTANTS,
  WEATHER_MODS,
  ZONE_BASE_WEIGHTS,
  ZONE_MENTALITY_MODS
} from '~/consts/engine'
import type { RNG } from '~/lib/rng'
import { effective, weightedScore } from '~/engine/stats'
import type {
  Card,
  EffectiveStats,
  MatchState,
  Mentality,
  PlayerMatchState,
  Side,
  Squad,
  Tactics,
  WeatherCondition,
  Zone,
  ZoneMatchup
} from '~/types'

const ALL_ZONES: Zone[] = ['left_wing', 'right_wing', 'centre', 'long_ball', 'counter']

// Weighted-random pick of which zone the attack flows through. Weights
// combine base values, mentality mods, formation bias, and weather bias.
export function pickZone(attackTactics: Tactics, defenseTactics: Tactics, weather: WeatherCondition, rng: RNG): Zone {
  const weatherBias = WEATHER_MODS[weather].zoneBias
  const weights = ALL_ZONES.map((z) => {
    let w = ZONE_BASE_WEIGHTS[z]
    const mods = ZONE_MENTALITY_MODS[z]
    if (attackTactics.mentality === 'attacking') w += mods.attacking
    if (defenseTactics.mentality === 'defensive') w += mods.defensive
    if (attackTactics.mentality === 'defensive') w -= mods.attacking * 0.5
    if (defenseTactics.mentality === 'attacking') w -= mods.defensive * 0.5
    const formBias = FORMATION_ZONE_BIAS[attackTactics.formation][z] ?? 0
    w += formBias
    w += weatherBias[z] ?? 0
    return Math.max(0.01, w)
  })
  return rng.weightedPick(ALL_ZONES, weights)
}

// Look up cards + live states for a list of formation slot indices,
// skipping anyone who isn't on the pitch.
function pullCards(
  squad: Squad,
  playerStates: PlayerMatchState[],
  slotIndices: number[]
): { cards: Card[]; states: PlayerMatchState[] } {
  const lineupBySlot = new Map(squad.lineup.map((l) => [l.slot, l.cardId]))
  const psById = new Map(playerStates.map((p) => [p.cardId, p]))
  const cards: Card[] = []
  const states: PlayerMatchState[] = []
  for (const slot of slotIndices) {
    const cardId = lineupBySlot.get(slot)
    if (!cardId) continue
    const ps = psById.get(cardId)
    if (!ps || !ps.isOnPitch) continue
    const card = squad.cards.find((c) => c.id === cardId)
    if (!card) continue
    cards.push(card)
    states.push(ps)
  }
  return { cards, states }
}

// Build the attacker/defender pairing for the chosen zone using
// formation-specific slot mappings.
export function buildMatchup(state: MatchState, attackingSide: Side, zone: Zone): ZoneMatchup {
  const atkSquad = attackingSide === 'home' ? state.homeSquad : state.awaySquad
  const defSquad = attackingSide === 'home' ? state.awaySquad : state.homeSquad
  const atkTactics = attackingSide === 'home' ? state.homeTactics : state.awayTactics
  const defTactics = attackingSide === 'home' ? state.awayTactics : state.homeTactics
  const atkPS = attackingSide === 'home' ? state.players.home : state.players.away
  const defPS = attackingSide === 'home' ? state.players.away : state.players.home

  const atkSlots = ATTACKER_SLOTS[zone][atkTactics.formation]
  const defSlots = DEFENDER_SLOTS[zone][defTactics.formation]

  const a = pullCards(atkSquad, atkPS, atkSlots)
  const d = pullCards(defSquad, defPS, defSlots)

  return {
    zone,
    attackers: a.cards,
    defenders: d.cards,
    attackerStates: a.states,
    defenderStates: d.states,
    attackingSide,
    defenderTeamMentality: defTactics.mentality,
    expectedAttackers: atkSlots.length,
    expectedDefenders: defSlots.length
  }
}

// Output of scoring a matchup: average attack/defense scores and their delta.
export type Scores = {
  attackScore: number
  defenseScore: number
  delta: number
  attackerEffective: EffectiveStats[]
  defenderEffective: EffectiveStats[]
}

// Convert a matchup into a numeric duel: average weighted attack score vs.
// average weighted defense score. The delta feeds the beat-outcome sigmoid.
export function scoreMatchup(matchup: ZoneMatchup, weather: WeatherCondition): Scores {
  const attackWeights = ATTACK_WEIGHTS[matchup.zone]

  const atkEff = matchup.attackers.map((card, i) => effective(card, matchup.attackerStates[i], weather))
  const defEff = matchup.defenders.map((card, i) => effective(card, matchup.defenderStates[i], weather))

  // Apply counter-attack defender positioning penalty when the
  // defending team was caught in attacking mentality.
  const defEffAdjusted = defEff.map((s) => {
    if (matchup.zone !== 'counter') return s
    if (matchup.defenderTeamMentality !== 'attacking') return s
    return {
      ...s,
      positioning: Math.max(0, s.positioning - SIM_CONSTANTS.COUNTER_DEFENDER_POSITIONING_PENALTY)
    }
  })

  const attackerScores = atkEff.map((s) => weightedScore(s, attackWeights))
  const defenderScores = defEffAdjusted.map((s) => weightedScore(s, DEFENSE_WEIGHTS))

  // Average per-player score, then dock by missing-player ratio. A side
  // showing up to a zone with fewer bodies than the formation expected
  // (red card, unreplaced injury) genuinely matters here — without the
  // ratio multiplier, a 3-attacker zone scored the same as 4-attacker.
  // Ratio is raised to 1.5 so the per-attacker effectiveness also drops
  // when teammates are missing (more pressure on each remaining player,
  // fewer passing outlets) — pure linear ratio left short-handed teams
  // looking too clinical.
  const atkRatio = (matchup.attackers.length / Math.max(1, matchup.expectedAttackers)) ** 1.5
  const defRatio = (matchup.defenders.length / Math.max(1, matchup.expectedDefenders)) ** 1.5
  const attackScore =
    (attackerScores.reduce((a, b) => a + b, 0) / Math.max(1, attackerScores.length)) * atkRatio
  const defenseScore =
    (defenderScores.reduce((a, b) => a + b, 0) / Math.max(1, defenderScores.length)) * defRatio

  return {
    attackScore,
    defenseScore,
    delta: attackScore - defenseScore,
    attackerEffective: atkEff,
    defenderEffective: defEffAdjusted
  }
}

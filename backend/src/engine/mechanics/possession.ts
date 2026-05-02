// Possession resolution — decides which team gets the next attacking beat.

import { MIDFIELD_SLOTS, SIM_CONSTANTS } from '@/consts/engine'
import { effective } from '@/engine/stats'
import type { Card, MatchState, Mentality, PlayerMatchState, Side, Squad, Tactics, WeatherCondition } from '@/types'

// Average "midfield quality" of a side: passing + positioning + dribbling
// across the on-pitch midfielders for the given formation.
function midfieldScore(
  squad: Squad,
  tactics: Tactics,
  playerStates: PlayerMatchState[],
  weather: WeatherCondition
): number {
  const slots = MIDFIELD_SLOTS[tactics.formation]
  const lineupBySlot = new Map(squad.lineup.map((l) => [l.slot, l.cardId]))
  const psById = new Map(playerStates.map((p) => [p.cardId, p]))

  const sums: number[] = []
  for (const slot of slots) {
    const cardId = lineupBySlot.get(slot)
    if (!cardId) continue
    const ps = psById.get(cardId)
    if (!ps || !ps.isOnPitch) continue
    const card = squad.cards.find((c) => c.id === cardId)
    if (!card) continue
    const eff = effective(card, ps, weather)
    sums.push(eff.passing + eff.positioning + eff.dribbling)
  }
  if (sums.length === 0) return 0
  return sums.reduce((a, b) => a + b, 0) / sums.length
}

// Net mentality bonus from the home perspective.
function mentalityMod(home: Mentality, away: Mentality): number {
  const v = (m: Mentality) => (m === 'attacking' ? SIM_CONSTANTS.MENTALITY_MODIFIER : m === 'defensive' ? -SIM_CONSTANTS.MENTALITY_MODIFIER : 0)
  return v(home) - v(away)
}

// Count of on-pitch players for a side. Used by the man-down possession
// penalty so a red-carded or unreplaced-injured team loses the ball more.
function onPitchCount(playerStates: PlayerMatchState[]): number {
  let n = 0
  for (const ps of playerStates) if (ps.isOnPitch) n += 1
  return n
}

// Probability the next beat is attacked by the home side.
// Combines midfield delta, momentum, mentality, and on-pitch count delta.
export function homeBeatChance(state: MatchState): number {
  const w = state.config.weather
  const homeMid = midfieldScore(state.homeSquad, state.homeTactics, state.players.home, w)
  const awayMid = midfieldScore(state.awaySquad, state.awayTactics, state.players.away, w)
  const delta = homeMid - awayMid
  const playerDelta = onPitchCount(state.players.home) - onPitchCount(state.players.away)
  let p =
    0.5 +
    delta * SIM_CONSTANTS.MIDFIELD_WEIGHT +
    state.momentum * SIM_CONSTANTS.MOMENTUM_WEIGHT +
    mentalityMod(state.homeTactics.mentality, state.awayTactics.mentality) +
    playerDelta * SIM_CONSTANTS.PLAYER_COUNT_WEIGHT
  // Clamp to a sensible band so neither side is locked out.
  return Math.max(0.1, Math.min(0.9, p))
}

// Map a [0,1) roll to which side gets the attacking beat.
export function pickAttackingSide(state: MatchState, roll: number): Side {
  return roll < homeBeatChance(state) ? 'home' : 'away'
}

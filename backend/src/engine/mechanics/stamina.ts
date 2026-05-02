// Fitness drain calculations applied each beat. Fitness is the
// season-persistent gauge; this file handles the within-match drop. New
// fitness flows out via PlayerSummary.endFitness for the caller to write
// back to account state.

import { SIM_CONSTANTS } from '~/consts/engine'
import type { Card, MatchState, Mentality, Side } from '~/types'

// Mentality affects how much energy a team burns each beat.
function mentalityDrain(m: Mentality): number {
  if (m === 'attacking') return SIM_CONSTANTS.MENTALITY_DRAIN_ATTACKING
  if (m === 'defensive') return SIM_CONSTANTS.MENTALITY_DRAIN_DEFENSIVE
  return 0
}

// Drain stamina for every on-pitch player, with a bonus drain for any
// player involved in the resolved beat matchup.
export function applyBeatStaminaDrain(
  state: MatchState,
  involvedHomeIds: Set<string>,
  involvedAwayIds: Set<string>
): void {
  for (const ps of state.players.home) {
    if (!ps.isOnPitch) continue
    drainOne(ps.cardId, ps, state, 'home', involvedHomeIds.has(ps.cardId))
  }
  for (const ps of state.players.away) {
    if (!ps.isOnPitch) continue
    drainOne(ps.cardId, ps, state, 'away', involvedAwayIds.has(ps.cardId))
  }
}

// Drain a single player's fitness. Higher stamina stat → slower drain.
// Away players also pay a small home-advantage tax on top.
function drainOne(
  cardId: string,
  ps: { currentFitness: number; cardId: string },
  state: MatchState,
  side: Side,
  involved: boolean
): void {
  const card = findCard(state, side, cardId)
  if (!card) return
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics
  let drain = SIM_CONSTANTS.BASE_STAMINA_DRAIN
  if (involved) drain += SIM_CONSTANTS.ACTION_STAMINA_DRAIN
  drain += mentalityDrain(tactics.mentality)
  // Higher stamina stat = slower drain. Earned stat boosts (persistent
  // character growth) count, but match-time multipliers (chemistry, form,
  // weather) do not — drain is anchored to the persistent card sheet.
  // The stat is clamped before division so the curve only matters in the
  // 60-70 band — sub-60 doesn't punish further (rookies stay playable),
  // 70+ doesn't reward further (legends still get tired).
  const staminaStat = card.stats.stamina + (card.statBoosts?.stamina ?? 0)
  const clamped = Math.min(
    SIM_CONSTANTS.FITNESS_STAT_DRAIN_CEIL,
    Math.max(SIM_CONSTANTS.FITNESS_STAT_DRAIN_FLOOR, staminaStat)
  )
  let actualDrain = drain * (100 / clamped)
  if (side === 'away') actualDrain *= SIM_CONSTANTS.AWAY_STAMINA_DRAIN_MULTIPLIER
  ps.currentFitness = Math.max(0, ps.currentFitness - actualDrain)
}

// Adrenaline boost: every on-pitch player on the scoring side gets a small
// stamina top-up. Capped at 100.
export function applyGoalStaminaBoost(state: MatchState, side: Side): void {
  const players = side === 'home' ? state.players.home : state.players.away
  for (const ps of players) {
    if (!ps.isOnPitch) continue
    ps.currentFitness = Math.min(100, ps.currentFitness + SIM_CONSTANTS.GOAL_STAMINA_BOOST)
  }
}

// Restore some stamina to every on-pitch player at half time.
export function applyHalftimeRecovery(state: MatchState): void {
  for (const ps of [...state.players.home, ...state.players.away]) {
    if (!ps.isOnPitch) continue
    ps.currentFitness = Math.min(100, ps.currentFitness + SIM_CONSTANTS.HALFTIME_RECOVERY)
  }
}

// Look up a card by id within the given side's squad.
function findCard(state: MatchState, side: Side, cardId: string): Card | null {
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  return squad.cards.find((c) => c.id === cardId) ?? null
}

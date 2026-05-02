// Account-level fitness recovery between matches. The match engine itself
// just drains and reports endFitness on PlayerSummary; this utility is what
// the caller (DB layer / season runner) calls AFTER writing the post-match
// fitness back, to compute the next-match starting fitness.
//
// Spec: every card gets a recovery amount each match, played or not — that
// way a benched player rests fully and a played player partially recovers
// from their drained state. Recovery scales with the card's stamina stat
// (Q8 threshold formula): max(0, (staminaStat - 30) × 0.6), capped at 100.

import { PROGRESSION_CONSTANTS } from '~/consts/career'
import type { Card, Squad } from '~/types'

// How much fitness this card regains in a single recovery cycle. Earned
// stat boosts on stamina count, since they represent persistent character
// growth — same convention as the within-match drain formula.
export function recoveryAmount(card: Card): number {
  const { recoveryThreshold, recoveryRate } = PROGRESSION_CONSTANTS.fitness
  const stat = card.stats.stamina + (card.statBoosts?.stamina ?? 0)
  return Math.max(0, (stat - recoveryThreshold) * recoveryRate)
}

// Apply one match-cycle of recovery to every card in the squad. Pass in
// the post-match fitness map (typically derived from PlayerSummary
// endFitness for cards that played, unchanged for the bench) and get back
// the next-match starting fitness map.
export function applyRecovery(squad: Squad, fitness: Record<string, number>): Record<string, number> {
  const { cap } = PROGRESSION_CONSTANTS.fitness
  const next: Record<string, number> = {}
  for (const card of squad.cards) {
    const current = fitness[card.id] ?? cap
    next[card.id] = Math.min(cap, current + recoveryAmount(card))
  }
  return next
}

// Build a fresh season-start fitness map (every card at 100). Useful for
// the start of a season run before any matches are played.
export function freshSeasonFitness(squad: Squad): Record<string, number> {
  const { seasonStart } = PROGRESSION_CONSTANTS.fitness
  const out: Record<string, number> = {}
  for (const card of squad.cards) out[card.id] = seasonStart
  return out
}

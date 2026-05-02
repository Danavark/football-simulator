// Form — persistent stat multiplier carried between matches. Form lives on
// Card.form (defaults to 1.0 when absent); this file provides the math
// that converts a match rating into a form delta + a convenience helper
// that mutates a squad's cards based on a finished match.
//
// The engine never calls these helpers itself — `getEffectiveStats` only
// READS card.form. Callers (test runners, season runners, future
// progression systems) opt-in to form persistence by invoking
// `applyFormUpdates(homeSquad, awaySquad, result)` between matches.

import { SIM_CONSTANTS } from '@/consts/engine'
import type { Card, MatchResult, Squad } from '@/types'

// Convert a match rating to a form delta. A 6.0 rating (the starting
// rating, "average game") produces 0 change. 9.0 → +0.06, 4.0 → −0.04.
export function computeFormDelta(rating: number): number {
  return (rating - SIM_CONSTANTS.RATING_START) * SIM_CONSTANTS.FORM_DELTA_PER_RATING
}

// Apply form deltas to every player who actually appeared in the match.
// Mutates Card.form on the squad's cards (clamped to [FORM_MIN, FORM_MAX]).
// Players with 0 minutes (full bench) are untouched. The engine doesn't
// call this — the caller decides when form persistence runs.
export function applyFormUpdates(homeSquad: Squad, awaySquad: Squad, result: MatchResult): void {
  for (const ps of result.playerSummaries) {
    if (ps.minutesPlayed === 0) continue
    const squad = ps.team === 'home' ? homeSquad : awaySquad
    const card = squad.cards.find((c) => c.id === ps.cardId)
    if (!card) continue
    bumpFormFromRating(card, ps.matchRating)
  }
}

// Same as applyFormUpdates but for a single card / rating — useful when
// callers want to apply form updates without going through MatchResult.
export function bumpFormFromRating(card: Card, rating: number): void {
  const next = (card.form ?? 1) + computeFormDelta(rating)
  card.form = Math.max(SIM_CONSTANTS.FORM_MIN, Math.min(SIM_CONSTANTS.FORM_MAX, next))
}

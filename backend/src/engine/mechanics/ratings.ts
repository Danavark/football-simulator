// Match rating helpers. Each player accumulates a rating across the match,
// adjusted beat-by-beat based on their involvement.

import { SIM_CONSTANTS } from '@/consts/engine'
import type { PlayerMatchState } from '@/types'

// Add `delta` to a player's rating, clamped to the configured 1.0–10.0 band.
export function adjustRating(ps: PlayerMatchState, delta: number): void {
  ps.matchRating = Math.max(SIM_CONSTANTS.RATING_MIN, Math.min(SIM_CONSTANTS.RATING_MAX, ps.matchRating + delta))
}

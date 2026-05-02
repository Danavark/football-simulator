// Persistent injury state across matches. The engine flags injured
// players via PlayerMatchState.isInjured / MatchResult.playerSummaries
// per match — this layer turns those one-shot flags into severities,
// counts down recovery, and enforces the team-wide concurrency cap.
//
// Spec: docs/06_progression-and-balance.md §5.

import { PROGRESSION_CONSTANTS } from '~/consts/career'
import type { RNG } from '~/lib/rng'
import type { Card, MatchResult, Squad } from '~/types'

export type InjurySeverity = 'knock' | 'light' | 'medium' | 'heavy'

// Roll a severity from the configured weights. Pure RNG read.
export function rollSeverity(rng: RNG): InjurySeverity {
  const w = PROGRESSION_CONSTANTS.injurySeverityWeights
  return rng.weightedPick(['knock', 'light', 'medium', 'heavy'] as const, [w.knock, w.light, w.medium, w.heavy])
}

// Roll a recovery duration in matches for the given severity.
export function rollDuration(severity: InjurySeverity, rng: RNG): number {
  const cfg = PROGRESSION_CONSTANTS.injuryDurations[severity]
  return rng.int(cfg.min, cfg.max)
}

// One injury that came out of a match — used for logging / UI.
export type InjuryEvent = {
  cardId: string
  cardName: string
  severity: InjurySeverity
  matchesOut: number
}

// Apply post-match injury bookkeeping for a squad:
//   1. Decrement existing injury counters (returnsAfterMatch -= 1).
//   2. Resolve any whose counter has hit 0 back to active.
//   3. Roll severities for new injuries flagged in the result, honouring
//      the per-team concurrency cap (3rd+ → knock, no carryover).
//
// Mutates the cards in `squad`. Returns the new injuries for logging.
export function processSquadInjuries(
  squad: Squad,
  result: MatchResult,
  side: 'home' | 'away',
  rng: RNG
): InjuryEvent[] {
  // 1 + 2: tick existing.
  for (const card of squad.cards) {
    if (card.injuryStatus !== 'injured') continue
    const ttl = (card.injuryReturnsAfterMatch ?? 0) - 1
    if (ttl <= 0) {
      card.injuryStatus = 'active'
      card.injurySeverity = undefined
      card.injuryReturnsAfterMatch = undefined
    } else {
      card.injuryReturnsAfterMatch = ttl
    }
  }

  // 3: roll new injuries.
  const newOnes = result.playerSummaries
    .filter((s) => s.team === side && s.injured)
    .map((s) => squad.cards.find((c) => c.id === s.cardId))
    .filter((c): c is Card => Boolean(c))

  const events: InjuryEvent[] = []
  for (const card of newOnes) {
    let severity = rollSeverity(rng)

    // 2-injury cap. Count current actives BEFORE applying this one.
    const activeCount = squad.cards.filter((c) => c.injuryStatus === 'injured').length
    if (activeCount >= PROGRESSION_CONSTANTS.maxConcurrentInjuriesPerTeam && severity !== 'knock') {
      severity = 'knock'
    }

    const matchesOut = rollDuration(severity, rng)
    if (matchesOut > 0) {
      card.injuryStatus = 'injured'
      card.injurySeverity = severity
      card.injuryReturnsAfterMatch = matchesOut
    }
    // knock (matchesOut = 0): no carryover; the engine already played them off
    // for this match via isInjured/auto-sub, nothing more to do.

    events.push({
      cardId: card.id,
      cardName: card.name,
      severity,
      matchesOut
    })
  }

  return events
}

// True if the card is unavailable for the next match (injured with a
// non-zero countdown remaining). Used by the lineup picker to swap
// injured starters with bench cover before kick-off.
export function isUnavailable(card: Card): boolean {
  return card.injuryStatus === 'injured' && (card.injuryReturnsAfterMatch ?? 0) > 0
}

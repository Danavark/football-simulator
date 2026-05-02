// Match-rating-driven auto stat boosts. After a match, walk every card on
// the team that played and roll for a +1 to a position-relevant stat,
// gated by their match rating and damped by how many boosts they've
// already received.
//
// Spec: docs/06_progression-and-balance.md §3.

import { POSITION_PROFILE } from '~/consts/card'
import { PROGRESSION_CONSTANTS } from '~/consts/career'
import type { RNG } from '~/lib/rng'
import type { Card, MatchResult, Stats, Squad } from '~/types'

// Match rating → base auto-boost chance (before level damping).
function baseChance(rating: number): number {
  const c = PROGRESSION_CONSTANTS.autoBoost
  if (rating >= 10) return c.chance100
  if (rating >= 9) return c.chance90
  if (rating >= 8) return c.chance80
  if (rating >= 7) return c.chance70
  return 0
}

// Damping factor — heavily-boosted cards level slower. 1.0 at boost_count
// 0, 0.5 at 20, 0.29 at 50.
function damping(boostCount: number): number {
  return 1 / (1 + boostCount * PROGRESSION_CONSTANTS.autoBoost.levelDampingPerBoost)
}

// One auto-boost result, returned for logging / UI.
export type AutoBoostEvent = {
  cardId: string
  cardName: string
  stat: keyof Stats
  newValue: number
  newBoostCount: number
}

// Roll auto-boosts for every card on the squad that played in the result.
// Mutates `card.statBoosts` and `card.boostCount` in place. Returns one
// AutoBoostEvent per card that gained a stat. Pure with respect to RNG —
// same seed → same outcomes.
export function applyAutoBoosts(squad: Squad, result: MatchResult, side: 'home' | 'away', rng: RNG): AutoBoostEvent[] {
  const events: AutoBoostEvent[] = []
  const summaries = result.playerSummaries.filter((s) => s.team === side)

  for (const summary of summaries) {
    if (summary.minutesPlayed === 0) continue
    if (summary.matchRating < PROGRESSION_CONSTANTS.autoBoost.minRating) continue

    const card = squad.cards.find((c) => c.id === summary.cardId)
    if (!card) continue

    const boostCount = card.boostCount ?? 0
    const chance = baseChance(summary.matchRating) * damping(boostCount)
    if (!rng.chance(chance)) continue

    const stat = pickEligibleStat(card, rng)
    if (!stat) continue // every relevant stat is already at potential

    applyStatBoost(card, stat)
    const newValue = card.stats[stat] + (card.statBoosts?.[stat] ?? 0)
    events.push({
      cardId: card.id,
      cardName: card.name,
      stat,
      newValue,
      newBoostCount: card.boostCount ?? 0
    })
  }

  return events
}

// Increment a card's boost on the chosen stat. Initialises statBoosts and
// boostCount on first touch. Engine reads pick this up on next match.
export function applyStatBoost(card: Card, stat: keyof Stats): void {
  if (!card.statBoosts) card.statBoosts = {}
  card.statBoosts[stat] = (card.statBoosts[stat] ?? 0) + 1
  card.boostCount = (card.boostCount ?? 0) + 1
}

// Find an eligible stat to boost: position-relevant (high or mid band) AND
// below its hidden potential. Weighted random within eligible set, biasing
// toward identity-defining stats (high band weighted ×2, mid ×1).
function pickEligibleStat(card: Card, rng: RNG): keyof Stats | null {
  const profile = POSITION_PROFILE[card.position]
  const allStats: (keyof Stats)[] = [
    'pace',
    'shooting',
    'passing',
    'dribbling',
    'defending',
    'physicality',
    'positioning',
    'stamina'
  ]
  const eligible: { stat: keyof Stats; weight: number }[] = []
  for (const stat of allStats) {
    const band = profile[stat]
    if (band === 'low') continue
    if (statAtPotential(card, stat)) continue
    const weight =
      band === 'high' ? PROGRESSION_CONSTANTS.autoBoost.highBandWeight : PROGRESSION_CONSTANTS.autoBoost.midBandWeight
    eligible.push({ stat, weight })
  }
  if (eligible.length === 0) return null
  return rng.weightedPick(
    eligible.map((e) => e.stat),
    eligible.map((e) => e.weight)
  )
}

// True when the stat's current value (natural + boosts) has reached the
// hidden potential rolled at card generation. Cards generated before
// potentials existed (legacy / sample data) treat absent potentials as 99
// so progression isn't blocked.
export function statAtPotential(card: Card, stat: keyof Stats): boolean {
  const current = card.stats[stat] + (card.statBoosts?.[stat] ?? 0)
  const ceiling = card.statPotentials?.[stat] ?? 99
  return current >= ceiling
}

// Stat-rolling primitives. Constants and types live in @/consts/card —
// this file is just the logic that consumes them. Used by both the card
// generator (single random pulls) and the squad generator (15-card packs
// in either pack-pull or procedural-team mode).

import { CARD_CONSTANTS, POSITION_PROFILE, type StatBand, type StatTier } from '~/consts/card'
import { PROGRESSION_CONSTANTS } from '~/consts/career'
import type { RNG } from '~/lib/rng'
import type { Position, Stats } from '~/types'

// Re-export so callers that want the type can import it from this module
// (the historical home) without reaching into consts/.
export type { StatTier, StatBand }

// Roll a single stat. Bands give a base range, tier shifts up/down, then
// the per-stat floor (or globalFloor) and globalCeiling clamp the result
// — preventing unplayable rolls like a striker with stamina 22.
export function rollStat(position: Position, stat: keyof Stats, tier: StatTier, rng: RNG): number {
  const band = POSITION_PROFILE[position][stat]
  const [lo, hi] = CARD_CONSTANTS.bandRanges[band]
  const v = rng.int(lo, hi) + CARD_CONSTANTS.tierBonus[tier]
  const floor = CARD_CONSTANTS.statFloors[stat] ?? CARD_CONSTANTS.globalFloor
  return Math.max(floor, Math.min(CARD_CONSTANTS.globalCeiling, v))
}

// Build a full 8-stat block for a card.
export function generateStats(position: Position, tier: StatTier, rng: RNG): Stats {
  return {
    pace: rollStat(position, 'pace', tier, rng),
    shooting: rollStat(position, 'shooting', tier, rng),
    passing: rollStat(position, 'passing', tier, rng),
    dribbling: rollStat(position, 'dribbling', tier, rng),
    defending: rollStat(position, 'defending', tier, rng),
    physicality: rollStat(position, 'physicality', tier, rng),
    positioning: rollStat(position, 'positioning', tier, rng),
    stamina: rollStat(position, 'stamina', tier, rng)
  }
}

// Headroom multiplier driven by age. An 18-year-old gets full headroom
// (still has ~22 seasons of growth before retirement); a 35-year-old gets
// almost none (only ~5 seasons before age-out). Linear taper between
// generationAgeMin and retirementAge.
function ageHeadroomFactor(age: number): number {
  const { generationAgeMin, retirementAge, ageHeadroomFloor } = PROGRESSION_CONSTANTS
  const seasonsRemaining = Math.max(0, retirementAge - age)
  const maxSeasons = retirementAge - generationAgeMin
  return Math.max(ageHeadroomFloor, seasonsRemaining / maxSeasons)
}

// Roll a hidden ceiling for a single stat. Headroom depends on:
//   • position-band — a striker's defending stays low even with infinite XP
//   • age — a 35-year-old has limited room to grow; an 18-year-old has plenty
// See PROGRESSION_CONSTANTS.potentialBands for the band-level config.
function rollPotential(current: number, band: StatBand, ageFactor: number, rng: RNG): number {
  const cfg = PROGRESSION_CONSTANTS.potentialBands[band]
  const minH = Math.round(cfg.headroomMin * ageFactor)
  const maxH = Math.round(cfg.headroomMax * ageFactor)
  const headroom = rng.int(Math.max(0, minH), Math.max(0, maxH))
  return Math.min(cfg.ceiling, current + headroom)
}

// Roll the full 8-stat hidden potential block for a card. Each stat's
// ceiling is at least its current value (so rolls below current are not
// possible) and at most the band's hard cap. Age scales every stat's
// headroom uniformly.
export function generateStatPotentials(position: Position, stats: Stats, age: number, rng: RNG): Stats {
  const profile = POSITION_PROFILE[position]
  const af = ageHeadroomFactor(age)
  return {
    pace: rollPotential(stats.pace, profile.pace, af, rng),
    shooting: rollPotential(stats.shooting, profile.shooting, af, rng),
    passing: rollPotential(stats.passing, profile.passing, af, rng),
    dribbling: rollPotential(stats.dribbling, profile.dribbling, af, rng),
    defending: rollPotential(stats.defending, profile.defending, af, rng),
    physicality: rollPotential(stats.physicality, profile.physicality, af, rng),
    positioning: rollPotential(stats.positioning, profile.positioning, af, rng),
    stamina: rollPotential(stats.stamina, profile.stamina, af, rng)
  }
}

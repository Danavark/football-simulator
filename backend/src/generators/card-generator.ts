// Single-card generator. Produces one fully-populated Card with a random
// name, country, position, age, stats, and injury proneness. Building
// block for the future pack shop / draft / progression systems; the team
// generator builds whole 15-card squads from pre-supplied names instead.

import { PROGRESSION_CONSTANTS } from '~/consts/career'
import { generateStatPotentials, generateStats, type StatTier } from '~/generators/card-stats'
import { CARD_NAMES, type CountryNamePool } from '~/generators/card-names'
import type { RNG } from '~/lib/rng'
import type { Card, Position } from '~/types'

// Position weights — outfielders show up roughly proportional to how many
// slots they fill in a typical lineup. GKs are rarer (1 per 11). LM/RM are
// rarer too since only 4-4-2 uses them.
const POSITION_WEIGHTS: { position: Position; weight: number }[] = [
  { position: 'GK', weight: 1 },
  { position: 'CB', weight: 2 },
  { position: 'LB', weight: 1 },
  { position: 'RB', weight: 1 },
  { position: 'CDM', weight: 1 },
  { position: 'CM', weight: 2 },
  { position: 'CAM', weight: 1 },
  { position: 'LM', weight: 0.5 },
  { position: 'RM', weight: 0.5 },
  { position: 'LW', weight: 1 },
  { position: 'RW', weight: 1 },
  { position: 'ST', weight: 1.5 }
]

export type GenerateCardOpts = {
  // Pin any of these to bypass the random roll for that field.
  position?: Position
  country?: string
  tier?: StatTier
  // ID prefix — defaults to "card". The full ID is `${prefix}-${hex}`.
  idPrefix?: string
  // Optional dedup set — if passed, the rolled name is checked against
  // this set and rerolled until unique (with a fallback if exhausted).
  // The chosen name is added to the set as a side effect.
  excludeNames?: Set<string>
}

// Generate a single Card. Takes the RNG so callers control determinism.
export function generateCard(rng: RNG, opts: GenerateCardOpts = {}): Card {
  const position = opts.position ?? pickPosition(rng)
  const pool = pickPool(rng, opts.country)
  const tier = opts.tier ?? 'semipro'

  const { firstName, lastName } = pickName(rng, pool, opts.excludeNames)

  const stats = generateStats(position, tier, rng)
  const age = rng.int(PROGRESSION_CONSTANTS.generationAgeMin, PROGRESSION_CONSTANTS.generationAgeMax)
  return {
    id: makeId(rng, opts.idPrefix ?? 'card'),
    name: `${firstName} ${lastName}`,
    position,
    country: pool.country,
    age,
    stats,
    // Potential headroom scales with seasons remaining before retirement —
    // young players have more room to grow than older ones.
    statPotentials: generateStatPotentials(position, stats, age, rng),
    injuryProneness: 0.05 + rng.next() * 0.25
  }
}

// Weighted random position pick.
function pickPosition(rng: RNG): Position {
  return rng.weightedPick(
    POSITION_WEIGHTS.map((p) => p.position),
    POSITION_WEIGHTS.map((p) => p.weight)
  )
}

// Pick a country pool. If a specific country is requested but missing from
// the pool, fall through to a random pool so generation never fails.
function pickPool(rng: RNG, country?: string): CountryNamePool {
  if (country) {
    const found = CARD_NAMES.find((p) => p.country === country)
    if (found) return found
  }
  return rng.pick(CARD_NAMES)
}

// Build a short hex-tagged ID. Not globally unique — callers needing
// uniqueness across batches should namespace via `idPrefix`.
function makeId(rng: RNG, prefix: string): string {
  const stamp = rng.int(0, 0xffffff).toString(16).padStart(6, '0')
  return `${prefix}-${stamp}`
}

// Pick first + last name from a pool, retrying if the combined name is in
// the exclude set. Falls through to a deterministic scan of the pool's
// 144 combinations if the random retries exhaust, and finally a numbered
// suffix if every combination is taken (vanishingly unlikely with our
// pool sizes vs. the 15-card squad use case).
function pickName(rng: RNG, pool: CountryNamePool, exclude?: Set<string>): { firstName: string; lastName: string } {
  for (let attempt = 0; attempt < 20; attempt++) {
    const firstName = rng.pick(pool.firstNames)
    const lastName = rng.pick(pool.lastNames)
    const full = `${firstName} ${lastName}`
    if (!exclude || !exclude.has(full)) {
      exclude?.add(full)
      return { firstName, lastName }
    }
  }
  for (const fn of pool.firstNames) {
    for (const ln of pool.lastNames) {
      const full = `${fn} ${ln}`
      if (!exclude || !exclude.has(full)) {
        exclude?.add(full)
        return { firstName: fn, lastName: ln }
      }
    }
  }
  const firstName = rng.pick(pool.firstNames)
  const lastName = rng.pick(pool.lastNames)
  return { firstName, lastName }
}

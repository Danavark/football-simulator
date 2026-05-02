// Squad factory. Two modes, picked by whether opts.formation is set:
//
//   • Pack-pull mode (formation unset) — the 18-card pack a new user gets:
//     2 GK + a forced 4-back foundation + ST, plus 2 random defenders,
//     6 mids and 3 attackers rolled from random pools. Best-fit formation
//     is auto-detected from whatever rolled.
//
//   • Procedural-team mode (formation set) — used to spawn AI opposition.
//     Cards are generated to fit the supplied formation's slots exactly,
//     plus a 7-card bench covering every line. No best-fit detection — the
//     caller chose the shape.
//
// All squads end up at 18 cards: 11 starters + 7 bench. Total composition
// is 2 GK / 6 DEF / 6 MID / 4 ATT, giving each line one extra body for
// auto-sub coverage during a match and rotation across a season.
//
// Both modes share the same downstream lineup assembly + subs derivation,
// so the public output shape is the same. AI teams default to mixed
// nationalities (each card pulls from a random country pool); pin
// `opts.country` to force a single-nationality squad.

import { generateCard } from '@/generators/card-generator'
import type { StatTier } from '@/generators/card-stats'
import { FORMATION_SLOTS, POSITION_AFFINITY } from '@/consts/engine'
import { computePositionFit } from '@/engine/stats'
import { createRng, type RNG } from '@/lib/rng'
import type { Card, Formation, LineupSlot, Mentality, Position, Squad, Tactics } from '@/types'

// Positions a "midfielder" slot in the pack-pull quota can be filled with.
const MIDFIELD_POSITIONS: Position[] = ['CDM', 'CM', 'CAM', 'LM', 'RM']

// Positions a "wide attacker" slot can be filled with. ST is included so a
// pack can roll 2-3 strikers and lean into a 4-4-2 / 5-3-2 shape.
const ATTACKER_POSITIONS: Position[] = ['LW', 'RW', 'ST']

// Positions the random defenders can land on. Adding CB to the pool gives
// 3-back / 5-back formations a chance to win the fit score; landing on
// LB/RB adds wing depth that suits 4-back shapes.
const DEFENDER_POSITIONS: Position[] = ['CB', 'LB', 'RB']

// Always-present positions in pack-pull mode. We force 2 GK + a 4-back
// foundation (LB, CB, CB, RB) + 1 ST so every pack can at least field a
// 4-back; the 2 extra defenders, 6 midfielders and 3 attackers are then
// rolled randomly so the squad's shape — and best-fit formation — varies
// pack-to-pack.
const FORCED_POSITIONS: Position[] = ['GK', 'GK', 'LB', 'CB', 'CB', 'RB', 'ST']

// Bench composition in procedural-team mode. Same shape regardless of the
// chosen formation — covers a backup at every line plus wide cover. The
// 7-card bench (1 GK + 2 defenders + 2 mids + 2 attackers) means a match
// can survive multiple injuries without going to unrelated-position subs.
const SUB_POSITIONS: Position[] = ['GK', 'CB', 'LB', 'CDM', 'CM', 'ST', 'RW']

export type GenerateSquadOpts = {
  name?: string
  tier?: StatTier
  seed?: number
  // If set, build cards to fit this formation exactly (no auto-detection,
  // no random position rolls). Used to spawn AI teams with chosen shapes.
  formation?: Formation
  // If set, every card uses this country pool. If unset, each card pulls
  // from a random pool (mixed-nationality squad — the default for both
  // pack pulls and procgen AI teams).
  country?: string
  // Default mentality for the resulting Tactics. Defaults to "balanced".
  mentality?: Mentality
  // Override the auto-generated id prefix. Useful when you need stable IDs
  // for a known team (fixtures, league-wide deterministic generation).
  idPrefix?: string
}

export type GeneratedSquad = {
  squad: Squad
  tactics: Tactics
  // Only present in pack-pull mode (formation auto-detected). Maps each
  // formation to the count of starting-11 slots an exact-position card can
  // fill (0–11). Useful for letting the user pick a shape themselves.
  formationScores?: Record<Formation, number>
}

// Generate an 18-card squad. See file header for mode behaviour.
export function generateSquad(opts: GenerateSquadOpts = {}): GeneratedSquad {
  const seed = opts.seed ?? Math.floor(Math.random() * 0xffffffff)
  const rng = createRng(seed)
  const tier = opts.tier ?? 'semipro'
  const name = opts.name ?? `Squad-${seed.toString(16).slice(0, 6)}`
  const idPrefix = opts.idPrefix ?? `s${seed.toString(16).slice(0, 4)}`
  const mentality: Mentality = opts.mentality ?? 'balanced'

  if (opts.formation) {
    return buildProceduralTeam({ name, tier, rng, idPrefix, formation: opts.formation, mentality, country: opts.country })
  }
  return buildPackPull({ name, tier, rng, idPrefix, mentality, country: opts.country })
}

// Pack-pull mode: forced + random positions, then auto-detect best-fit.
function buildPackPull(args: {
  name: string
  tier: StatTier
  rng: RNG
  idPrefix: string
  mentality: Mentality
  country?: string
}): GeneratedSquad {
  const { name, tier, rng, idPrefix, mentality, country } = args
  const cards: Card[] = []
  const excludeNames = new Set<string>()
  const cardOpts = { tier, idPrefix, excludeNames, country }

  for (const pos of FORCED_POSITIONS) {
    cards.push(generateCard(rng, { ...cardOpts, position: pos }))
  }
  // 2 random defenders — supports 5-back formations and gives bench cover.
  for (let i = 0; i < 2; i++) {
    cards.push(generateCard(rng, { ...cardOpts, position: rng.pick(DEFENDER_POSITIONS) }))
  }
  // 6 random midfielders — fills central + wide mid slots across all 7
  // formations; one extra over the legacy 5 gives more variety in best-fit
  // detection and a deeper bench rotation.
  for (let i = 0; i < 6; i++) {
    cards.push(generateCard(rng, { ...cardOpts, position: rng.pick(MIDFIELD_POSITIONS) }))
  }
  // 3 random attackers — covers wing + central attack across all formations.
  for (let i = 0; i < 3; i++) {
    cards.push(generateCard(rng, { ...cardOpts, position: rng.pick(ATTACKER_POSITIONS) }))
  }

  const formationScores = scoreAllFormations(cards)
  const best = pickBestFormation(cards, formationScores, rng)
  const { lineup, subs } = assignLineup(cards, best)

  return {
    squad: { name, cards, lineup, subs },
    tactics: { formation: best, mentality },
    formationScores
  }
}

// Procedural-team mode: build cards directly to formation slots + a fixed
// 4-card bench. Skips formation detection entirely.
function buildProceduralTeam(args: {
  name: string
  tier: StatTier
  rng: RNG
  idPrefix: string
  formation: Formation
  mentality: Mentality
  country?: string
}): GeneratedSquad {
  const { name, tier, rng, idPrefix, formation, mentality, country } = args
  const cards: Card[] = []
  const excludeNames = new Set<string>()
  const cardOpts = { tier, idPrefix, excludeNames, country }

  const startersPositions = FORMATION_SLOTS[formation]
  for (const pos of startersPositions) {
    cards.push(generateCard(rng, { ...cardOpts, position: pos }))
  }
  for (const pos of SUB_POSITIONS) {
    cards.push(generateCard(rng, { ...cardOpts, position: pos }))
  }

  const lineup: LineupSlot[] = cards.slice(0, 11).map((c, i) => ({ slot: i, cardId: c.id }))
  const subs = cards.slice(11)

  return {
    squad: { name, cards, lineup, subs },
    tactics: { formation, mentality }
  }
}

// Score every supported formation by greedy exact-position matching.
function scoreAllFormations(cards: Card[]): Record<Formation, number> {
  const formations = Object.keys(FORMATION_SLOTS) as Formation[]
  const result = {} as Record<Formation, number>
  for (const f of formations) result[f] = scoreFormation(cards, f)
  return result
}

// Walk slot-by-slot and consume the first unused card whose position matches.
// Returns the count of slots filled by exact-position cards (0–11).
function scoreFormation(cards: Card[], formation: Formation): number {
  const used = new Set<string>()
  let score = 0
  for (const wanted of FORMATION_SLOTS[formation]) {
    const match = cards.find((c) => c.position === wanted && !used.has(c.id))
    if (!match) continue
    used.add(match.id)
    score += 1
  }
  return score
}

// Highest exact-match score wins. Ties are broken by simulating
// `assignLineup` for each tied formation and picking the one that yields
// the highest avg position-fit lineup — i.e. the formation whose required
// non-exact slots can still be filled by affinity-ladder cards rather
// than unrelated fallbacks. If still tied (same fit average), a
// deterministic RNG pick decides so two equally-suited formations don't
// always favour the same one.
function pickBestFormation(cards: Card[], scores: Record<Formation, number>, rng: RNG): Formation {
  const entries = Object.entries(scores) as [Formation, number][]
  const max = Math.max(...entries.map(([, s]) => s))
  const tied = entries.filter(([, s]) => s === max).map(([f]) => f)
  if (tied.length === 1) return tied[0]

  // Score each tied formation by its hypothetical lineup's avg fit.
  const fitScores = tied.map((f) => ({ formation: f, fit: lineupFitAvg(cards, f) }))
  const bestFit = Math.max(...fitScores.map((s) => s.fit))
  const bestFitTied = fitScores.filter((s) => s.fit === bestFit).map((s) => s.formation)
  return rng.pick(bestFitTied)
}

// Build the lineup that `assignLineup` would produce for this formation
// and return the avg position-fit across the 11 starters. Used by
// pickBestFormation as a tie-breaker — prefers formations where the
// pack-pull's rolled cards can actually fill the required slots without
// unrelated-position fallbacks.
function lineupFitAvg(cards: Card[], formation: Formation): number {
  const { lineup } = assignLineup(cards, formation)
  const slots = FORMATION_SLOTS[formation]
  const cardById = new Map(cards.map((c) => [c.id, c]))
  let sum = 0
  for (const ls of lineup) {
    const card = cardById.get(ls.cardId)!
    sum += computePositionFit(card.position, slots[ls.slot])
  }
  return lineup.length > 0 ? sum / lineup.length : 0
}

// Assign 11 starters to the chosen formation's slots, putting any leftovers
// on the bench. Pass 1 fills slots with exact-position matches; pass 2 fills
// any remaining slots using the position-affinity ladder so a CDM slot
// prefers a CM over a CB. Pass 3 catches any still-unfilled slot with any
// unused outfielder so the team always fields 11.
function assignLineup(cards: Card[], formation: Formation): { lineup: LineupSlot[]; subs: Card[] } {
  const slots = FORMATION_SLOTS[formation]
  const used = new Set<string>()
  const lineup: LineupSlot[] = []

  for (let slot = 0; slot < slots.length; slot++) {
    const match = cards.find((c) => c.position === slots[slot] && !used.has(c.id))
    if (!match) continue
    used.add(match.id)
    lineup.push({ slot, cardId: match.id })
  }

  for (let slot = 0; slot < slots.length; slot++) {
    if (lineup.find((l) => l.slot === slot)) continue
    const ladder = POSITION_AFFINITY[slots[slot]]
    let filled: Card | undefined
    for (const tier of ladder) {
      filled = cards.find((c) => c.position === tier && !used.has(c.id))
      if (filled) break
    }
    if (!filled) continue
    used.add(filled.id)
    lineup.push({ slot, cardId: filled.id })
  }

  for (let slot = 0; slot < slots.length; slot++) {
    if (lineup.find((l) => l.slot === slot)) continue
    const fill = cards.find((c) => !used.has(c.id) && c.position !== 'GK')
    if (!fill) continue
    used.add(fill.id)
    lineup.push({ slot, cardId: fill.id })
  }

  lineup.sort((a, b) => a.slot - b.slot)
  const subs = cards.filter((c) => !used.has(c.id))
  return { lineup, subs }
}

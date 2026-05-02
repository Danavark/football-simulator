// Generate 30 squads (4–5 per supported formation, with mixed mentalities)
// — all at "mid" tier so card stats are roughly comparable — and play a
// full home+away round-robin (each pair plays twice = 870 matches).
// Prints the league table and a formation-summary aggregate so you can
// see which formation shapes win out when stats are held even.
//
// Usage:
//   npx ts-node src/test/run-formation-season.ts
//   npx ts-node src/test/run-formation-season.ts --seed 42

import { generateCard } from '@/generators/card-generator'
import type { StatTier } from '@/generators/card-stats'
import { FORMATION_SLOTS } from '@/consts/engine'
import { runMatch } from '@/engine/match'
import { createRng } from '@/lib/rng'
import type { Card, Formation, LineupSlot, MatchResult, Mentality, Position, Squad, Tactics } from '@/types'

// Bench composition — backup GK + outfield cover (matches squad-generator's procedural-team mode).
const SUB_POSITIONS: Position[] = ['GK', 'CB', 'CM', 'ST']

// 30 teams across all 7 formations with a mix of mentalities. Distribution
// is 4-5 per formation; mentalities lean toward how each shape is typically
// played (5-back tends defensive, 3-back tends attacking, 4-back is mixed).
type TeamBuild = {
  name: string
  formation: Formation
  mentality: Mentality
}
const TEAMS: TeamBuild[] = [
  // 4-3-3 (5)
  { name: 'Northsea FC', formation: '4-3-3', mentality: 'balanced' },
  { name: 'Vanguard FC', formation: '4-3-3', mentality: 'attacking' },
  { name: 'Skylark United', formation: '4-3-3', mentality: 'balanced' },
  { name: 'Crusaders FC', formation: '4-3-3', mentality: 'attacking' },
  { name: 'Avalanche CF', formation: '4-3-3', mentality: 'balanced' },

  // 4-4-2 (4)
  { name: 'Castile CF', formation: '4-4-2', mentality: 'balanced' },
  { name: 'Foundation FC', formation: '4-4-2', mentality: 'balanced' },
  { name: 'Hammers United', formation: '4-4-2', mentality: 'defensive' },
  { name: 'Steelheart CF', formation: '4-4-2', mentality: 'attacking' },

  // 4-2-3-1 (4)
  { name: 'Bavaria 04', formation: '4-2-3-1', mentality: 'balanced' },
  { name: 'Athletic Praga', formation: '4-2-3-1', mentality: 'balanced' },
  { name: 'Olympia FC', formation: '4-2-3-1', mentality: 'attacking' },
  { name: 'Mercury FC', formation: '4-2-3-1', mentality: 'attacking' },

  // 5-3-2 (4)
  { name: 'Citadel United', formation: '5-3-2', mentality: 'defensive' },
  { name: 'Bastion FC', formation: '5-3-2', mentality: 'defensive' },
  { name: 'Granite CF', formation: '5-3-2', mentality: 'balanced' },
  { name: 'Ironclad FC', formation: '5-3-2', mentality: 'balanced' },

  // 5-4-1 (4)
  { name: 'Iron Wall FC', formation: '5-4-1', mentality: 'defensive' },
  { name: 'Anchor United', formation: '5-4-1', mentality: 'balanced' },
  { name: 'Bulwark FC', formation: '5-4-1', mentality: 'defensive' },
  { name: 'Fortress CF', formation: '5-4-1', mentality: 'balanced' },

  // 3-5-2 (5)
  { name: 'Maestro CF', formation: '3-5-2', mentality: 'balanced' },
  { name: 'Crescendo CF', formation: '3-5-2', mentality: 'attacking' },
  { name: 'Symphony FC', formation: '3-5-2', mentality: 'balanced' },
  { name: 'Cadenza CF', formation: '3-5-2', mentality: 'attacking' },
  { name: 'Resonance FC', formation: '3-5-2', mentality: 'balanced' },

  // 3-4-3 (4)
  { name: 'Bombardiers', formation: '3-4-3', mentality: 'attacking' },
  { name: 'Tempest FC', formation: '3-4-3', mentality: 'attacking' },
  { name: 'Cyclone CF', formation: '3-4-3', mentality: 'balanced' },
  { name: 'Pyrotechnic FC', formation: '3-4-3', mentality: 'attacking' }
]

// Build a 15-card squad fitted exactly to the target formation. Each card
// is generated independently with a random country, so the team has mixed
// nationalities (mirrors how a real club is built from a transfer market).
function generateFormationSquad(
  seed: number,
  name: string,
  formation: Formation,
  mentality: Mentality,
  tier: StatTier
): { squad: Squad; tactics: Tactics } {
  const rng = createRng(seed)
  const idPrefix = `t${seed.toString(16).slice(0, 4)}`
  const slots = FORMATION_SLOTS[formation]
  const cards: Card[] = []
  const excludeNames = new Set<string>()

  for (let i = 0; i < 11; i++) {
    cards.push(generateCard(rng, { position: slots[i], tier, idPrefix, excludeNames }))
  }
  for (const pos of SUB_POSITIONS) {
    cards.push(generateCard(rng, { position: pos, tier, idPrefix, excludeNames }))
  }

  const lineup: LineupSlot[] = cards.slice(0, 11).map((c, i) => ({ slot: i, cardId: c.id }))
  return {
    squad: { name, cards, lineup, subs: cards.slice(11, 15) },
    tactics: { formation, mentality }
  }
}

function parseArgs(): { seed: number } {
  const args = process.argv.slice(2)
  let seed = 42
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10)
      if (!Number.isNaN(n)) seed = n
    }
  }
  return { seed }
}

type Standing = {
  name: string
  formation: Formation
  mentality: Mentality
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

function emptyStanding(t: TeamBuild): Standing {
  return {
    name: t.name,
    formation: t.formation,
    mentality: t.mentality,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0
  }
}

function applyMatch(table: Map<string, Standing>, result: MatchResult): void {
  const home = table.get(result.homeName)!
  const away = table.get(result.awayName)!
  home.played += 1
  away.played += 1
  home.goalsFor += result.score.home
  home.goalsAgainst += result.score.away
  away.goalsFor += result.score.away
  away.goalsAgainst += result.score.home
  if (result.score.home > result.score.away) {
    home.won += 1
    away.lost += 1
    home.points += 3
  } else if (result.score.home < result.score.away) {
    away.won += 1
    home.lost += 1
    away.points += 3
  } else {
    home.drawn += 1
    away.drawn += 1
    home.points += 1
    away.points += 1
  }
}

function sortStandings(rows: Standing[]): Standing[] {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    const aGD = a.goalsFor - a.goalsAgainst
    const bGD = b.goalsFor - b.goalsAgainst
    if (bGD !== aGD) return bGD - aGD
    return b.goalsFor - a.goalsFor
  })
}

function padR(s: string | number, n: number): string {
  return String(s).padEnd(n)
}
function padL(s: string | number, n: number): string {
  return String(s).padStart(n)
}

function main(): void {
  const { seed: seasonSeed } = parseArgs()
  const startedAt = Date.now()

  // Build all 10 squads up-front using deterministic per-team seeds.
  const built = TEAMS.map((t, i) => {
    const teamSeed = (seasonSeed * 7919 + (i + 1) * 1009) >>> 0 || 1
    return {
      build: t,
      ...generateFormationSquad(teamSeed, t.name, t.formation, t.mentality, 'semipro')
    }
  })

  const standings = new Map<string, Standing>()
  for (const t of TEAMS) standings.set(t.name, emptyStanding(t))

  let totalMatches = 0
  let totalGoals = 0

  // Round-robin home + away.
  for (let i = 0; i < built.length; i++) {
    for (let j = 0; j < built.length; j++) {
      if (i === j) continue
      const home = built[i]
      const away = built[j]
      const matchSeed = (seasonSeed * 7919 + (i + 1) * 1009 + (j + 1) * 41) >>> 0 || 1

      const result = runMatch({
        homeSquad: home.squad,
        awaySquad: away.squad,
        homeTactics: home.tactics,
        awayTactics: away.tactics,
        seed: matchSeed
      })

      applyMatch(standings, result)
      totalMatches += 1
      totalGoals += result.score.home + result.score.away
    }
  }

  const ms = Date.now() - startedAt

  console.log(
    `Season seed ${seasonSeed}: played ${totalMatches} matches in ${ms}ms (${(totalGoals / totalMatches).toFixed(2)} goals/match)\n`
  )

  console.log('LEAGUE TABLE')
  console.log('='.repeat(82))
  console.log(
    `${padR('#', 3)} ${padR('Team', 18)} ${padR('Shape', 16)} ${padL('P', 3)} ${padL('W', 3)} ${padL('D', 3)} ${padL('L', 3)} ${padL('GF', 4)} ${padL('GA', 4)} ${padL('GD', 4)} ${padL('Pts', 4)}`
  )
  console.log('-'.repeat(82))
  const sorted = sortStandings([...standings.values()])
  for (let r = 0; r < sorted.length; r++) {
    const s = sorted[r]
    const gd = s.goalsFor - s.goalsAgainst
    const shape = `${s.formation} ${s.mentality.slice(0, 3)}`
    console.log(
      `${padR(r + 1, 3)} ${padR(s.name, 18)} ${padR(shape, 16)} ${padL(s.played, 3)} ${padL(s.won, 3)} ${padL(s.drawn, 3)} ${padL(s.lost, 3)} ${padL(s.goalsFor, 4)} ${padL(s.goalsAgainst, 4)} ${padL(gd >= 0 ? `+${gd}` : `${gd}`, 4)} ${padL(s.points, 4)}`
    )
  }

  // Aggregate by formation so the headline question — "which shape wins?" —
  // is easy to read at a glance.
  console.log('\nFORMATION SUMMARY')
  console.log('='.repeat(72))
  console.log(
    `${padR('Formation', 10)} ${padL('Teams', 6)} ${padL('P', 4)} ${padL('W', 4)} ${padL('D', 4)} ${padL('L', 4)} ${padL('GF', 5)} ${padL('GA', 5)} ${padL('Pts', 4)} ${padL('PPG', 5)}`
  )
  console.log('-'.repeat(72))

  const byFormation = new Map<
    Formation,
    { teams: number; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; points: number }
  >()
  for (const s of sorted) {
    const k = s.formation
    const acc = byFormation.get(k) ?? { teams: 0, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }
    acc.teams += 1
    acc.played += s.played
    acc.won += s.won
    acc.drawn += s.drawn
    acc.lost += s.lost
    acc.gf += s.goalsFor
    acc.ga += s.goalsAgainst
    acc.points += s.points
    byFormation.set(k, acc)
  }
  const formationOrder: Formation[] = ['4-3-3', '4-4-2', '4-2-3-1', '5-3-2', '5-4-1', '3-5-2', '3-4-3']
  const sortedFormations = formationOrder
    .filter((f) => byFormation.has(f))
    .map((f) => ({ formation: f, ...byFormation.get(f)! }))
    .sort((a, b) => b.points / b.played - a.points / a.played)

  for (const f of sortedFormations) {
    const ppg = f.played > 0 ? (f.points / f.played).toFixed(2) : '-'
    console.log(
      `${padR(f.formation, 10)} ${padL(f.teams, 6)} ${padL(f.played, 4)} ${padL(f.won, 4)} ${padL(f.drawn, 4)} ${padL(f.lost, 4)} ${padL(f.gf, 5)} ${padL(f.ga, 5)} ${padL(f.points, 4)} ${padL(ppg, 5)}`
    )
  }
}

main()

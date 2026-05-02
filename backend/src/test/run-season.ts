// Round-robin season simulator: every team plays every other team home + away.
// Outputs final league table + top scorers + season totals.
//
// Usage:
//   npx ts-node src/test/run-season.ts
//   npx ts-node src/test/run-season.ts --seed 42

import { LEAGUE_TEAMS } from '@/test/fixtures/league-teams'
import { runMatch } from '@/engine/match'
import type { MatchResult } from '@/types'

// Read --seed from argv (used as a season-level salt). If omitted, a
// random seed is rolled per run so the league plays out differently each
// time. The chosen seed is logged so you can replay a specific season.
function parseArgs(): { seed: number } {
  const args = process.argv.slice(2)
  let seed: number | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10)
      if (!Number.isNaN(n)) seed = n
    }
  }
  if (seed === null) seed = Math.floor(Math.random() * 0xffffffff)
  return { seed }
}

// One row of the league table.
type Standing = {
  name: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

function emptyStanding(name: string): Standing {
  return {
    name,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0
  }
}

// Apply a match result to both teams' rows in the table.
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

// Standard football table sort: points → goal difference → goals for.
function sortStandings(rows: Standing[]): Standing[] {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    const aGD = a.goalsFor - a.goalsAgainst
    const bGD = b.goalsFor - b.goalsAgainst
    if (bGD !== aGD) return bGD - aGD
    return b.goalsFor - a.goalsFor
  })
}

// Pad helpers — left-aligned for labels, right-aligned for numbers.
function padR(s: string | number, n: number): string {
  return String(s).padEnd(n)
}
function padL(s: string | number, n: number): string {
  return String(s).padStart(n)
}

function main(): void {
  const { seed: seasonSeed } = parseArgs()
  const teams = LEAGUE_TEAMS
  const startedAt = Date.now()

  const standings = new Map<string, Standing>()
  for (const t of teams) standings.set(t.squad.name, emptyStanding(t.squad.name))

  // cardId-keyed (with team prefix) so identically-named players don't collide.
  const scorers = new Map<
    string,
    { name: string; team: string; goals: number; assists: number; rating: number; appearances: number }
  >()

  let totalMatches = 0
  let totalGoals = 0

  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue
      const home = teams[i]
      const away = teams[j]
      // Mix in season seed so a different --seed gives a different season.
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

      // Track player goals/assists/rating across the whole season.
      for (const ps of result.playerSummaries) {
        if (ps.minutesPlayed === 0) continue
        const teamName = ps.team === 'home' ? result.homeName : result.awayName
        const key = `${teamName}::${ps.cardId}`
        const existing = scorers.get(key) ?? {
          name: ps.name,
          team: teamName,
          goals: 0,
          assists: 0,
          rating: 0,
          appearances: 0
        }
        existing.goals += ps.goals
        existing.assists += ps.assists
        existing.rating += ps.matchRating
        existing.appearances += 1
        scorers.set(key, existing)
      }
    }
  }

  const ms = Date.now() - startedAt

  console.log(
    `Played ${totalMatches} matches in ${ms}ms (${(totalGoals / totalMatches).toFixed(2)} goals/match) — seed ${seasonSeed}\n`
  )
  console.log('LEAGUE TABLE')
  console.log('='.repeat(72))
  console.log(
    `${padR('#', 3)} ${padR('Team', 22)} ${padL('P', 3)} ${padL('W', 3)} ${padL('D', 3)} ${padL('L', 3)} ${padL('GF', 4)} ${padL('GA', 4)} ${padL('GD', 4)} ${padL('Pts', 4)}`
  )
  console.log('-'.repeat(72))
  const sorted = sortStandings([...standings.values()])
  for (let r = 0; r < sorted.length; r++) {
    const s = sorted[r]
    const gd = s.goalsFor - s.goalsAgainst
    console.log(
      `${padR(r + 1, 3)} ${padR(s.name, 22)} ${padL(s.played, 3)} ${padL(s.won, 3)} ${padL(s.drawn, 3)} ${padL(s.lost, 3)} ${padL(s.goalsFor, 4)} ${padL(s.goalsAgainst, 4)} ${padL(gd >= 0 ? `+${gd}` : `${gd}`, 4)} ${padL(s.points, 4)}`
    )
  }

  console.log('\nTOP SCORERS')
  console.log('='.repeat(72))
  console.log(`${padR('Player', 24)} ${padR('Team', 22)} ${padL('G', 3)} ${padL('A', 3)} ${padL('Avg', 5)}`)
  console.log('-'.repeat(72))
  const topScorers = [...scorers.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists)
  for (const p of topScorers.slice(0, 15)) {
    const avg = p.appearances > 0 ? (p.rating / p.appearances).toFixed(1) : '-'
    console.log(`${padR(p.name, 24)} ${padR(p.team, 22)} ${padL(p.goals, 3)} ${padL(p.assists, 3)} ${padL(avg, 5)}`)
  }
}

main()

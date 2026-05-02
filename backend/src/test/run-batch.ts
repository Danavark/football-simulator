// Run N matches and print aggregate distribution stats vs. spec targets.
//
// Usage:
//   npx ts-node src/test/run-batch.ts --count 1000

import { testHome, testAway, testHomeTactics, testAwayTactics } from '~/test/fixtures/test-teams'
import { runMatch } from '~/engine/match'

// Read --count from argv, default 1000.
function parseArgs(): { count: number } {
  const args = process.argv.slice(2)
  let count = 1000
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[i + 1], 10)
    }
  }
  if (!count || Number.isNaN(count) || count < 1) count = 1000
  return { count }
}

// Aggregate counters across all matches in the batch.
type Bucket = {
  matches: number
  totalGoalsHome: number
  totalGoalsAway: number
  homeWins: number
  awayWins: number
  draws: number
  cleanSheets: number
  fouls: number
  yellowCards: number
  redCards: number
  directReds: number
  secondYellows: number
  injuries: number
  penalties: number
  corners: number
  chances: number
  goals: number
}

// Fresh bucket with everything zeroed.
function newBucket(): Bucket {
  return {
    matches: 0,
    totalGoalsHome: 0,
    totalGoalsAway: 0,
    homeWins: 0,
    awayWins: 0,
    draws: 0,
    cleanSheets: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    directReds: 0,
    secondYellows: 0,
    injuries: 0,
    penalties: 0,
    corners: 0,
    chances: 0,
    goals: 0
  }
}

// Format helpers for the batch output.
function fmt(n: number, digits = 2): string {
  return n.toFixed(digits)
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%'
  return ((n / total) * 100).toFixed(1) + '%'
}

// Render a numeric average against an inclusive [low, high] target band.
function range(label: string, value: number, low: number, high: number): string {
  const inRange = value >= low && value <= high
  const flag = inRange ? '✅' : value < low ? '⬇' : '⬆'
  return `${label}: ${fmt(value)} (target ${low}–${high}) ${flag}`
}

// Render a count-as-percentage of a total against a target band.
function rangePct(label: string, value: number, total: number, low: number, high: number): string {
  const p = total === 0 ? 0 : (value / total) * 100
  const inRange = p >= low && p <= high
  const flag = inRange ? '✅' : p < low ? '⬇' : '⬆'
  return `${label}: ${p.toFixed(1)}% (target ${low}–${high}%) ${flag}`
}

// Render rare events as "1 per N matches" against a target frequency band.
function rangePer(label: string, value: number, matches: number, lowEvery: number, highEvery: number): string {
  // value events / matches → 1 every (matches/value). Compare to lowEvery..highEvery
  if (value === 0) {
    return `${label}: never seen across ${matches} matches`
  }
  const per = matches / value
  const inRange = per >= lowEvery && per <= highEvery
  const flag = inRange ? '✅' : per < lowEvery ? '⬆ (too frequent)' : '⬇ (too rare)'
  return `${label}: 1 per ${per.toFixed(1)} matches (target 1 per ${lowEvery}–${highEvery}) ${flag}`
}

// Run N matches, accumulate aggregate counters, print distributions
// vs. the spec's target bands.
function main() {
  const { count } = parseArgs()
  const b = newBucket()
  const startedAt = Date.now()

  for (let i = 0; i < count; i++) {
    const seed = (Math.random() * 0xffffffff) >>> 0
    const r = runMatch({
      homeSquad: testHome,
      awaySquad: testAway,
      homeTactics: testHomeTactics,
      awayTactics: testAwayTactics,
      seed
    })
    b.matches += 1
    b.totalGoalsHome += r.score.home
    b.totalGoalsAway += r.score.away
    if (r.score.home > r.score.away) b.homeWins += 1
    else if (r.score.away > r.score.home) b.awayWins += 1
    else b.draws += 1
    if (r.score.away === 0) b.cleanSheets += 1
    if (r.score.home === 0) b.cleanSheets += 1
    b.fouls += r.totals.fouls
    b.yellowCards += r.totals.yellowCards
    b.redCards += r.totals.redCards
    for (const ev of r.beats) {
      if (ev.foulDetail?.card === 'red') b.directReds += 1
      if (ev.foulDetail?.card === 'second_yellow') b.secondYellows += 1
    }
    b.injuries += r.totals.injuries
    b.penalties += r.totals.penalties
    b.corners += r.totals.corners
    b.chances += r.totals.chancesCreated
    b.goals += r.score.home + r.score.away
  }

  const ms = Date.now() - startedAt
  console.log(`Ran ${b.matches} matches in ${ms}ms (${(ms / b.matches).toFixed(2)}ms/match)\n`)

  console.log('Aggregate stats vs. spec targets:')
  console.log('-'.repeat(60))
  console.log(range('Avg goals per match', b.goals / b.matches, 2.5, 2.8))
  // Clean sheets are measured per team-game (2 per match), since 25% of
  // matches having a CS is impossible at the spec's 2.5+ goals per match.
  console.log(rangePct('Clean sheets (per team-game)', b.cleanSheets, b.matches * 2, 20, 25))
  console.log(rangePct('Draws', b.draws, b.matches, 20, 28))
  console.log(range('Fouls per match', b.fouls / b.matches, 20, 26))
  console.log(range('Yellow cards per match', b.yellowCards / b.matches, 3, 5))
  console.log(rangePer('Red cards', b.redCards, b.matches, 8, 12))
  console.log(`  (direct reds: ${b.directReds}, second yellows: ${b.secondYellows})`)
  console.log(rangePer('Injuries', b.injuries, b.matches, 5, 8))
  console.log(rangePer('Penalties', b.penalties, b.matches, 10, 15))
  console.log(range('Corners per match', b.corners / b.matches, 4, 12))
  console.log(range('Chances per match', b.chances / b.matches, 4, 8))

  console.log('\nResults breakdown:')
  console.log('-'.repeat(60))
  console.log(
    `  Home wins: ${b.homeWins} (${pct(b.homeWins, b.matches)})\n  Draws:     ${b.draws} (${pct(
      b.draws,
      b.matches
    )})\n  Away wins: ${b.awayWins} (${pct(b.awayWins, b.matches)})`
  )
  console.log(
    `  Avg score: ${(b.totalGoalsHome / b.matches).toFixed(2)} - ${(b.totalGoalsAway / b.matches).toFixed(2)}`
  )
}

main()

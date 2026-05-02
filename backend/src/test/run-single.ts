// Run a single match, print beat-by-beat log + final score + summaries.
//
// Usage:
//   npx ts-node src/test/run-single.ts --seed 12345
//   npx ts-node src/test/run-single.ts --live           (default 1500ms/beat)
//   npx ts-node src/test/run-single.ts --live --speed 800
//   npx ts-node src/test/run-single.ts --live --pause   (pauses on goals/HT/red/injury)
//   npx ts-node src/test/run-single.ts --live --pause --scenario sub
//   npx ts-node src/test/run-single.ts --live --pause --scenario mentality
//   npx ts-node src/test/run-single.ts --live --pause --scenario formation

import { testHome, testAway, testHomeTactics, testAwayTactics } from '~/test/fixtures/test-teams'
import { type Commentator, createCommentator } from '~/commentary'
import { SIM_CONSTANTS } from '~/consts/engine'
import { runMatch, runMatchLive, runMatchPausable } from '~/engine/match'
import { suggestLineup } from '~/engine/decisions'
import { commonPauseTriggers } from '~/engine/triggers'
import { createRng } from '~/lib/rng'
import type {
  Card,
  Formation,
  MatchDecisions,
  MatchInput,
  MatchResult,
  BeatResult,
  PauseCheckpoint,
  PlayerMatchState,
  Side,
  Squad
} from '~/types'

type Scenario = 'none' | 'sub' | 'mentality' | 'formation'

type Args = {
  seed: number
  live: boolean
  speedMs: number
  randomFitness: boolean
  pause: boolean
  scenario: Scenario
  userSide: Side
}

// Read --seed, --live, --speed, --random-fitness from argv.
//   --random-fitness rolls each player's starting fitness in 60–90%, using
//   the match seed (offset) so it's reproducible per seed. Models a
//   mid-season scenario where no one starts fresh.
function parseArgs(): Args {
  const args = process.argv.slice(2)
  let seed = 0
  let live = false
  let speedMs = 5000
  let randomFitness = false
  let pause = false
  let scenario: Scenario = 'none'
  let userSide: Side = 'home'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      seed = parseInt(args[i + 1], 10)
    } else if (args[i] === '--live') {
      live = true
    } else if (args[i] === '--speed' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10)
      if (!Number.isNaN(n) && n > 0) speedMs = n
    } else if (args[i] === '--random-fitness') {
      randomFitness = true
    } else if (args[i] === '--pause') {
      pause = true
    } else if (args[i] === '--scenario' && args[i + 1]) {
      scenario = args[i + 1] as Scenario
    } else if (args[i] === '--user-side' && args[i + 1]) {
      userSide = args[i + 1] as Side
    }
  }
  if (!seed || Number.isNaN(seed)) {
    seed = Math.floor(Math.random() * 0xffffffff)
  }
  return { seed, live, speedMs, randomFitness, pause, scenario, userSide }
}

// Roll a per-card fitness map in [min, max] using a derived RNG so the
// same seed reproduces the same starting fitness. Engine seed is XOR'd
// with a salt so this RNG is independent of the match RNG (changing the
// fitness band wouldn't disturb the match outcome at the same seed).
function rollFitness(
  home: Squad,
  away: Squad,
  seed: number,
  min = 60,
  max = 90
): MatchInput['fitness'] {
  const rng = createRng((seed ^ 0xf17e5511) >>> 0)
  const map = (squad: Squad): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const c of squad.cards) out[c.id] = rng.int(min, max)
    return out
  }
  return { home: map(home), away: map(away) }
}

// Sleep for n ms — used to pace live mode.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Right-pad a value to a fixed width for table-like output.
function pad(s: string | number, n: number): string {
  return String(s).padEnd(n, ' ')
}

// "left_wing" → "left wing".
function formatZone(z: string): string {
  return z.replace('_', ' ')
}

// Flat mean of all 8 stats — same definition used by run-squad / run-card
// so overall numbers are comparable across CLIs.
function overall(card: Card): number {
  const s = card.stats
  return Math.round(
    (s.pace + s.shooting + s.passing + s.dribbling + s.defending + s.physicality + s.positioning + s.stamina) / 8
  )
}

// Average overall across the starting 11 — a quick proxy for team quality
// that helps gauge whether a lopsided match was actually surprising.
function teamOverall(squad: Squad): number {
  let total = 0
  let count = 0
  for (const slot of squad.lineup) {
    const card = squad.cards.find((c) => c.id === slot.cardId)
    if (!card) continue
    total += overall(card)
    count += 1
  }
  return count > 0 ? Math.round(total / count) : 0
}

// Average starting-XI fitness, derived from a per-card input map. Defaults
// to 100 for any card not present (which is everything until DB integration
// passes real account state in via MatchInput.fitness).
function startingFitness(squad: Squad, fitnessMap?: Record<string, number>): number {
  let total = 0
  let count = 0
  for (const slot of squad.lineup) {
    total += fitnessMap?.[slot.cardId] ?? 100
    count += 1
  }
  return count > 0 ? Math.round(total / count) : 100
}

// Print the match header (teams + overall + fitness + seed). Weather is
// shown post-match since live mode doesn't know it until the first beat.
function printMatchHeader(
  home: Squad,
  away: Squad,
  seed: number,
  fitness?: { home: Record<string, number>; away: Record<string, number> }
): void {
  const homeFit = startingFitness(home, fitness?.home)
  const awayFit = startingFitness(away, fitness?.away)
  console.log('='.repeat(72))
  console.log(
    `MATCH: ${home.name} (Ovr ${teamOverall(home)} / Fit ${homeFit}%) vs ${away.name} (Ovr ${teamOverall(away)} / Fit ${awayFit}%)`
  )
  console.log(`Seed:  ${seed}`)
  console.log('='.repeat(72))
}

// Print one beat: separator, header line, prose from the commentator.
function printBeat(
  ev: BeatResult,
  home: Squad,
  away: Squad,
  runningHome: number,
  runningAway: number,
  commentator: Commentator
): void {
  const header = `Beat ${pad(ev.beat, 2)} | ${pad(ev.minute + "'", 4)} | ${pad(
    ev.attackingTeam === 'home' ? home.name : away.name,
    18
  )} | ${pad(formatZone(ev.zone), 12)} | ${pad(ev.outcome, 8)} | mom=${pad(
    ev.momentum.toFixed(1),
    6
  )} | ${runningHome}-${runningAway}`
  console.log('-'.repeat(72))
  console.log(header)
  const lines = commentator.beat(ev, home, away)
  if (lines.length > 0) console.log(lines.join('\n'))
}

// Print the FULL TIME banner.
function printFullTime(result: MatchResult): void {
  console.log('='.repeat(72))
  console.log(`FULL TIME: ${result.homeName} ${result.score.home} - ${result.score.away} ${result.awayName}`)
  console.log('='.repeat(72))
}

// Render an ASCII bar split between two values (left vs. right).
// Width is the total bar width in characters.
function statBar(left: number, right: number, width = 30): string {
  const total = left + right
  if (total === 0) return ' '.repeat(width)
  const leftFill = Math.round((left / total) * width)
  const rightFill = width - leftFill
  return '█'.repeat(leftFill) + '░'.repeat(rightFill)
}

// Print a per-team match stats panel modeled on the UI mockup.
function printMatchStats(result: MatchResult): void {
  const h = result.teamTotals.home
  const a = result.teamTotals.away
  const homeName = result.homeName
  const awayName = result.awayName

  console.log('\n' + '='.repeat(72))
  console.log('MATCH STATS'.padStart(40))
  console.log('='.repeat(72))
  console.log(`${pad(homeName, 24)}    ${pad(awayName.padStart(24), 24)}`)

  const row = (label: string, lh: number | string, rh: number | string, bar?: string) => {
    const left = pad(String(lh), 6)
    const right = String(rh).padStart(6)
    const mid = pad(label, 18)
    console.log(`${left}  ${mid.padStart(28)}  ${right}`)
    if (bar) console.log(`        ${bar}`)
  }

  row('Possession', `${h.possessionPct}%`, `${a.possessionPct}%`, statBar(h.possessionPct, a.possessionPct))
  row('Total Shots', h.shots, a.shots, statBar(h.shots, a.shots))
  row('On Target', h.shotsOnTarget, a.shotsOnTarget, statBar(h.shotsOnTarget, a.shotsOnTarget))
  row('Off Target', h.shotsOffTarget, a.shotsOffTarget, statBar(h.shotsOffTarget, a.shotsOffTarget))
  row('Corners', h.corners, a.corners, statBar(h.corners, a.corners))
  row('Free Kicks', h.freeKicks, a.freeKicks, statBar(h.freeKicks, a.freeKicks))
  row('Penalties', h.penalties, a.penalties, statBar(h.penalties, a.penalties))
  row('Fouls', h.fouls, a.fouls, statBar(h.fouls, a.fouls))
  row('Yellow Cards', h.yellowCards, a.yellowCards, statBar(h.yellowCards, a.yellowCards))
  row('Red Cards', h.redCards, a.redCards, statBar(h.redCards, a.redCards))
  console.log('='.repeat(72))
}

// Static (non-live) full log: match runs internally, then we replay events.
function printBeatLog(result: MatchResult, fitness?: MatchInput['fitness']): void {
  const home = testHome
  const away = testAway
  printMatchHeader(home, away, result.seed, fitness)

  const commentator = createCommentator(result.seed)
  console.log(commentator.openMatch(result.homeName, result.awayName, result.weather).join('\n'))

  let runningHome = 0
  let runningAway = 0
  let halftimeShown = false
  for (const ev of result.beats) {
    // Half-time prose appears between halves — fires before the first
    // beat of the second half, after the running score has been
    // updated for any first-half goals.
    if (!halftimeShown && ev.minute >= 46) {
      halftimeShown = true
      console.log('='.repeat(72))
      console.log(`HALF TIME: ${home.name} ${runningHome} - ${runningAway} ${away.name}`)
      console.log(commentator.halfTime(home.name, away.name, { home: runningHome, away: runningAway }).join('\n'))
      console.log('='.repeat(72))
    }
    if (ev.chanceDetail?.goal) {
      if (ev.attackingTeam === 'home') runningHome += 1
      else runningAway += 1
    }
    if (ev.foulDetail?.setPieceResult?.goal) {
      if (ev.attackingTeam === 'home') runningHome += 1
      else runningAway += 1
    }
    printBeat(ev, home, away, runningHome, runningAway, commentator)
  }

  printFullTime(result)
  console.log(commentator.fullTime(result).join('\n'))
}

// Print per-team summary tables and aggregate match totals.
function printSummaries(result: MatchResult, home: Squad, away: Squad): void {
  function bySide(side: Side) {
    return result.playerSummaries.filter((p) => p.team === side)
  }
  // Avg of starting-XI startFitness — what the team came into the match
  // with. With no MatchInput.fitness passed in, this is just 100 across
  // the board (defaults). Once DB integration lands, it'll reflect real
  // season state.
  function teamFitness(side: Side): number {
    const onPitchIds = new Set((side === 'home' ? home : away).lineup.map((l) => l.cardId))
    const starters = bySide(side).filter((p) => onPitchIds.has(p.cardId))
    if (starters.length === 0) return 100
    return Math.round(starters.reduce((a, p) => a + p.startFitness, 0) / starters.length)
  }
  function printSquad(squad: Squad, side: Side) {
    console.log(`\n${squad.name} (Ovr ${teamOverall(squad)} / Fit ${teamFitness(side)}%)`)
    console.log(
      `${pad('Pos', 4)} ${pad('Player', 22)} ${pad('Ovr', 4)} ${pad('Min', 4)} ${pad(
        'Fit',
        9
      )} ${pad('Rate', 5)} ${pad('G', 2)} ${pad('A', 2)} ${pad('F', 2)} ${pad('Y', 2)} ${pad('R', 2)} Inj`
    )
    // Show "-" for any zero count so the eye can scan to the meaningful values.
    const dash0 = (n: number): string | number => (n === 0 ? '-' : n)
    for (const p of bySide(side)) {
      const dnp = p.minutesPlayed === 0 // did not play
      const card = squad.cards.find((c) => c.id === p.cardId)
      const ovr = card ? overall(card) : 0
      const fit = `${p.startFitness.toFixed(0)}->${p.endFitness.toFixed(0)}`
      console.log(
        `${pad(p.position, 4)} ${pad(p.name, 22)} ${pad(ovr, 4)} ${pad(dash0(p.minutesPlayed), 4)} ${pad(
          fit,
          9
        )} ${pad(dnp ? '-' : p.matchRating.toFixed(1), 5)} ${pad(dash0(p.goals), 2)} ${pad(
          dash0(p.assists),
          2
        )} ${pad(dash0(p.foulsCommitted), 2)} ${pad(
          dash0(p.yellowCards),
          2
        )} ${pad(p.redCard ? 'Y' : '-', 2)} ${p.injured ? 'Y' : '-'}`
      )
    }
  }
  printSquad(home, 'home')
  printSquad(away, 'away')

  console.log('\nMatch totals:')
  console.log(`  Weather:         ${result.weather}`)
  console.log(`  Chances created: ${result.totals.chancesCreated}`)
  console.log(`  Fouls:           ${result.totals.fouls}`)
  console.log(`  Yellow cards:    ${result.totals.yellowCards}`)
  console.log(`  Red cards:       ${result.totals.redCards}`)
  console.log(`  Injuries:        ${result.totals.injuries}`)
  console.log(`  Corners (foul):  ${result.totals.corners}`)
  console.log(`  Penalties:       ${result.totals.penalties}`)
}

// Live runner: print each beat as it's processed, with a sleep between
// beats to pace it. Marks the half-time break.
async function runLive(seed: number, speedMs: number, fitness?: MatchInput['fitness']): Promise<void> {
  const home = testHome
  const away = testAway

  printMatchHeader(home, away, seed, fitness)
  console.log(`(live: ${speedMs}ms per beat — Ctrl-C to abort)\n`)

  const commentator = createCommentator(seed)
  let runningHome = 0
  let runningAway = 0
  let halftimeShown = false
  let openerShown = false

  const result = await runMatchLive(
    {
      homeSquad: home,
      awaySquad: away,
      homeTactics: testHomeTactics,
      awayTactics: testAwayTactics,
      seed,
      fitness
    },
    async (ev, state) => {
      // Opener prose fires once, on the first beat — that's the earliest
      // point at which the engine has rolled the weather.
      if (!openerShown) {
        openerShown = true
        console.log(commentator.openMatch(home.name, away.name, state.config.weather).join('\n'))
      }
      if (ev.chanceDetail?.goal) {
        if (ev.attackingTeam === 'home') runningHome += 1
        else runningAway += 1
      }
      if (ev.foulDetail?.setPieceResult?.goal) {
        if (ev.attackingTeam === 'home') runningHome += 1
        else runningAway += 1
      }
      printBeat(ev, home, away, runningHome, runningAway, commentator)
      // Show a half-time break right after the half-time beat resolves.
      if (!halftimeShown && ev.beat >= SIM_CONSTANTS.HALFTIME_BEAT) {
        halftimeShown = true
        console.log('='.repeat(72))
        console.log(`HALF TIME: ${home.name} ${runningHome} - ${runningAway} ${away.name}`)
        console.log(commentator.halfTime(home.name, away.name, { home: runningHome, away: runningAway }).join('\n'))
        console.log('='.repeat(72))
        await sleep(speedMs * 2)
        return
      }
      await sleep(speedMs)
    }
  )

  printFullTime(result)
  console.log(commentator.fullTime(result).join('\n'))
  printMatchStats(result)
  printSummaries(result, home, away)
}

// Live + pausable runner — same paced printing as runLive, but routed
// through runMatchPausable with the default trigger predicate. Pauses
// print a banner and wait for an extra hold before resuming. When
// `--scenario` is set, decisions fire on the natural trigger (HT for
// mentality/formation, first eligible pause for sub) and print a note
// describing what changed.
async function runLivePausable(
  seed: number,
  speedMs: number,
  scenario: Scenario,
  userSide: Side,
  fitness?: MatchInput['fitness']
): Promise<void> {
  const home = testHome
  const away = testAway

  printMatchHeader(home, away, seed, fitness)
  console.log(`(live: ${speedMs}ms per beat, pause-mode on, scenario=${scenario}, userSide=${userSide} — Ctrl-C to abort)\n`)

  const commentator = createCommentator(seed)
  let runningHome = 0
  let runningAway = 0
  let halftimeShown = false
  let openerShown = false

  const decide = makeDecisionMaker(scenario, userSide)

  const input: MatchInput = {
    homeSquad: home,
    awaySquad: away,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed,
    fitness,
    userSide,
    shouldPause: commonPauseTriggers({ userSide })
  }

  const gen = runMatchPausable(input, {
    onBeat: async (ev, state) => {
      if (!openerShown) {
        openerShown = true
        console.log(commentator.openMatch(home.name, away.name, state.config.weather).join('\n'))
      }
      if (ev.chanceDetail?.goal) {
        if (ev.attackingTeam === 'home') runningHome += 1
        else runningAway += 1
      }
      if (ev.foulDetail?.setPieceResult?.goal) {
        if (ev.attackingTeam === 'home') runningHome += 1
        else runningAway += 1
      }
      printBeat(ev, home, away, runningHome, runningAway, commentator)
      // Half-time prose still fires off the live-mode beat threshold so
      // it sits between the beats just like the non-pausable runner.
      if (!halftimeShown && ev.beat >= SIM_CONSTANTS.HALFTIME_BEAT) {
        halftimeShown = true
        console.log('='.repeat(72))
        console.log(`HALF TIME: ${home.name} ${runningHome} - ${runningAway} ${away.name}`)
        console.log(commentator.halfTime(home.name, away.name, { home: runningHome, away: runningAway }).join('\n'))
        console.log('='.repeat(72))
        await sleep(speedMs * 2)
        return
      }
      await sleep(speedMs)
    }
  })

  let r = await gen.next()
  while (!r.done) {
    const cp = r.value
    console.log('-'.repeat(72))
    console.log(`▮▮ PAUSED: ${cp.reason}  (beat ${cp.state.beat} · ${cp.state.minute}')  side=${cp.side ?? '-'}`)
    const { decisions, note } = decide(cp)
    if (note) console.log(`        ${note}`)
    await sleep(speedMs)
    r = await gen.next(decisions)
  }

  const result = r.value
  printFullTime(result)
  console.log(commentator.fullTime(result).join('\n'))
  printMatchStats(result)
  printSummaries(result, home, away)
}

function ownSquadFromCp(cp: PauseCheckpoint, side: Side): Squad {
  return side === 'home' ? cp.state.homeSquad : cp.state.awaySquad
}

function ownPlayersFromCp(cp: PauseCheckpoint, side: Side): PlayerMatchState[] {
  return side === 'home' ? cp.state.players.home : cp.state.players.away
}

function pickSubPair(cp: PauseCheckpoint, side: Side): { off: string; on: string } | null {
  const squad = ownSquadFromCp(cp, side)
  const players = ownPlayersFromCp(cp, side)
  const benchPlayer = players.find((p) => !p.isOnPitch && !p.isInjured && !p.redCard)
  if (!benchPlayer) return null
  const offSlot = squad.lineup.find((l) => l.slot === 10)
  if (!offSlot) return null
  return { off: offSlot.cardId, on: benchPlayer.cardId }
}

function nameFromCp(cp: PauseCheckpoint, cardId: string): string {
  const home = cp.state.homeSquad.cards.find((c) => c.id === cardId)
  if (home) return home.name
  return cp.state.awaySquad.cards.find((c) => c.id === cardId)?.name ?? 'unknown'
}

// Build the decisions payload for a given pause based on the chosen
// scenario. Each scenario fires once at its natural trigger and then
// resumes future pauses with `{}`.
function makeDecisionMaker(
  scenario: Scenario,
  side: Side
): (cp: PauseCheckpoint) => { decisions: MatchDecisions; note: string } {
  let done = false
  return (cp) => {
    if (done || scenario === 'none' || cp.side !== side) {
      return { decisions: {}, note: '' }
    }

    if (scenario === 'sub') {
      const pair = pickSubPair(cp, side)
      if (!pair) return { decisions: {}, note: '(no eligible bench)' }
      done = true
      return {
        decisions: { subs: [pair] },
        note: `→ SUB: ${nameFromCp(cp, pair.off)} OFF, ${nameFromCp(cp, pair.on)} ON`
      }
    }

    if (scenario === 'mentality') {
      if (cp.reason !== 'half_time') return { decisions: {}, note: '' }
      done = true
      return { decisions: { mentality: 'attacking' }, note: '→ MENTALITY: attacking' }
    }

    if (scenario === 'formation') {
      if (cp.reason !== 'half_time') return { decisions: {}, note: '' }
      const tactics = side === 'home' ? cp.state.homeTactics : cp.state.awayTactics
      const next: Formation = tactics.formation === '4-3-3' ? '4-4-2' : '4-3-3'
      try {
        const lineup = suggestLineup(ownSquadFromCp(cp, side), next, ownPlayersFromCp(cp, side))
        done = true
        return { decisions: { formation: next, lineup }, note: `→ FORMATION: ${tactics.formation} → ${next}` }
      } catch (e) {
        return { decisions: {}, note: `(formation skip: ${(e as Error).message})` }
      }
    }

    return { decisions: {}, note: '' }
  }
}

// Static runner: run the whole match, then replay the log instantly.
function runStatic(seed: number, fitness?: MatchInput['fitness']): void {
  const result = runMatch({
    homeSquad: testHome,
    awaySquad: testAway,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed,
    fitness
  })
  printBeatLog(result, fitness)
  printMatchStats(result)
  printSummaries(result, testHome, testAway)
}

async function main(): Promise<void> {
  const { seed, live, speedMs, randomFitness, pause, scenario, userSide } = parseArgs()
  const fitness = randomFitness ? rollFitness(testHome, testAway, seed) : undefined
  if (live && pause) {
    await runLivePausable(seed, speedMs, scenario, userSide, fitness)
  } else if (live) {
    await runLive(seed, speedMs, fitness)
  } else {
    runStatic(seed, fitness)
  }
}

main()

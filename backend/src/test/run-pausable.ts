// Demo runner for the pause/decision system. Iterates runMatchPausable as
// an async generator, prints each PauseCheckpoint, and resumes with a
// scenario-driven decision payload — so you can exercise every seam of
// applyDecisions from the CLI without editing this file.
//
// Usage:
//   npx ts-node src/test/run-pausable.ts --seed 12345
//   npx ts-node src/test/run-pausable.ts --scenario sub
//   npx ts-node src/test/run-pausable.ts --scenario mentality --user-side away
//   npx ts-node src/test/run-pausable.ts --scenario formation --seed 12345

import { testHome, testAway, testHomeTactics, testAwayTactics } from '~/test/fixtures/test-teams'
import { commonPauseTriggers } from '~/engine/triggers'
import { runMatchPausable } from '~/engine/match'
import { suggestLineup } from '~/engine/decisions'
import type {
  Formation,
  MatchDecisions,
  MatchInput,
  PauseCheckpoint,
  PlayerMatchState,
  Side,
  Squad
} from '~/types'

type Scenario = 'none' | 'sub' | 'mentality' | 'formation'

function parseArgs(): { seed: number; userSide: Side; scenario: Scenario } {
  const args = process.argv.slice(2)
  let seed = 0
  let userSide: Side = 'home'
  let scenario: Scenario = 'none'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) seed = parseInt(args[i + 1], 10)
    else if (args[i] === '--user-side' && args[i + 1]) userSide = args[i + 1] as Side
    else if (args[i] === '--scenario' && args[i + 1]) scenario = args[i + 1] as Scenario
  }
  if (!seed || Number.isNaN(seed)) seed = Math.floor(Math.random() * 0xffffffff)
  return { seed, userSide, scenario }
}

function describeCheckpoint(cp: PauseCheckpoint): string {
  const score = `${cp.state.score.home}-${cp.state.score.away}`
  const ev = cp.lastEvent
  const detail =
    cp.reason === 'goal' && ev.chanceDetail?.goal
      ? ` (${nameOf(cp, ev.chanceDetail.shooter)})`
      : cp.reason === 'red_card' && ev.foulDetail?.fouler
        ? ` (${nameOf(cp, ev.foulDetail.fouler)})`
        : ''
  return `[beat ${cp.state.beat} · ${cp.state.minute}'] ${cp.reason}${detail}  ${score}  side=${cp.side ?? '-'}`
}

function nameOf(cp: PauseCheckpoint, cardId: string): string {
  const home = cp.state.homeSquad.cards.find((c) => c.id === cardId)
  if (home) return home.name
  const away = cp.state.awaySquad.cards.find((c) => c.id === cardId)
  return away?.name ?? 'unknown'
}

function ownSquad(cp: PauseCheckpoint, side: Side): Squad {
  return side === 'home' ? cp.state.homeSquad : cp.state.awaySquad
}

function ownPlayers(cp: PauseCheckpoint, side: Side): PlayerMatchState[] {
  return side === 'home' ? cp.state.players.home : cp.state.players.away
}

// Pick the first available bench card (not injured, not sent off, not on
// the pitch) and the first on-pitch outfield card to swap them with.
// Returns null if the bench has nothing to bring on.
function pickSubPair(cp: PauseCheckpoint, side: Side): { off: string; on: string } | null {
  const squad = ownSquad(cp, side)
  const players = ownPlayers(cp, side)
  const benchPlayer = players.find((p) => !p.isOnPitch && !p.isInjured && !p.redCard)
  if (!benchPlayer) return null
  // Sub off whoever is in slot 10 (typically a forward in 4-3-3) — keeps
  // GK (slot 0) on so the swap is always legal.
  const offSlot = squad.lineup.find((l) => l.slot === 10)
  if (!offSlot) return null
  return { off: offSlot.cardId, on: benchPlayer.cardId }
}

function pickAlternateFormation(current: Formation): Formation {
  return current === '4-3-3' ? '4-4-2' : '4-3-3'
}

// Build the decisions payload for a given pause, based on the chosen
// scenario. Each scenario fires at most once per match and on the most
// natural trigger (half-time for mentality / formation, first eligible
// pause for sub). After firing we flip the `done` flag so subsequent
// pauses just resume cleanly with `{}`.
function makeDecisionMaker(scenario: Scenario, side: Side) {
  let done = false
  return (cp: PauseCheckpoint): { decisions: MatchDecisions; note: string } => {
    if (done || scenario === 'none' || cp.side !== side) {
      return { decisions: {}, note: '' }
    }

    if (scenario === 'sub') {
      const pair = pickSubPair(cp, side)
      if (!pair) return { decisions: {}, note: '(no eligible bench)' }
      done = true
      return {
        decisions: { subs: [pair] },
        note: `→ SUB: ${nameOf(cp, pair.off)} OFF, ${nameOf(cp, pair.on)} ON`
      }
    }

    if (scenario === 'mentality') {
      // Wait for half-time so the change is observable in the second half.
      if (cp.reason !== 'half_time') return { decisions: {}, note: '' }
      done = true
      return {
        decisions: { mentality: 'attacking' },
        note: '→ MENTALITY: attacking'
      }
    }

    if (scenario === 'formation') {
      if (cp.reason !== 'half_time') return { decisions: {}, note: '' }
      const tactics = side === 'home' ? cp.state.homeTactics : cp.state.awayTactics
      const next = pickAlternateFormation(tactics.formation)
      const players = ownPlayers(cp, side)
      // suggestLineup throws if on-pitch != 11 (red card etc.); fall back
      // to {} so the demo doesn't crash mid-match.
      try {
        const lineup = suggestLineup(ownSquad(cp, side), next, players)
        done = true
        return {
          decisions: { formation: next, lineup },
          note: `→ FORMATION: ${tactics.formation} → ${next}`
        }
      } catch (e) {
        return { decisions: {}, note: `(formation skip: ${(e as Error).message})` }
      }
    }

    return { decisions: {}, note: '' }
  }
}

async function main(): Promise<void> {
  const { seed, userSide, scenario } = parseArgs()

  const input: MatchInput = {
    homeSquad: testHome,
    awaySquad: testAway,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed,
    userSide,
    shouldPause: commonPauseTriggers({ userSide })
  }

  console.log(`Running pausable match seed=${seed} userSide=${userSide} scenario=${scenario}`)
  console.log('='.repeat(72))

  const decide = makeDecisionMaker(scenario, userSide)

  const gen = runMatchPausable(input)
  let pauses = 0
  let r = await gen.next()
  while (!r.done) {
    pauses += 1
    console.log(describeCheckpoint(r.value))
    const { decisions, note } = decide(r.value)
    if (note) console.log(`        ${note}`)
    r = await gen.next(decisions)
  }

  const result = r.value
  console.log('='.repeat(72))
  console.log(`FULL TIME: ${result.homeName} ${result.score.home} - ${result.score.away} ${result.awayName}`)
  console.log(`Total pauses: ${pauses}`)
}

main()

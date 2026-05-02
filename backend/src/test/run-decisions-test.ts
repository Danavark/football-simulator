// Targeted tests for the two new applyFormation behaviors:
//   1. `lineup` alone (no formation) — reposition on-pitch players within
//      the current shape.
//   2. Reject any cardId that's currently off-pitch — including a player
//      just substituted off — when supplied in a lineup change.
//
// We drive the engine via runMatchPausable with a custom predicate that
// pauses on the very first beat, run our decision payload, and assert.

import { testHome, testAway, testHomeTactics, testAwayTactics } from '~/test/fixtures/test-teams'
import { runMatchPausable } from '~/engine/match'
import type { LineupSlot, MatchInput, PauseCheckpoint } from '~/types'

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
  console.log('PASS:', msg)
}

async function tryDecision(
  fn: (cp: PauseCheckpoint) => Promise<{ before: string; after: string }>
): Promise<void> {
  const input: MatchInput = {
    homeSquad: testHome,
    awaySquad: testAway,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed: 12345,
    userSide: 'home',
    // Pause on every beat so we can inject a decision at beat 1.
    shouldPause: () => 'user_request'
  }
  const gen = runMatchPausable(input)
  const r = await gen.next()
  if (r.done) return
  const cp = r.value
  const { before, after } = await fn(cp)
  console.log(`  ${before} → ${after}`)
  await gen.return({} as never)
}

// 1) lineup alone — swap two on-pitch players' slots.
async function testLineupAlone(): Promise<void> {
  console.log('\n--- testLineupAlone ---')
  const input: MatchInput = {
    homeSquad: testHome,
    awaySquad: testAway,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed: 12345,
    userSide: 'home',
    shouldPause: () => 'user_request'
  }
  const gen = runMatchPausable(input)
  const r = await gen.next()
  if (r.done) throw new Error('match ended before first pause')
  const cp = r.value

  // Swap slot 1 and slot 4 (typically LB and a CM in 4-3-3).
  const slot1 = cp.state.homeSquad.lineup.find((l) => l.slot === 1)!
  const slot4 = cp.state.homeSquad.lineup.find((l) => l.slot === 4)!
  const newLineup: LineupSlot[] = cp.state.homeSquad.lineup.map((l) => {
    if (l.slot === 1) return { slot: 1, cardId: slot4.cardId }
    if (l.slot === 4) return { slot: 4, cardId: slot1.cardId }
    return { ...l }
  })

  const beforeAtSlot1 = slot1.cardId
  const beforeAtSlot4 = slot4.cardId

  const r2 = await gen.next({ lineup: newLineup })
  if (r2.done) throw new Error('match ended unexpectedly after lineup-only change')

  const afterSlot1 = r2.value.state.homeSquad.lineup.find((l) => l.slot === 1)!.cardId
  const afterSlot4 = r2.value.state.homeSquad.lineup.find((l) => l.slot === 4)!.cardId

  assert(afterSlot1 === beforeAtSlot4, `lineup-alone: slot 1 now holds the previous slot-4 cardId`)
  assert(afterSlot4 === beforeAtSlot1, `lineup-alone: slot 4 now holds the previous slot-1 cardId`)
  assert(r2.value.state.homeTactics.formation === '4-3-3', `lineup-alone: formation unchanged`)

  await gen.return({} as never)
}

// 2) subbed-off player cannot return via a lineup change in a later pause.
async function testSubbedOffCannotReturn(): Promise<void> {
  console.log('\n--- testSubbedOffCannotReturn ---')
  const input: MatchInput = {
    homeSquad: testHome,
    awaySquad: testAway,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed: 12345,
    userSide: 'home',
    shouldPause: () => 'user_request'
  }
  const gen = runMatchPausable(input)
  const r1 = await gen.next()
  if (r1.done) throw new Error('match ended before first pause')

  const startingLineup = r1.value.state.homeSquad.lineup.map((l) => ({ ...l }))
  const off = startingLineup.find((l) => l.slot === 10)!.cardId
  const benchOn = r1.value.state.players.home.find((p) => !p.isOnPitch && !p.isInjured && !p.redCard)!.cardId

  // Pause 1: do the sub. New lineup has benchOn in slot 10 (off the
  // subbed-off player), rest unchanged.
  const subbedLineup = startingLineup.map((l) =>
    l.slot === 10 ? { slot: 10, cardId: benchOn } : l
  )
  const r2 = await gen.next({ subs: [{ off, on: benchOn }] })
  if (r2.done) throw new Error('match ended unexpectedly after sub')

  // Pause 2: try to send a lineup that re-introduces the subbed-off
  // player. Should throw.
  const naughtyLineup: LineupSlot[] = subbedLineup.map((l) =>
    l.slot === 10 ? { slot: 10, cardId: off } : l
  )

  let threw = false
  try {
    await gen.next({ lineup: naughtyLineup })
  } catch (e) {
    threw = true
    const msg = (e as Error).message
    console.log(`  threw: ${msg}`)
    assert(/not on the pitch/.test(msg), `error message mentions "not on the pitch"`)
  }
  assert(threw, `subbed-off player rejected when re-introduced via lineup`)
  // The throw kills the generator; nothing more to do.
}

// 3) subbed-off player cannot return via a *fresh* sub later.
async function testSubbedOffCannotReturnViaSub(): Promise<void> {
  console.log('\n--- testSubbedOffCannotReturnViaSub ---')
  const input: MatchInput = {
    homeSquad: testHome,
    awaySquad: testAway,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed: 12345,
    userSide: 'home',
    shouldPause: () => 'user_request'
  }
  const gen = runMatchPausable(input)
  const r1 = await gen.next()
  if (r1.done) throw new Error('match ended before first pause')

  const lineup = r1.value.state.homeSquad.lineup
  const offCard = lineup.find((l) => l.slot === 10)!.cardId
  const players = r1.value.state.players.home
  const benchA = players.filter((p) => !p.isOnPitch && !p.isInjured && !p.redCard)
  if (benchA.length < 2) throw new Error('need at least 2 bench cards')
  const firstOn = benchA[0].cardId
  const secondBench = benchA[1].cardId

  // Pause 1: sub offCard out, firstOn in.
  const r2 = await gen.next({ subs: [{ off: offCard, on: firstOn }] })
  if (r2.done) throw new Error('match ended after first sub')

  // Pause 2: try to bring offCard BACK on by subbing firstOn off + offCard on.
  // Should throw because offCard.hasBeenSubbedOff is now true.
  let threw = false
  try {
    await gen.next({ subs: [{ off: firstOn, on: offCard }] })
  } catch (e) {
    threw = true
    const msg = (e as Error).message
    console.log(`  threw: ${msg}`)
    assert(/already been substituted off|football rule/i.test(msg), 'error message mentions sub rule')
  }
  assert(threw, 'subbed-off player rejected when fresh sub tries to bring them back')
}

async function main(): Promise<void> {
  await testLineupAlone()
  await testSubbedOffCannotReturn()
  await testSubbedOffCannotReturnViaSub()
  console.log('\nAll decision tests passed.')
}

main().catch((e) => {
  console.error('TEST ERROR:', e)
  process.exit(1)
})

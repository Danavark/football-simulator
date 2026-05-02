// Bridge between the engine's runMatchPausable AsyncGenerator and our SSE
// stream / POST decision routes. One entry per match session.
//
// Flow:
//   1. createSession() builds the input + composed pause predicate, kicks
//      off the generator (which is lazy — no beats run until we call next),
//      stores the session, returns the id.
//   2. The /stream route attaches a ReadableStream controller, then calls
//      runSessionLoop, which walks the generator. Each beat fires `onBeat`
//      → emits a 'beat' frame. Each yield → emits 'pause' and waits for
//      submitDecisions.
//   3. POST /decisions resolves the pending Promise; loop continues.
//   4. POST /pause flips userPauseFlag; predicate sees it on the next
//      beat and yields with reason='user_request', then clears the flag.
//   5. Generator returns the MatchResult → emit 'end' frame, close stream.

import { commonPauseTriggers } from 'backend/engine/triggers'
import { runMatchPausable } from 'backend/engine/match'
import { applyDecisions } from 'backend/engine/decisions'
import { createCommentator } from 'backend/commentary'
import {
  testHome,
  testAway,
  testHomeTactics,
  testAwayTactics
} from 'backend/test/fixtures/test-teams'
import type {
  BeatResult,
  MatchDecisions,
  MatchInput,
  MatchState,
  PauseReason,
  Side,
  TeamTotals
} from 'backend/types'

import type { BeatFrame, EndFrame, ErrorFrame, HighlightFrame, HighlightKind, PauseFrame } from '@/types/protocol'
import { dropSession, getSession, putSession, type Session } from '@/lib/sessions'

const ENCODER = new TextEncoder()

// Wall-clock pacing tiers. Each session starts at DEFAULT_SPEED_MS and
// can switch tiers mid-match via POST /speed.
const SPEED_PRESETS: Record<'slow' | 'default' | 'fast', number> = {
  slow: 2500,
  default: 1250,
  fast: 500
}
export const DEFAULT_SPEED_MS = SPEED_PRESETS.default
export type SpeedKey = keyof typeof SPEED_PRESETS

export function speedToMs(speed: SpeedKey): number {
  return SPEED_PRESETS[speed]
}

// 2-second pause when a key event fires (goal/card/injury) so the modal
// has time to be read. Independent of speed tier.
const HIGHLIGHT_PAUSE_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Running team-totals snapshot at the current beat. Mirrors the engine's
// own buildTeamTotals (used at full time) but works from MatchState alone
// so the UI can render live stats. Cards/fouls come from PlayerMatchState
// (since PlayerSummary doesn't exist mid-match); shots/corners/possession
// from the event log.
function computeRunningTotals(state: MatchState): { home: TeamTotals; away: TeamTotals } {
  const blank = (): TeamTotals => ({
    possessionPct: 0,
    shots: 0,
    shotsOnTarget: 0,
    shotsOffTarget: 0,
    corners: 0,
    freeKicks: 0,
    penalties: 0,
    yellowCards: 0,
    redCards: 0,
    fouls: 0
  })
  const home = blank()
  const away = blank()

  let homeBeats = 0
  let awayBeats = 0
  for (const ev of state.events) {
    const t = ev.attackingTeam === 'home' ? home : away
    if (ev.attackingTeam === 'home') homeBeats += 1
    else awayBeats += 1

    if (ev.outcome === 'chance' && ev.chanceDetail) {
      t.shots += 1
      if (ev.chanceDetail.onTarget) t.shotsOnTarget += 1
      else t.shotsOffTarget += 1
    }
    // Set-piece attempts are shots — gated on the engine's `attempted`
    // flag so wing free kicks where the cross produced no header don't
    // over-count. Matches backend buildTeamTotals.
    if (
      (ev.foulDetail?.setPiece === 'penalty' || ev.foulDetail?.setPiece === 'free_kick') &&
      ev.foulDetail.setPieceResult?.attempted
    ) {
      t.shots += 1
      if (ev.foulDetail.setPieceResult.goal) t.shotsOnTarget += 1
      else t.shotsOffTarget += 1
    }
    // Open-play corners only. Wing fouls are now free kicks.
    if (ev.cornerTaken) t.corners += 1
    if (ev.foulDetail?.setPiece === 'free_kick') t.freeKicks += 1
    if (ev.foulDetail?.setPiece === 'penalty') t.penalties += 1
  }

  const totalBeats = homeBeats + awayBeats
  if (totalBeats > 0) {
    home.possessionPct = Math.round((homeBeats / totalBeats) * 1000) / 10
    away.possessionPct = Math.round((awayBeats / totalBeats) * 1000) / 10
  }

  for (const p of state.players.home) {
    home.yellowCards += p.yellowCards
    if (p.redCard) home.redCards += 1
    home.fouls += p.foulsCommitted
  }
  for (const p of state.players.away) {
    away.yellowCards += p.yellowCards
    if (p.redCard) away.redCards += 1
    away.fouls += p.foulsCommitted
  }

  return { home, away }
}

const EMPTY_TOTALS = computeRunningTotals({
  events: [],
  players: { home: [], away: [] }
} as unknown as MatchState)

// SSE frame helper. Each frame is `event: NAME\ndata: JSON\n\n`. Returns
// raw bytes ready to enqueue on the controller.
function frame(event: 'beat' | 'pause' | 'error' | 'end' | 'highlight', data: unknown): Uint8Array {
  return ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function safeEnqueue(s: Session, bytes: Uint8Array): void {
  try {
    s.controller?.enqueue(bytes)
  } catch {
    // Stream closed underneath us — drop the controller.
    s.controller = null
  }
}

type StartOpts = {
  seed?: number
  userSide?: Side
  // Account preference (default false). When true the engine pauses on
  // half-time, own-side reds, own-side injuries, and either-side goals.
  // When false only the manual pause button can trigger a pause —
  // useful for users who find the auto-pauses too intrusive.
  autoPause?: boolean
  // Initial wall-clock speed tier. Defaults to 'default'.
  speed?: SpeedKey
}

export function createSession(opts: StartOpts = {}): string {
  const id = randomId()
  const userSide: Side = opts.userSide ?? 'home'
  const seed = opts.seed ?? Math.floor(Math.random() * 0xffffffff)
  const autoPause = opts.autoPause === true

  const userPauseFlag = { current: false }

  // Compose the predicate: own pause-button always wins. The default
  // event-driven triggers (HT / red / injury / goal) only run when the
  // caller asked for them via autoPause. Without it, the user has full
  // control over when to interrupt — manual pause only.
  const defaultTriggers = autoPause ? commonPauseTriggers({ userSide }) : null
  const predicate = (state: MatchState, ev: BeatResult): PauseReason | null => {
    if (userPauseFlag.current) {
      userPauseFlag.current = false
      return 'user_request'
    }
    return defaultTriggers ? defaultTriggers(state, ev) : null
  }

  const input: MatchInput = {
    homeSquad: testHome,
    awaySquad: testAway,
    homeTactics: testHomeTactics,
    awayTactics: testAwayTactics,
    seed,
    userSide,
    shouldPause: predicate
  }

  const commentator = createCommentator(seed)
  const session: Session = {
    id,
    gen: null!,
    input,
    commentator,
    resolveDecisions: null,
    userPauseFlag,
    speedMs: opts.speed ? speedToMs(opts.speed) : DEFAULT_SPEED_MS,
    controller: null,
    loopStarted: false,
    beatHistory: [],
    pendingPause: null,
    finalResult: null,
    lastState: null,
    ended: false,
    lastTouch: Date.now()
  }

  // Pre-seed the kickoff prose at minute 0 so it appears in the feed
  // BEFORE the first beat (which is at minute 2). Weather isn't rolled
  // until the engine's first state init, so this opener uses 'clear' as
  // a placeholder; the actual weather flavour rides the first beat
  // separately. (For a richer prototype the engine could expose its
  // pre-roll, but this is enough.)
  const kickoffFrame: BeatFrame = {
    // ev is unused by the UI for synthetic frames; pass a minimal stub.
    ev: { beat: 0, minute: 0, attackingTeam: 'home', zone: 'centre', outcome: 'nothing', momentum: 0 } as BeatResult,
    score: { home: 0, away: 0 },
    minute: 0,
    commentary: commentator.openMatch(input.homeSquad.name, input.awaySquad.name, 'clear'),
    totals: EMPTY_TOTALS
  }
  session.beatHistory.push(kickoffFrame)

  // onBeat fires after every processBeat — emits a 'beat' frame, archives
  // it on the session for reconnect replay, then sleeps to pace playback.
  let weatherShown = false
  const onBeat = async (ev: BeatResult, state: MatchState): Promise<void> => {
    session.lastState = state
    session.lastTouch = Date.now()
    const lines: string[] = []
    // Weather flavour rides the first beat (since the engine rolls it at
    // initializeMatchState time and we don't see it until the first
    // state arrives).
    if (!weatherShown) {
      weatherShown = true
      const weatherLines = commentator.openMatch(state.homeSquad.name, state.awaySquad.name, state.config.weather)
      // openMatch returns [kickoff, weather?] — we already emitted the
      // kickoff at minute 0, so only forward the optional weather line.
      if (weatherLines.length > 1) lines.push(weatherLines[1])
    }
    lines.push(...commentator.beat(ev, state.homeSquad, state.awaySquad))
    const data: BeatFrame = {
      ev,
      score: state.score,
      minute: state.minute,
      commentary: lines,
      totals: computeRunningTotals(state)
    }
    session.beatHistory.push(data)
    safeEnqueue(session, frame('beat', data))

    // Detect a key event — goal, card, or injury — and emit a highlight
    // frame so the UI can flash a modal. The brief HIGHLIGHT_PAUSE_MS
    // sleep gives the user a moment to read it before the next beat.
    // Highlights are intentionally NOT archived in beatHistory: a
    // reconnect already sees the score / cards via beats and stats, and
    // re-flashing past modals on refresh would be jarring.
    const highlight = buildHighlight(ev, state)
    if (highlight) {
      safeEnqueue(session, frame('highlight', highlight))
      await sleep(HIGHLIGHT_PAUSE_MS)
    }

    // Pace playback so the browser sees beats in real time. The await
    // here also makes the loop yield back to the event loop, letting any
    // pending /pause POST flip the userPauseFlag before the next beat.
    // session.speedMs is mutable — tier changes via POST /speed land
    // before the next sleep.
    await sleep(session.speedMs)
  }

  session.gen = runMatchPausable(input, { onBeat })
  putSession(session)
  return id
}

// Find which side a cardId belongs to. Returns null if the id isn't on
// either roster — shouldn't happen in normal flow, but the engine has
// proven creative before.
function findCardSide(state: MatchState, cardId: string): Side | null {
  if (state.homeSquad.cards.some((c) => c.id === cardId)) return 'home'
  if (state.awaySquad.cards.some((c) => c.id === cardId)) return 'away'
  return null
}

function nameOfCard(state: MatchState, cardId: string, side: Side): string {
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  return squad.cards.find((c) => c.id === cardId)?.name ?? cardId
}

function teamName(state: MatchState, side: Side): string {
  return side === 'home' ? state.homeSquad.name : state.awaySquad.name
}

// Inspect the latest beat for a "key event" worth flashing in the UI.
// Returns null when nothing notable happened. Priority order: goal >
// red/second-yellow > injury > yellow — only one highlight per beat.
function buildHighlight(ev: BeatResult, state: MatchState): HighlightFrame | null {
  // Open-play goal.
  if (ev.chanceDetail?.goal) {
    const side = ev.attackingTeam
    const player = nameOfCard(state, ev.chanceDetail.shooter, side)
    return {
      kind: 'goal',
      player,
      team: teamName(state, side),
      side,
      minute: ev.minute,
      score: state.score
    }
  }
  // Set-piece goal — penalty or free kick.
  if (ev.foulDetail?.setPieceResult?.goal) {
    const side = ev.attackingTeam
    const shooterId = ev.foulDetail.setPieceResult.shooterId
    const player = shooterId ? nameOfCard(state, shooterId, side) : teamName(state, side)
    return {
      kind: 'goal',
      player,
      team: teamName(state, side),
      side,
      minute: ev.minute,
      score: state.score
    }
  }
  // Red card / second yellow.
  if (ev.foulDetail?.card === 'red' || ev.foulDetail?.card === 'second_yellow') {
    const side = findCardSide(state, ev.foulDetail.fouler)
    if (!side) return null
    const kind: HighlightKind = ev.foulDetail.card === 'red' ? 'red' : 'second_yellow'
    return {
      kind,
      player: nameOfCard(state, ev.foulDetail.fouler, side),
      team: teamName(state, side),
      side,
      minute: ev.minute
    }
  }
  // Injury — foul-derived or passive.
  const injuredId = ev.foulDetail?.injury ? ev.foulDetail.victim : ev.passiveInjury
  if (injuredId) {
    const side = findCardSide(state, injuredId)
    if (!side) return null
    return {
      kind: 'injury',
      player: nameOfCard(state, injuredId, side),
      team: teamName(state, side),
      side,
      minute: ev.minute
    }
  }
  // Yellow card.
  if (ev.foulDetail?.card === 'yellow') {
    const side = findCardSide(state, ev.foulDetail.fouler)
    if (!side) return null
    return {
      kind: 'yellow',
      player: nameOfCard(state, ev.foulDetail.fouler, side),
      team: teamName(state, side),
      side,
      minute: ev.minute
    }
  }
  return null
}

// Build a one-line commentary message describing a sub. Used by the
// runSessionLoop when the user applies decisions that include subs.
function subCommentary(state: MatchState, side: Side, off: string, on: string): string {
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const offName = squad.cards.find((c) => c.id === off)?.name ?? off
  const onName = squad.cards.find((c) => c.id === on)?.name ?? on
  return `🔄 Sub for ${squad.name}: ${onName} on, ${offName} off.`
}

// Walk the generator. Called once per session (loopStarted guards
// re-entry). Writes frames to whatever controller is currently attached;
// frames are also archived on the session so reconnects can replay.
export async function runSessionLoop(s: Session): Promise<void> {
  try {
    let r = await s.gen.next()
    while (!r.done) {
      const cp = r.value
      s.lastState = cp.state
      s.lastTouch = Date.now()

      // Half-time prose attaches to the pause moment so the UI feed shows
      // it before the user makes a decision. Archived as a beat frame so
      // reconnects see it too.
      if (cp.reason === 'half_time') {
        const lines = s.commentator.halfTime(cp.state.homeSquad.name, cp.state.awaySquad.name, cp.state.score)
        if (lines.length > 0) {
          const htFrame: BeatFrame = {
            ev: cp.lastEvent,
            score: cp.state.score,
            minute: cp.state.minute,
            commentary: lines,
            totals: computeRunningTotals(cp.state)
          }
          s.beatHistory.push(htFrame)
          safeEnqueue(s, frame('beat', htFrame))
        }
      }

      const pauseFrame: PauseFrame = { reason: cp.reason, side: cp.side, state: cp.state }
      s.pendingPause = pauseFrame
      safeEnqueue(s, frame('pause', pauseFrame))

      // Wait for valid decisions. If the user submits bad input, we
      // surface it as an 'error' frame, re-emit the pause, and loop —
      // the live generator stays alive so the user can correct and
      // retry without losing the match.
      let validDecisions: MatchDecisions | undefined
      while (validDecisions === undefined) {
        const candidate = await new Promise<MatchDecisions>((resolve) => {
          s.resolveDecisions = resolve
        })
        s.resolveDecisions = null

        // Dry-run on a deep clone of the state. applyDecisions can
        // partially mutate before throwing (applySubs first, then
        // applyFormation), so a clone is the only safe way to validate
        // without poisoning the live generator's state.
        const clone = structuredClone(cp.state)
        try {
          applyDecisions(clone, candidate, s.input)
          validDecisions = candidate
        } catch (e) {
          const err: ErrorFrame = { message: (e as Error).message }
          safeEnqueue(s, frame('error', err))
          // Re-emit the pause so the UI re-opens the decision panel
          // after the error toast — the user can adjust and apply again.
          safeEnqueue(s, frame('pause', pauseFrame))
        }
      }
      s.pendingPause = null

      // Emit any sub commentary BEFORE forwarding to the engine. cp.state
      // is the same reference as the live engine state, so once gen.next
      // runs (and resumes the engine through to the next pause or end),
      // state.minute advances. Capturing the frame here pins it to the
      // pause minute when the user actually made the decision.
      if (validDecisions.subs && validDecisions.subs.length > 0 && cp.side) {
        const lines: string[] = []
        for (const sub of validDecisions.subs) {
          lines.push(subCommentary(cp.state, cp.side, sub.off, sub.on))
        }
        const subFrame: BeatFrame = {
          ev: cp.lastEvent,
          score: cp.state.score,
          minute: cp.state.minute,
          commentary: lines,
          totals: computeRunningTotals(cp.state)
        }
        s.beatHistory.push(subFrame)
        safeEnqueue(s, frame('beat', subFrame))
      }

      // Validation passed — forward to the engine. This mutates the live
      // state and shouldn't throw (we already proved the decisions are
      // valid against a clone above).
      r = await s.gen.next(validDecisions)
    }

    if (r.done) {
      const lines = s.commentator.fullTime(r.value)
      // Use the actual final minute from the last beat — could be 92, 94
      // etc. with stoppage time. Hardcoding 90 was wrong.
      const lastBeat = r.value.beats[r.value.beats.length - 1]
      const finalMinute = lastBeat?.minute ?? 90
      if (lines.length > 0) {
        const ftFrame: BeatFrame = {
          ev: s.lastState?.events[s.lastState.events.length - 1] ?? lastBeat,
          score: r.value.score,
          minute: finalMinute,
          commentary: lines,
          // r.value.teamTotals is the engine's authoritative end-of-match
          // totals (with clean-sheet adjustments applied), not running.
          totals: r.value.teamTotals
        }
        s.beatHistory.push(ftFrame)
        safeEnqueue(s, frame('beat', ftFrame))
      }
      const end: EndFrame = { result: r.value }
      s.finalResult = end
      safeEnqueue(s, frame('end', end))
    }
  } catch (e) {
    const err: ErrorFrame = { message: (e as Error).message }
    safeEnqueue(s, frame('error', err))
  } finally {
    s.ended = true
    try {
      s.controller?.close()
    } catch {
      // already closed
    }
    s.controller = null
  }
}

// Bring a freshly-attached client up to speed. Replays archived beats
// (instantly, so the UI catches up to "now"), then re-emits the pending
// pause if the match is currently paused, or the final result if ended.
// Caller has already set session.controller before calling this.
export function replayHistory(s: Session): void {
  // Snapshot length so a beat pushed mid-replay (next loop tick) doesn't
  // double-emit — we only iterate up to what existed at attach time.
  const upTo = s.beatHistory.length
  for (let i = 0; i < upTo; i++) {
    safeEnqueue(s, frame('beat', s.beatHistory[i]))
  }
  if (s.pendingPause) {
    safeEnqueue(s, frame('pause', s.pendingPause))
  }
  if (s.finalResult) {
    safeEnqueue(s, frame('end', s.finalResult))
  }
}

export function submitDecisions(id: string, decisions: MatchDecisions): { ok: boolean; reason?: string } {
  const s = getSession(id)
  if (!s) return { ok: false, reason: 'unknown session' }
  if (s.ended) return { ok: false, reason: 'session ended' }
  if (!s.resolveDecisions) return { ok: false, reason: 'not currently paused' }
  s.resolveDecisions(decisions)
  return { ok: true }
}

export function requestPause(id: string): { ok: boolean; reason?: string } {
  const s = getSession(id)
  if (!s) return { ok: false, reason: 'unknown session' }
  if (s.ended) return { ok: false, reason: 'session ended' }
  s.userPauseFlag.current = true
  return { ok: true }
}

export function setSpeed(id: string, speed: SpeedKey): { ok: boolean; reason?: string; speedMs?: number } {
  const s = getSession(id)
  if (!s) return { ok: false, reason: 'unknown session' }
  if (s.ended) return { ok: false, reason: 'session ended' }
  s.speedMs = speedToMs(speed)
  return { ok: true, speedMs: s.speedMs }
}

export function endSession(id: string): void {
  const s = getSession(id)
  if (!s) return
  try {
    s.controller?.close()
  } catch {
    // already closed
  }
  dropSession(id)
}

function randomId(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

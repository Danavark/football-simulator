// In-memory session store. Each match the user starts gets one entry,
// keyed by a uuid. The Next.js dev server is a single Node process so this
// Map survives across requests within one dev session.

import type { Commentator } from 'backend/commentary'
import type { MatchDecisions, MatchInput, MatchResult, MatchState, PauseCheckpoint } from 'backend/types'
import type { BeatFrame, EndFrame, PauseFrame } from '@/types/protocol'

export type Session = {
  id: string
  // Live AsyncGenerator from runMatchPausable. Lives until `done`.
  gen: AsyncGenerator<PauseCheckpoint, MatchResult, MatchDecisions | undefined>

  // The MatchInput used to start this session. Kept around so we can
  // dry-run applyDecisions on a state clone for validation (rejecting
  // bad payloads without killing the live generator).
  input: MatchInput

  // Stateful prose generator — produces commentary lines per beat and
  // half-time / full-time bookends. Created at session start, reused.
  commentator: Commentator

  // Pause coordination — set by runSessionLoop when the generator yields,
  // resolved by submitDecisions when the UI POSTs.
  resolveDecisions: ((d: MatchDecisions) => void) | null

  // User-pause flag — POST /pause flips this true. The pause predicate
  // reads it on the next beat and clears it.
  userPauseFlag: { current: boolean }

  // Wall-clock pacing (ms per beat). Mutable mid-match — POST /speed
  // updates this and the next sleep picks up the new value. Three named
  // tiers map to slow/default/fast.
  speedMs: number

  // SSE write side — set by /stream. Null until the client connects, or
  // after a disconnect.
  controller: ReadableStreamDefaultController<Uint8Array> | null

  // Has runSessionLoop been kicked off? First /stream attach starts it;
  // subsequent attaches (refresh) just swap the controller and replay
  // beatHistory so the new client catches up.
  loopStarted: boolean

  // Every BeatFrame emitted so far, in order. Used to bring a reconnecting
  // client up to the current minute. Stored as already-rendered frames so
  // commentary is consistent across replay.
  beatHistory: BeatFrame[]

  // Currently-pending pause checkpoint (if the generator is paused waiting
  // for decisions). Replayed on reconnect so the UI re-opens the panel.
  pendingPause: PauseFrame | null

  // Final result if the match has ended — replayed on reconnect so a
  // late-arriving tab can render the FT screen.
  finalResult: EndFrame | null

  // Last-known state for debugging. Filled per beat.
  lastState: MatchState | null

  // True after `done` (or fatal error) so /stream can short-circuit if a
  // late client attaches.
  ended: boolean

  // Last-write timestamp for GC.
  lastTouch: number
}

// Pin to `process` rather than globalThis. Next.js App Router dev mode
// uses separate VM contexts per route layer (RSC vs Node), so globalThis
// is NOT shared across handlers — but `process` is unique per Node.js
// process and survives across module evaluations / HMR. In production
// this is just a regular module-level singleton attached to process.
type ProcessWithSessions = typeof process & { __footballSessions?: Map<string, Session> }
const p = process as ProcessWithSessions
const sessions: Map<string, Session> = p.__footballSessions ?? (p.__footballSessions = new Map())

export function getSession(id: string): Session | null {
  return sessions.get(id) ?? null
}

export function putSession(s: Session): void {
  sessions.set(s.id, s)
}

export function dropSession(id: string): void {
  sessions.delete(id)
}

export function touchSession(id: string): void {
  const s = sessions.get(id)
  if (s) s.lastTouch = Date.now()
}

// Ten minutes idle → drop. Cheap reaper, runs every minute. .unref() so it
// doesn't keep the dev server alive on shutdown.
const IDLE_TTL_MS = 10 * 60 * 1000
setInterval(() => {
  const cutoff = Date.now() - IDLE_TTL_MS
  for (const [id, s] of sessions) {
    if (s.lastTouch < cutoff) {
      try {
        s.controller?.close()
      } catch {
        // already closed
      }
      sessions.delete(id)
    }
  }
}, 60_000).unref()

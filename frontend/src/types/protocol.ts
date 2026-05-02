// Wire shapes for the SSE stream + decision payload. The frontend imports
// engine types directly from `backend/types`; this file is just the
// transport-specific types that don't exist in the engine.

import type { BeatResult, MatchResult, MatchState, PauseReason, Side, TeamTotals } from 'backend/types'

export type BeatFrame = {
  ev: BeatResult
  score: { home: number; away: number }
  minute: number
  commentary: string[]
  // Running team stats as of this beat — possession %, shots, corners,
  // cards, fouls. UI reads this to render the live MatchStats panel
  // without needing the full MatchState in every frame.
  totals: { home: TeamTotals; away: TeamTotals }
}

// Trimmed snapshot the UI needs to render the decision panel — full squads,
// tactics, per-player on-pitch/injury/red flags, sub count. We send the
// engine's MatchState as-is for now (small enough for the prototype); a
// real client would slim this down to just what the UI binds to.
export type PauseFrame = {
  reason: PauseReason
  side: Side | null
  state: MatchState
}

export type ErrorFrame = {
  message: string
}

export type EndFrame = {
  result: MatchResult
}

// Brief informational popup fired alongside a key event. Server emits
// it after the related 'beat' frame and then sleeps for ~2s so the user
// can read it before the match resumes.
export type HighlightKind = 'goal' | 'yellow' | 'red' | 'second_yellow' | 'injury'

export type HighlightFrame = {
  kind: HighlightKind
  player: string
  team: string
  side: Side
  minute: number
  // Goals only — running scoreline at the moment the goal went in.
  score?: { home: number; away: number }
}

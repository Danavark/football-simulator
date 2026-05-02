// Default pause-trigger predicates for runMatchPausable. The engine itself
// is agnostic — runMatchPausable just calls the predicate the caller
// supplies on MatchInput.shouldPause. This module provides the standard
// event-driven defaults; CLI/UI/SSE callers compose them with their own
// "user clicked pause" flag (Q13/Q14 from the design spec).

import { SIM_CONSTANTS } from '~/consts/engine'
import type { BeatResult, MatchState, PausePredicate, PauseReason, Side } from '~/types'

// Build the default trigger predicate. Per the locked design:
//   • half_time — fires on the first beat with minute >= 46 (always)
//   • red_card — own-side red, second_yellow, or red on either side
//                if userSide is undefined
//   • injury — own-side injury (foul-derived or passive)
//   • goal — either side scoring (high-leverage moment for both)
//
// Composing example (UI flow with a "user pause" button):
//   const triggers = commonPauseTriggers({ userSide: 'home' })
//   const pred = (state, ev) => {
//     if (userPauseFlag.read()) return 'user_request'
//     return triggers(state, ev)
//   }
export function commonPauseTriggers(opts: { userSide?: Side } = {}): PausePredicate {
  const userSide = opts.userSide
  // Half-time fires once per match — once we've yielded for it, don't
  // re-yield on every subsequent second-half beat.
  let halfTimeFired = false

  return (state: MatchState, ev: BeatResult): PauseReason | null => {
    // Half-time — first beat past the half-time mark.
    if (!halfTimeFired && state.beat >= SIM_CONSTANTS.HALFTIME_BEAT) {
      halfTimeFired = true
      return 'half_time'
    }

    // Red card / second yellow.
    if (ev.foulDetail?.card === 'red' || ev.foulDetail?.card === 'second_yellow') {
      const side = sideOfCard(state, ev.foulDetail.fouler)
      if (!userSide || side === userSide) return 'red_card'
    }

    // Injury — foul-derived or passive — on the user's side.
    const injuredCardId = ev.foulDetail?.injury ? ev.foulDetail.victim : ev.passiveInjury
    if (injuredCardId) {
      const side = sideOfCard(state, injuredCardId)
      if (!userSide || side === userSide) return 'injury'
    }

    // Either-side goal.
    if (ev.chanceDetail?.goal || ev.foulDetail?.setPieceResult?.goal) {
      return 'goal'
    }

    return null
  }
}

function sideOfCard(state: MatchState, cardId: string): Side | null {
  if (state.homeSquad.cards.some((c) => c.id === cardId)) return 'home'
  if (state.awaySquad.cards.some((c) => c.id === cardId)) return 'away'
  return null
}

// Mid-match tactical adaptation. After a threshold minute, a sufficient
// score gap forces leading/trailing teams into defensive/attacking
// mentalities respectively — even if those weren't the starting tactics.
// Runs every beat and is idempotent: re-evaluates from current state, so
// a goal that closes the gap can revert a team back toward neutral on
// the next beat.

import { SIM_CONSTANTS } from '~/consts/engine'
import type { MatchState } from '~/types'

// Re-evaluate both teams' mentalities given the current minute, score and
// on-pitch counts. Mutates state.{home,away}Tactics.mentality (those have
// already been cloned from the input by initializeMatchState, so the
// caller's original Tactics objects are untouched).
//
// Each beat we RESET to the caller's base mentality before applying any
// override — without that reset a transient man-down window (between an
// injury and the auto-sub) would leave the team stuck defensive even
// after the sub came on.
export function adaptTactics(state: MatchState): void {
  state.homeTactics.mentality = state.homeBaseMentality
  state.awayTactics.mentality = state.awayBaseMentality

  // Man-down override runs every beat regardless of minute — a team
  // reduced to ten can't sensibly stay attacking. Wins over the
  // score-based shift below: a trailing man-down team still goes
  // defensive because they realistically can't sustain pressure with
  // ten men.
  let homeOnPitch = 0
  let awayOnPitch = 0
  for (const ps of state.players.home) if (ps.isOnPitch) homeOnPitch += 1
  for (const ps of state.players.away) if (ps.isOnPitch) awayOnPitch += 1
  if (homeOnPitch < awayOnPitch) {
    state.homeTactics.mentality = 'defensive'
    return
  }
  if (awayOnPitch < homeOnPitch) {
    state.awayTactics.mentality = 'defensive'
    return
  }

  const minute = state.minute
  if (minute < SIM_CONSTANTS.TACTICS_ADAPT_MINUTE_BIG) return

  const diff = state.score.home - state.score.away
  const absDiff = Math.abs(diff)

  const significant =
    (absDiff >= 2 && minute >= SIM_CONSTANTS.TACTICS_ADAPT_MINUTE_BIG) || (absDiff >= 1 && minute >= SIM_CONSTANTS.TACTICS_ADAPT_MINUTE_SMALL)
  if (!significant) return

  if (diff > 0) {
    state.homeTactics.mentality = 'defensive'
    state.awayTactics.mentality = 'attacking'
  } else if (diff < 0) {
    state.homeTactics.mentality = 'attacking'
    state.awayTactics.mentality = 'defensive'
  }
}

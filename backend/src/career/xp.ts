// Profile-level XP economy. XP is awarded per match based on the user's
// team's performance and the events of the match. Floors at 0 — never
// negative. The user spends this balance via xp-spend.ts.
//
// Spec: docs/06_progression-and-balance.md §2.

import { ROLE_BY_POSITION, PROGRESSION_CONSTANTS } from '@/consts/career'
import type { MatchResult, Profile, Side } from '@/types'

// Itemised breakdown of a match's XP — useful for showing the user where
// their XP came from.
export type XpBreakdown = {
  appearance: number
  ratings: number
  goals: number
  assists: number
  cleanSheet: number
  result: number
  goalsConceded: number
  yellows: number
  reds: number
  fouls: number
  net: number // sum, floored at 0
}

// Compute a match's XP for the user's side. Pure — no profile mutation.
export function computeMatchXp(result: MatchResult, userSide: Side): XpBreakdown {
  const r = PROGRESSION_CONSTANTS.xpRewards
  const p = PROGRESSION_CONSTANTS.xpPenalties
  const summaries = result.playerSummaries.filter((s) => s.team === userSide)

  const appearance = r.appearance

  let ratings = 0
  let goals = 0
  let assists = 0
  let cleanSheet = 0
  let yellows = 0
  let reds = 0
  let fouls = 0

  const userScore = userSide === 'home' ? result.score.home : result.score.away
  const oppScore = userSide === 'home' ? result.score.away : result.score.home

  // Clean sheet → award per GK + defender that played.
  if (oppScore === 0) {
    for (const s of summaries) {
      if (s.minutesPlayed === 0) continue
      const role = ROLE_BY_POSITION[s.position]
      if (role === 'GK' || role === 'DEF') cleanSheet += r.cleanSheetPerDefender
    }
  }

  for (const s of summaries) {
    if (s.minutesPlayed === 0) continue
    if (s.matchRating >= 10) ratings += r.rating100
    else if (s.matchRating >= 9) ratings += r.rating90
    else if (s.matchRating >= 8) ratings += r.rating80
    else if (s.matchRating >= 7) ratings += r.rating70
    else if (s.matchRating >= 6) ratings += r.rating60
    goals += s.goals * r.goal
    assists += s.assists * r.assist
    yellows += s.yellowCards * p.yellow
    if (s.redCard) reds += p.red
    fouls += s.foulsCommitted * p.foul
  }

  let result_ = 0
  if (userScore > oppScore) result_ = r.win
  else if (userScore === oppScore) result_ = r.draw

  const goalsConceded = oppScore * p.goalConceded

  const net = Math.max(
    0,
    appearance + ratings + goals + assists + cleanSheet + result_ - goalsConceded - yellows - reds - fouls
  )

  return {
    appearance,
    ratings,
    goals,
    assists,
    cleanSheet,
    result: result_,
    goalsConceded,
    yellows,
    reds,
    fouls,
    net
  }
}

// Award match XP to a profile. Mutates xpBalance + totalXpEarned. Returns
// the breakdown so callers can render it in UI.
export function awardMatchXp(profile: Profile, result: MatchResult, userSide: Side): XpBreakdown {
  const breakdown = computeMatchXp(result, userSide)
  profile.xpBalance += breakdown.net
  profile.totalXpEarned += breakdown.net
  return breakdown
}

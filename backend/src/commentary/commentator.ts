// Commentary stream — turns BeatResult events plus structural hooks
// (kickoff, half-time, full-time) into prose lines. Stateful: tracks
// score, recently-used line indices per pool, and the red-card lifecycle
// so the output evolves across the match.
//
// Determinism (Q5): RNG is derived from the engine seed via XOR with a
// constant. Same engine seed → same prose. Adding new lines to a pool
// only affects commentary, not match logic.

import { createRng, type RNG } from '~/lib/rng'
import {
  BUILDUP_LINES,
  CHANCE_LINES,
  FOUL_LINES,
  GOAL_LINES,
  NOTHING_LINES,
  OFF_TARGET_LINES,
  SAVE_LINES
} from '~/commentary/lines'
import { DOWN_TO_TEN_FLAVOUR, MODIFIERS, type ScoreState, type TimeBucket } from '~/commentary/modifiers'
import {
  COMEBACK_LEAD_REACTIONS,
  EQUALISER_REACTIONS,
  FULL_TIME_AWAY_WIN,
  FULL_TIME_DRAW,
  FULL_TIME_HOME_WIN,
  HALF_TIME_HOME_LEADING,
  HALF_TIME_HOME_TRAILING,
  HALF_TIME_LEVEL,
  KICKOFF_LINES,
  LATE_GOAL_REACTIONS,
  RED_CARD_REACTIONS,
  STOPPAGE_ANNOUNCEMENT,
  WEATHER_KICKOFF
} from '~/commentary/special'
import { zonePhrase } from '~/commentary/zone-phrase'
import type { BeatResult, MatchResult, Outcome, Side, Squad, WeatherCondition } from '~/types'

// Q12 — last-N pool indices kept to bias picks away from repeats.
const RECENT_WINDOW = 8
// Q21 — modifier fires on ~25% of nothing/buildup beats.
const MODIFIER_CHANCE = 0.25
// Q17 — late-goal reactions kick in for goals at minute 86 and beyond.
const LATE_GOAL_THRESHOLD = 86
// Salt that derives the commentary RNG stream from the engine seed.
// Independent stream means line-pool changes don't disturb match outcomes.
const COMMENTARY_SEED_SALT = 0xc0decafe

type HalfTimePool = readonly ((h: string, a: string, hs: number, as: number) => string)[]

export type Commentator = {
  // Pre-match opener — kickoff line plus optional weather flavour.
  openMatch(home: string, away: string, weather: WeatherCondition): string[]
  // Per-beat lines (lead-in / outcome / reactions). Caller passes both
  // squads so we can resolve card names and the keeper.
  beat(ev: BeatResult, homeSquad: Squad, awaySquad: Squad): string[]
  // Half-time whistle. Caller passes the score at the break.
  halfTime(homeName: string, awayName: string, score: { home: number; away: number }): string[]
  // Full-time whistle. Result carries the final score and team names.
  fullTime(result: MatchResult): string[]
}

export function createCommentator(engineSeed: number): Commentator {
  const rng: RNG = createRng((engineSeed ^ COMMENTARY_SEED_SALT) >>> 0)

  // Match state tracked over the call sequence.
  const score = { home: 0, away: 0 }
  const sentOff = { home: 0, away: 0 }
  let stoppageAnnounced = false
  // currentTimeBucket is set at the top of every beat() and read by
  // applyModifier — saves threading the minute through the call chain.
  let currentTimeBucket: TimeBucket = 'early'
  // Last-N picked indices keyed by pool reference.
  const recentByPool = new Map<object, number[]>()

  function getTimeBucket(minute: number): TimeBucket {
    if (minute > 90) return 'stoppage'
    if (minute >= 71) return 'late'
    if (minute >= 31) return 'mid'
    return 'early'
  }

  function getScoreState(atk: Side): ScoreState {
    const a = atk === 'home' ? score.home : score.away
    const o = atk === 'home' ? score.away : score.home
    if (a > o) return 'leading'
    if (a < o) return 'trailing'
    return 'level'
  }

  // RNG-backed pick from a pool, biased away from recently-used indices.
  // A handful of rolls is enough — fall back to plain uniform if every
  // try lands in the recent window.
  function pick<T>(pool: readonly T[]): T {
    const recent = recentByPool.get(pool) ?? []
    let idx = -1
    if (pool.length > recent.length) {
      for (let i = 0; i < 6; i++) {
        const candidate = Math.floor(rng.next() * pool.length)
        if (!recent.includes(candidate)) {
          idx = candidate
          break
        }
      }
    }
    if (idx === -1) idx = Math.floor(rng.next() * pool.length)
    const next = [...recent, idx].slice(-RECENT_WINDOW)
    recentByPool.set(pool, next)
    return pool[idx]
  }

  function nameOf(squad: Squad, cardId: string): string {
    return squad.cards.find((c) => c.id === cardId)?.name ?? cardId
  }

  function gkName(squad: Squad): string {
    const slot = squad.lineup.find((l) => l.slot === 0)
    return slot ? nameOf(squad, slot.cardId) : 'the keeper'
  }

  function sideOf(cardId: string, homeSquad: Squad, awaySquad: Squad): Side | null {
    if (homeSquad.cards.some((c) => c.id === cardId)) return 'home'
    if (awaySquad.cards.some((c) => c.id === cardId)) return 'away'
    return null
  }

  // Maybe prepend a modifier prefix per Q21/Q22/Q25:
  // - only fires on nothing/buildup outcomes
  // - 25% probability when eligible
  // - if the attacking team is short-handed, picks from DOWN_TO_TEN_FLAVOUR
  //   in place of the time/scoreline bucket
  function applyModifier(baseLine: string, outcome: Outcome, atk: Side): string {
    if (outcome !== 'nothing' && outcome !== 'buildup') return baseLine
    if (rng.next() >= MODIFIER_CHANCE) return baseLine
    if (sentOff[atk] > 0) {
      return `${pick(DOWN_TO_TEN_FLAVOUR)} — ${baseLine}`
    }
    const ss = getScoreState(atk)
    return `${pick(MODIFIERS[currentTimeBucket][ss])} — ${baseLine}`
  }

  // After a goal goes in: bump the score, push reaction lines for late
  // drama (minute >= 86) and equaliser/comeback transitions.
  function reactToGoal(atk: Side, atkName: string, minute: number, lines: string[]): void {
    const preState = getScoreState(atk)
    if (atk === 'home') score.home += 1
    else score.away += 1
    const postState = getScoreState(atk)

    if (minute >= LATE_GOAL_THRESHOLD) {
      lines.push(`  ${pick(LATE_GOAL_REACTIONS)()}`)
    }
    if (preState === 'trailing' && postState === 'level') {
      lines.push(`  ${pick(EQUALISER_REACTIONS)(atkName)}`)
    } else if (preState === 'trailing' && postState === 'leading') {
      lines.push(`  ${pick(COMEBACK_LEAD_REACTIONS)(atkName)}`)
    }
  }

  return {
    openMatch(home, away, weather) {
      const out: string[] = [pick(KICKOFF_LINES)(home, away)]
      const w = WEATHER_KICKOFF[weather]
      if (w) out.push(w)
      return out
    },

    beat(ev, homeSquad, awaySquad) {
      const lines: string[] = []
      const atk = ev.attackingTeam
      const atkSquad = atk === 'home' ? homeSquad : awaySquad
      const defSquad = atk === 'home' ? awaySquad : homeSquad
      const atkName = atkSquad.name
      const z = zonePhrase(ev.zone)
      currentTimeBucket = getTimeBucket(ev.minute)

      // Stoppage announcement — fires once on the first beat with minute > 90.
      if (ev.minute > 90 && !stoppageAnnounced) {
        stoppageAnnounced = true
        lines.push(pick(STOPPAGE_ANNOUNCEMENT)())
      }

      // Base outcome line.
      if (ev.outcome === 'nothing') {
        const base = pick(NOTHING_LINES)(atkName, z)
        lines.push(applyModifier(base, ev.outcome, atk))
      } else if (ev.outcome === 'buildup') {
        const base = pick(BUILDUP_LINES)(atkName, z)
        lines.push(applyModifier(base, ev.outcome, atk))
      } else if (ev.outcome === 'chance' && ev.chanceDetail) {
        const c = ev.chanceDetail
        const shooter = nameOf(atkSquad, c.shooter)
        const quality = c.quality === 'clear_cut' ? 'a clear-cut chance' : 'a half chance'
        let leadIn = pick(CHANCE_LINES)(atkName, quality, z)
        if (c.assister) leadIn += ` Set up by ${nameOf(atkSquad, c.assister)}.`
        lines.push(leadIn)
        if (c.goal) {
          lines.push(`  ${pick(GOAL_LINES)(shooter, atkName)}`)
          reactToGoal(atk, atkName, ev.minute, lines)
        } else if (c.saved) {
          lines.push(`  ${pick(SAVE_LINES)(shooter, gkName(defSquad))}`)
        } else {
          lines.push(`  ${pick(OFF_TARGET_LINES)(shooter)}`)
        }
      } else if (ev.outcome === 'foul' && !ev.foulDetail?.fouler && ev.foulDetail?.injury) {
        // Pure injury — no fouler attached.
        const victimSide = sideOf(ev.foulDetail.victim, homeSquad, awaySquad)
        const victimSquad = victimSide === 'home' ? homeSquad : awaySquad
        const victimName = victimSide ? nameOf(victimSquad, ev.foulDetail.victim) : 'A player'
        lines.push(`  🏥 ${victimName} pulls up injured.`)
      }

      // Foul handling — overlaps with chance/foul outcomes.
      if (ev.foulDetail && ev.foulDetail.fouler) {
        const f = ev.foulDetail
        const foulerSide = sideOf(f.fouler, homeSquad, awaySquad)
        const victimSide = sideOf(f.victim, homeSquad, awaySquad)
        const foulerSquad = foulerSide === 'home' ? homeSquad : awaySquad
        const victimSquad = victimSide === 'home' ? homeSquad : awaySquad
        const foulerName = foulerSide ? nameOf(foulerSquad, f.fouler) : f.fouler
        const victimName = victimSide ? nameOf(victimSquad, f.victim) : f.victim
        const foulerTeam = foulerSide === 'home' ? homeSquad.name : awaySquad.name
        lines.push(`  ${pick(FOUL_LINES)(foulerName, victimName)}`)
        if (f.card === 'yellow') {
          lines.push(`  🟨 Yellow card — ${foulerName} (${foulerTeam}).`)
        } else if (f.card === 'second_yellow' || f.card === 'red') {
          const symbol = f.card === 'second_yellow' ? '🟨🟥 Second yellow' : '🟥 Red card'
          lines.push(`  ${symbol} — ${foulerName} (${foulerTeam}) is sent off!`)
          if (foulerSide) {
            sentOff[foulerSide] += 1
            lines.push(`  ${pick(RED_CARD_REACTIONS)(foulerTeam)}`)
          }
        }
        if (f.injury) {
          lines.push(`  🏥 ${victimName} is injured and leaves the field.`)
        }
        if (f.setPiece) {
          // 'corner' is no longer produced from fouls (those are now
          // labeled free_kick — wing fouls are wide free kicks, not
          // corners). The 'corner' kind only appears as the open-play
          // setPieceResult inside cornerTaken handling, which doesn't
          // come through this commentary branch.
          const sp = f.setPiece === 'free_kick' ? 'Free kick' : 'Penalty'
          const isGoal = !!f.setPieceResult?.goal
          // Set-piece goals attribute via setPieceResult.shooterId (now
          // populated by the engine). Fall back to the team if missing.
          const shooterId = f.setPieceResult?.shooterId ?? ev.chanceDetail?.shooter
          const shooter = shooterId ? nameOf(atkSquad, shooterId) : null
          const goalTag = shooter ? ` — ⚽️ GOAL by ${shooter} (${atkName})!` : ` — ⚽️ GOAL for ${atkName}!`
          lines.push(`  ${sp}${isGoal ? goalTag : ' — no goal.'}`)
          if (isGoal) reactToGoal(atk, atkName, ev.minute, lines)
        }
      }

      // Passive injury — separate field on BeatResult, used when a non-foul
      // injury fires alongside an existing foul targeting someone else.
      if (ev.passiveInjury) {
        const injSide = sideOf(ev.passiveInjury, homeSquad, awaySquad)
        const injSquad = injSide === 'home' ? homeSquad : awaySquad
        const injName = injSide ? nameOf(injSquad, ev.passiveInjury) : 'A player'
        lines.push(`  🏥 ${injName} pulls up injured and has to come off.`)
      }

      return lines
    },

    halfTime(homeName, awayName, snapshot) {
      const hs = snapshot.home
      const as = snapshot.away
      const pool: HalfTimePool =
        hs === as ? HALF_TIME_LEVEL : hs > as ? HALF_TIME_HOME_LEADING : HALF_TIME_HOME_TRAILING
      return [pick(pool)(homeName, awayName, hs, as)]
    },

    fullTime(result) {
      const hs = result.score.home
      const as = result.score.away
      const pool: HalfTimePool =
        hs === as ? FULL_TIME_DRAW : hs > as ? FULL_TIME_HOME_WIN : FULL_TIME_AWAY_WIN
      return [pick(pool)(result.homeName, result.awayName, hs, as)]
    }
  }
}

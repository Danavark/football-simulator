// runMatch — the public entry. Sets up state, loops processBeat across
// ~45 beats (~90 minutes), then builds the result. runMatchPausable wraps
// the same loop in an async generator that yields PauseCheckpoints when
// MatchInput.shouldPause flags an event — the integration point for the
// future pause / decision UI.

import { ROLE_BY_POSITION } from '@/consts/career'
import { FORMATION_SLOTS, SIM_CONSTANTS, WEATHER_PROBABILITIES } from '@/consts/engine'
import { processBeat } from '@/engine/beat'
import { applyDecisions } from '@/engine/decisions'
import { adaptTactics } from '@/engine/mechanics/tactics'
import { createRng, type RNG } from '@/lib/rng'
import { computePositionFit } from '@/engine/stats'
import type {
  MatchDecisions,
  MatchInput,
  MatchResult,
  MatchState,
  BeatResult,
  PauseCheckpoint,
  PlayerMatchState,
  PlayerSummary,
  RoleBuffs,
  Side,
  Squad,
  Tactics,
  TeamTotals,
  WeatherCondition
} from '@/types'

// Default — no legends, all roles read at full strength.
const NO_LEGEND_BUFFS: RoleBuffs = { GK: 1, DEF: 1, MID: 1, ATT: 1 }

// Build the initial mutable match state from a MatchInput. Rolls the
// pre-match referee strictness, weather, and seeds per-player tracking.
export function initializeMatchState(input: MatchInput, rng: RNG): MatchState {
  const referee = pickReferee(rng)
  const weather = pickWeather(rng)

  // Clone the mutable bits — lineup and tactics — so per-match auto-subs
  // and tactical adaptation don't leak into the caller's Squad/Tactics
  // objects. (Cards/subs arrays stay shared since they're immutable data.)
  return {
    minute: 0,
    beat: 0,
    score: { home: 0, away: 0 },
    // Home-advantage tilt: crowd, familiarity, no travel. Away-stamina
    // drain penalty is applied separately in stamina.ts.
    momentum: SIM_CONSTANTS.HOME_ADVANTAGE_MOMENTUM,
    ballZone: 'midfield',
    homeSquad: { ...input.homeSquad, lineup: input.homeSquad.lineup.map((l) => ({ ...l })) },
    awaySquad: { ...input.awaySquad, lineup: input.awaySquad.lineup.map((l) => ({ ...l })) },
    homeTactics: { ...input.homeTactics },
    awayTactics: { ...input.awayTactics },
    homeBaseMentality: input.homeTactics.mentality,
    awayBaseMentality: input.awayTactics.mentality,
    players: {
      home: initPlayers(input.homeSquad, 'home', input.homeTactics, input.homeLegendBuffs ?? NO_LEGEND_BUFFS, input.fitness?.home),
      away: initPlayers(input.awaySquad, 'away', input.awayTactics, input.awayLegendBuffs ?? NO_LEGEND_BUFFS, input.fitness?.away)
    },
    events: [],
    config: {
      refereeStrictness: referee,
      weather
    },
    seed: rng.seed,
    rngState: rng.getState(),
    subsUsed: { home: 0, away: 0 }
  }
}

// Roll referee strictness: roughly even split between lenient/normal/strict.
function pickReferee(rng: RNG): number {
  const r = rng.next()
  if (r < 0.33) return SIM_CONSTANTS.REF_LENIENT
  if (r < 0.66) return SIM_CONSTANTS.REF_NORMAL
  return SIM_CONSTANTS.REF_STRICT
}

// Roll the pre-match weather. Most matches are clear; rain shows up
// moderately, wind less, snow rarely. See WEATHER_PROBABILITIES.
function pickWeather(rng: RNG): WeatherCondition {
  return rng.weightedPick(
    WEATHER_PROBABILITIES.map((w) => w.weather),
    WEATHER_PROBABILITIES.map((w) => w.weight)
  )
}

// Count how many of the given starting-11 cards share the target country.
// Used to seed each card's chemistry value pre-match. The target card
// itself is excluded from the count.
function countSameCountry(
  target: { id: string; country: string },
  starters: { id: string; country: string }[]
): number {
  let n = 0
  for (const s of starters) {
    if (s.id !== target.id && s.country === target.country) n += 1
  }
  return n
}

// Seed PlayerMatchState entries for every card in a squad. Chemistry,
// position-fit, and legendBuff are pre-computed for starters; subs default
// to chemistry against the starting 11, positionFit 1.0 (refreshed by
// tryAutoSub when they come on), and the same role-based legendBuff as if
// they were on the pitch.
function initPlayers(
  squad: Squad,
  side: Side,
  tactics: Tactics,
  legendBuffs: RoleBuffs,
  fitnessMap?: Record<string, number>
): PlayerMatchState[] {
  const onPitchIds = new Set(squad.lineup.map((l) => l.cardId))
  const starterCountries = squad.cards
    .filter((c) => onPitchIds.has(c.id))
    .map((c) => ({ id: c.id, country: c.country }))

  const slotByCardId = new Map(squad.lineup.map((l) => [l.cardId, l.slot]))
  const formationSlots = FORMATION_SLOTS[tactics.formation]

  return squad.cards.map<PlayerMatchState>((c) => {
    const slot = slotByCardId.get(c.id)
    const positionFit = slot !== undefined ? computePositionFit(c.position, formationSlots[slot]) : 1
    // Account fitness flows in via the optional fitness map. Cards without
    // an entry default to 100 — keeps the engine usable from runners that
    // don't track season state (run-batch, run-single without a profile).
    const startFitness = fitnessMap?.[c.id] ?? 100
    return {
      cardId: c.id,
      side,
      currentFitness: startFitness,
      startFitness,
      isOnPitch: onPitchIds.has(c.id),
      isInjured: false,
      yellowCards: 0,
      redCard: false,
      mode: 'normal',
      matchRating: SIM_CONSTANTS.RATING_START,
      minutesPlayed: 0,
      goals: 0,
      assists: 0,
      foulsCommitted: 0,
      chemistry: countSameCountry({ id: c.id, country: c.country }, starterCountries),
      positionFit,
      legendBuff: legendBuffs[ROLE_BY_POSITION[c.position]]
    }
  })
}

// Public entry point. Seeds the RNG, initialises state, runs beats until
// full time + stoppage, applies clean-sheet bonuses and returns the result.
export function runMatch(input: MatchInput): MatchResult {
  const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff)
  const rng = createRng(seed)
  let state = initializeMatchState(input, rng)

  // 45 beats for 90 minutes (2 min/beat fixed), plus 1–4 stoppage beats.
  // Run while the clock has not reached full time and we have beats left.
  // We use a soft target on beat count to avoid runaway loops.
  while (state.minute < 90 && state.beat < 50) {
    state = processBeat(state, rng)
    adaptTactics(state)
    state.rngState = rng.getState()
  }

  // Stoppage time: a few extra beats after 90.
  const stoppage = rollStoppage(rng)
  for (let i = 0; i < stoppage && state.beat < 55; i++) {
    state = processBeat(state, rng)
    adaptTactics(state)
    state.rngState = rng.getState()
  }

  return finalizeMatch(state)
}

// Async live runner — same logic as runMatch but invokes onBeat between
// every processBeat call so the caller can paint, sleep, prompt, etc.
// For pause/decision support use runMatchPausable instead.
export async function runMatchLive(
  input: MatchInput,
  onBeat: (event: BeatResult, state: MatchState) => void | Promise<void>
): Promise<MatchResult> {
  const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff)
  const rng = createRng(seed)
  let state = initializeMatchState(input, rng)

  while (state.minute < 90 && state.beat < 50) {
    state = processBeat(state, rng)
    adaptTactics(state)
    state.rngState = rng.getState()
    await onBeat(state.events[state.events.length - 1], state)
  }

  const stoppage = rollStoppage(rng)
  for (let i = 0; i < stoppage && state.beat < 55; i++) {
    state = processBeat(state, rng)
    adaptTactics(state)
    state.rngState = rng.getState()
    await onBeat(state.events[state.events.length - 1], state)
  }

  return finalizeMatch(state)
}

// Pausable runner — the engine's offering to the future pause/decision UI.
// Exposed as an async generator so callers iterate via `next(decisions)`,
// yielding a checkpoint when MatchInput.shouldPause flags an event.
//
//   const gen = runMatchPausable(input)
//   let r = await gen.next()
//   while (!r.done) {
//     const decisions = await ui.collectDecisions(r.value)
//     r = await gen.next(decisions)
//   }
//   const result: MatchResult = r.value
//
// The caller can resume with `{}` (no changes) or any combination of
// subs / mentality / formation+lineup. applyDecisions throws on invalid
// input — UI is expected to filter to valid options before sending.
//
// Optional `hooks.onBeat` fires after every beat (before the pause check)
// — same shape as runMatchLive's callback — so paced commentary and
// pause-for-decisions can co-exist in a single runner. Without hooks the
// loop runs flat-out between yields.
export type PausableHooks = {
  onBeat?: (event: BeatResult, state: MatchState) => void | Promise<void>
}

export async function* runMatchPausable(
  input: MatchInput,
  hooks?: PausableHooks
): AsyncGenerator<PauseCheckpoint, MatchResult, MatchDecisions | undefined> {
  const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff)
  const rng = createRng(seed)
  let state = initializeMatchState(input, rng)
  const userSide = input.userSide ?? null

  // After every beat: snapshot RNG state, fire onBeat (so the caller can
  // paint / sleep), then optionally consult the pause predicate. Yielding
  // hands a checkpoint to the caller; resuming with a decisions payload
  // applies it before the next beat runs.
  // (yield is generator-scoped so the trigger block is duplicated across
  // the regular and stoppage loops rather than extracted to a helper.)

  while (state.minute < 90 && state.beat < 50) {
    state = processBeat(state, rng)
    adaptTactics(state)
    state.rngState = rng.getState()

    const lastEvent = state.events[state.events.length - 1]
    if (hooks?.onBeat) await hooks.onBeat(lastEvent, state)

    if (input.shouldPause) {
      const reason = input.shouldPause(state, lastEvent)
      if (reason) {
        const decisions = yield { state, lastEvent, reason, side: userSide }
        if (decisions) state = applyDecisions(state, decisions, input)
      }
    }
  }

  const stoppage = rollStoppage(rng)
  for (let i = 0; i < stoppage && state.beat < 55; i++) {
    state = processBeat(state, rng)
    adaptTactics(state)
    state.rngState = rng.getState()

    const lastEvent = state.events[state.events.length - 1]
    if (hooks?.onBeat) await hooks.onBeat(lastEvent, state)

    if (input.shouldPause) {
      const reason = input.shouldPause(state, lastEvent)
      if (reason) {
        const decisions = yield { state, lastEvent, reason, side: userSide }
        if (decisions) state = applyDecisions(state, decisions, input)
      }
    }
  }

  return finalizeMatch(state)
}

// Shared post-loop work: clean-sheet bonus + result construction.
function finalizeMatch(state: MatchState): MatchResult {
  if (state.score.away === 0) applyCleanSheet(state, 'home')
  if (state.score.home === 0) applyCleanSheet(state, 'away')
  return buildResult(state)
}

// Roll how many extra stoppage-time beats to play.
function rollStoppage(rng: RNG): number {
  return SIM_CONSTANTS.STOPPAGE_MIN_BEATS + Math.floor(rng.next() * (SIM_CONSTANTS.STOPPAGE_MAX_BEATS - SIM_CONSTANTS.STOPPAGE_MIN_BEATS + 1))
}

// Bump rating for the back four + GK on a side that kept a clean sheet.
function applyCleanSheet(state: MatchState, side: Side): void {
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const states = side === 'home' ? state.players.home : state.players.away
  // Defenders + GK: slots 0..4
  for (const slot of [0, 1, 2, 3, 4]) {
    const slotInfo = squad.lineup.find((l) => l.slot === slot)
    if (!slotInfo) continue
    const ps = states.find((p) => p.cardId === slotInfo.cardId)
    if (!ps) continue
    ps.matchRating = Math.min(SIM_CONSTANTS.RATING_MAX, ps.matchRating + SIM_CONSTANTS.RATING_CLEAN_SHEET)
  }
}

// Convert end-of-match MatchState into the public MatchResult: per-player
// summaries plus aggregate totals for batch reporting.
function buildResult(state: MatchState): MatchResult {
  const home = state.players.home
  const away = state.players.away
  const summaries: PlayerSummary[] = []

  function pushSummary(ps: PlayerMatchState, squad: Squad, side: Side) {
    const card = squad.cards.find((c) => c.id === ps.cardId)!
    summaries.push({
      cardId: ps.cardId,
      name: card.name,
      team: side,
      position: card.position,
      minutesPlayed: ps.minutesPlayed,
      startFitness: Math.round(ps.startFitness * 10) / 10,
      endFitness: Math.round(ps.currentFitness * 10) / 10,
      matchRating: Math.round(ps.matchRating * 10) / 10,
      goals: ps.goals,
      assists: ps.assists,
      foulsCommitted: ps.foulsCommitted,
      yellowCards: ps.yellowCards,
      redCard: ps.redCard,
      injured: ps.isInjured
    })
  }
  for (const ps of home) pushSummary(ps, state.homeSquad, 'home')
  for (const ps of away) pushSummary(ps, state.awaySquad, 'away')

  const totals = {
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    injuries: 0,
    corners: 0,
    penalties: 0,
    chancesCreated: 0
  }
  for (const ev of state.events) {
    if (ev.outcome === 'chance') totals.chancesCreated += 1
    if (ev.foulDetail?.injury) totals.injuries += 1
    if (ev.passiveInjury) totals.injuries += 1
    if (ev.foulDetail?.card === 'yellow') totals.yellowCards += 1
    if (ev.foulDetail?.card === 'second_yellow') {
      totals.yellowCards += 1
      totals.redCards += 1
    }
    if (ev.foulDetail?.card === 'red') totals.redCards += 1
    if (ev.foulDetail && ev.foulDetail.fouler !== '') totals.fouls += 1
    if (ev.foulDetail?.setPiece === 'corner') totals.corners += 1
    if (ev.foulDetail?.setPiece === 'penalty') totals.penalties += 1
  }

  const teamTotals = buildTeamTotals(state.events, summaries)

  return {
    seed: state.seed,
    score: state.score,
    homeName: state.homeSquad.name,
    awayName: state.awaySquad.name,
    weather: state.config.weather,
    beats: state.events,
    playerSummaries: summaries,
    totals,
    teamTotals
  }
}

// Aggregate per-team match stats by walking the beat log + summaries.
// Beat-level: possession, shots, on/off target, corners, free kicks, penalties.
// Player-level (from summaries): cards and fouls.
function buildTeamTotals(events: BeatResult[], summaries: PlayerSummary[]): { home: TeamTotals; away: TeamTotals } {
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
  for (const ev of events) {
    const t = ev.attackingTeam === 'home' ? home : away
    if (ev.attackingTeam === 'home') homeBeats += 1
    else awayBeats += 1

    // Shots from open-play chances. Set-piece shots aren't counted here
    // since on/off-target detail isn't tracked for them.
    if (ev.outcome === 'chance' && ev.chanceDetail) {
      t.shots += 1
      if (ev.chanceDetail.onTarget) t.shotsOnTarget += 1
      else t.shotsOffTarget += 1
    }
    // Corners: foul-derived (recorded on foulDetail) + open-play (cornerTaken).
    if (ev.foulDetail?.setPiece === 'corner') t.corners += 1
    if (ev.cornerTaken) t.corners += 1
    if (ev.foulDetail?.setPiece === 'free_kick') t.freeKicks += 1
    if (ev.foulDetail?.setPiece === 'penalty') t.penalties += 1
  }

  const totalBeats = homeBeats + awayBeats
  if (totalBeats > 0) {
    home.possessionPct = Math.round((homeBeats / totalBeats) * 1000) / 10
    away.possessionPct = Math.round((awayBeats / totalBeats) * 1000) / 10
  }

  // Cards + fouls come from per-player summaries (summed by team).
  for (const p of summaries) {
    const t = p.team === 'home' ? home : away
    t.yellowCards += p.yellowCards
    if (p.redCard) t.redCards += 1
    t.fouls += p.foulsCommitted
  }

  return { home, away }
}

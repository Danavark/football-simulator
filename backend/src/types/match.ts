// Match-engine types — input, beat-by-beat state, output. Everything
// runMatch / processBeat / runMatchLive touches is here.

import type { Card, Position, Stats } from '~/types/card'
import type { RoleBuffs } from '~/types/career'
import type { Formation, LineupSlot, Mentality, Squad, Tactics } from '~/types/squad'

// Pitch / weather conditions rolled pre-match. Affects stat reads, injury
// rates, and zone-selection bias.
export type WeatherCondition = 'clear' | 'rain' | 'snow' | 'wind'

// Pre-match rolled config. Future fields slot in here.
export type MatchConfig = {
  refereeStrictness: number // 0.7 | 1.0 | 1.4
  weather: WeatherCondition
}

export type Side = 'home' | 'away'

// The 5 zones a beat can flow through.
export type Zone = 'left_wing' | 'right_wing' | 'centre' | 'long_ball' | 'counter'

// Beat result categories.
export type Outcome = 'nothing' | 'buildup' | 'chance' | 'foul'

// A chance is either a clear-cut opportunity or a half chance.
export type ChanceQuality = 'half_chance' | 'clear_cut'

// Card colours that can be issued for a foul.
export type CardColour = 'yellow' | 'red' | 'second_yellow'

// Kinds of set pieces produced by a foul or buildup.
export type SetPieceKind = 'free_kick' | 'penalty' | 'corner'

// Everything needed to start a match.
export type MatchInput = {
  homeSquad: Squad
  awaySquad: Squad
  homeTactics: Tactics
  awayTactics: Tactics
  seed?: number
  // Optional per-side legend buffs from the user's profile. Omit for AI
  // teams (they don't track legends). Defaulted to all-1.0 when missing.
  homeLegendBuffs?: RoleBuffs
  awayLegendBuffs?: RoleBuffs
  // Optional per-card fitness snapshot the engine uses as starting
  // currentFitness for each player. Account-level fitness lives outside
  // the engine (DB layer); the caller passes it in here per match. Cards
  // without an entry default to 100. Engine reports new fitness on
  // PlayerSummary.endFitness for the caller to write back.
  fitness?: {
    home: Record<string, number>
    away: Record<string, number>
  }
  // Pause/resume — opt-in. When set, runMatchPausable consults the
  // predicate after every beat; if it returns a non-null reason the
  // match yields a checkpoint to the caller, who then resumes by
  // calling .next(decisions). userSide tags which side the user controls
  // (so default triggers can filter "own-side red card" etc.); subsAllowed
  // caps the total subs the engine accepts before refusing further.
  shouldPause?: PausePredicate
  userSide?: Side
  subsAllowed?: number
}

// Predicate the pause system calls after every beat. Returns a PauseReason
// to yield, or null to continue. Caller-side closure can read external
// state (e.g. a user-clicked "pause" flag) to inject 'user_request'.
export type PausePredicate = (state: MatchState, lastEvent: BeatResult) => PauseReason | null

// Why the engine yielded. Drives UI rendering — "RED CARD: reorganize
// your back four" reads differently from "you paused".
export type PauseReason = 'half_time' | 'red_card' | 'injury' | 'goal' | 'user_request' | 'other'

// What the engine hands back when it pauses. Caller renders the state,
// collects decisions, then resumes via iterator.next(decisions).
export type PauseCheckpoint = {
  state: MatchState
  lastEvent: BeatResult
  reason: PauseReason
  // Which side's decisions are expected (mirrors MatchInput.userSide).
  // For v1 this is single-side only — AI is on adaptTactics.
  side: Side | null
}

// What the caller sends back to resume the match. All fields optional —
// `{}` is a valid "no changes, just resume" payload. Engine throws on
// invalid combinations (unknown cardId, formation/lineup mismatch, sub
// cap exceeded, etc.) so the UI's validation has to be tight.
export type MatchDecisions = {
  // List of {off, on} cardId pairs. Subs apply between this beat and the
  // next; minute clock keeps ticking in the meantime (no dead-ball cost).
  subs?: Array<{ off: string; on: string }>
  // New mentality for the user's side. Mirrors the MentalityModifier
  // semantics in possession/zones — takes effect on the next beat.
  mentality?: Mentality
  // New formation. If set, decisions MUST also provide `lineup` — the
  // engine doesn't auto-reshuffle (slot indices change between formations
  // and the right reshuffle is a UX call). Use suggestLineup to compute.
  formation?: Formation
  lineup?: LineupSlot[]
}

// Mutable per-player state tracked over the course of a match.
export type PlayerMatchState = {
  cardId: string
  side: Side
  currentFitness: number // 0–100, drained per beat
  // Snapshot of the fitness this player started the match with — captured
  // at init time so PlayerSummary can report start→end without the caller
  // having to re-derive it from the input fitness map.
  startFitness: number
  isOnPitch: boolean
  isInjured: boolean
  // True once the player has been subbed off (user-initiated sub or
  // auto-sub on injury). Football's no-return-after-sub rule — flagged
  // players cannot be brought back on even if isOnPitch is now false
  // and they're not injured. Set in applySubs / tryAutoSub.
  hasBeenSubbedOff: boolean
  yellowCards: number
  redCard: boolean
  mode: 'normal' | 'aggressive' | 'safe'
  matchRating: number
  minutesPlayed: number
  goals: number
  assists: number
  foulsCommitted: number
  // Number of starting-11 teammates who share this card's country.
  // Pre-computed at match start; feeds the chemistry stat boost.
  chemistry: number
  // Multiplier reflecting how well-suited this card's natural position is
  // to the slot they're playing in. 1.0 = exact match, 0.85 = unrelated.
  // Pre-computed at match start; refreshed by tryAutoSub when a sub
  // comes on into a different slot type.
  positionFit: number
  // Per-role multiplier from the team's club legends (1.0 if none).
  // Pre-computed at match start from MatchInput.{home,away}LegendBuffs.
  legendBuff: number
}

// Result of a chance being created in a beat.
export type ChanceDetail = {
  quality: ChanceQuality
  shooter: string
  assister?: string
  onTarget: boolean
  saved: boolean
  goal: boolean
}

// Result of a foul being committed in a beat.
export type FoulDetail = {
  fouler: string
  victim: string
  card?: CardColour
  injury: boolean
  setPiece?: SetPieceKind
  setPieceResult?: { goal: boolean; shooterId?: string; attempted?: boolean }
}

// One entry in the match log — what happened during a single beat.
export type BeatResult = {
  beat: number
  minute: number
  attackingTeam: Side
  zone: Zone
  outcome: Outcome
  chanceDetail?: ChanceDetail
  foulDetail?: FoulDetail
  // True if a corner was taken this beat (open-play, from a save/buildup).
  // Foul-derived corners are recorded via foulDetail.setPiece instead.
  cornerTaken?: boolean
  // Card id of a player who picked up a passive (non-foul) injury during
  // this beat — set when the passive injury check fires alongside an
  // existing foul, since foulDetail can only carry one victim.
  passiveInjury?: string
  momentum: number
  // Future: stamina snapshot
}

export type MatchEvent = BeatResult

// The full mutable state of a match. The pause system (later) will
// serialise/deserialise this object to suspend and resume.
export type MatchState = {
  minute: number
  beat: number
  score: { home: number; away: number }
  momentum: number // -20 to +20, positive = home
  ballZone: 'defense' | 'midfield' | 'attack'
  homeSquad: Squad
  awaySquad: Squad
  homeTactics: Tactics
  awayTactics: Tactics
  // Mentality the caller chose at kickoff. adaptTactics resets the live
  // tactics back to these every beat before applying its score-based or
  // man-down overrides — without this, a transient injury (forces team
  // defensive briefly) would leave the team stuck defensive after the sub.
  homeBaseMentality: Mentality
  awayBaseMentality: Mentality
  players: {
    home: PlayerMatchState[]
    away: PlayerMatchState[]
  }
  events: MatchEvent[]
  config: MatchConfig
  seed: number
  // PRNG state snapshotted after every beat by the runner. Lets the
  // pause system serialise a match mid-flight — the snapshot of MatchState
  // alone is enough to resume the same RNG stream on the other side of a
  // network round-trip / save-game / page reload.
  rngState: number
  // Total subs each side has used so far this match. Engine increments on
  // every successful sub; applyDecisions refuses further when the count
  // hits MatchInput.subsAllowed.
  subsUsed: { home: number; away: number }
}

// Per-player end-of-match summary line.
export type PlayerSummary = {
  cardId: string
  name: string
  team: Side
  position: Position
  minutesPlayed: number
  // Fitness the player started the match with (account state in, defaults
  // to 100 when MatchInput.fitness is missing) — kept on the summary so
  // the caller can show start→end without re-reading the input.
  startFitness: number
  // Fitness left over after the match. Caller writes this back to the
  // account-level fitness store, then runs applyRecovery before the next
  // match.
  endFitness: number
  matchRating: number
  goals: number
  assists: number
  foulsCommitted: number
  yellowCards: number
  redCard: boolean
  injured: boolean
}

// Per-team aggregated match stats for UI panels and post-match analysis.
export type TeamTotals = {
  possessionPct: number // 0–100
  shots: number
  shotsOnTarget: number
  shotsOffTarget: number
  corners: number
  freeKicks: number
  penalties: number
  yellowCards: number
  redCards: number
  fouls: number
}

// What runMatch returns — the public output of the simulation.
export type MatchResult = {
  seed: number
  score: { home: number; away: number }
  homeName: string
  awayName: string
  weather: WeatherCondition
  beats: BeatResult[]
  playerSummaries: PlayerSummary[]
  totals: {
    fouls: number
    yellowCards: number
    redCards: number
    injuries: number
    corners: number
    penalties: number
    chancesCreated: number
  }
  teamTotals: { home: TeamTotals; away: TeamTotals }
}

// Context passed into getEffectiveStats. Carries the live player state
// (fatigue, chemistry, mode) plus pitch-level conditions (weather). Future
// modifiers — form, position-fit — will slot in here.
export type BeatContext = {
  playerState: PlayerMatchState
  weather: WeatherCondition
}

// Weighted contributions of stats to an attack or defense score.
export type StatWeights = {
  pace?: number
  shooting?: number
  passing?: number
  dribbling?: number
  defending?: number
  physicality?: number
  positioning?: number
}

// The set of attackers and defenders pulled in for a single zone-resolved
// beat, plus their live player states.
export type ZoneMatchup = {
  zone: Zone
  attackers: Card[]
  defenders: Card[]
  attackerStates: PlayerMatchState[]
  defenderStates: PlayerMatchState[]
  attackingSide: Side
  defenderTeamMentality: Mentality
  // How many players the formation slot table expected for each side at
  // this zone. attackers.length / defenders.length can fall short of these
  // when a team is reduced (red card, unreplaced injury) — scoreMatchup
  // uses the ratio to dock the short-handed side's score.
  expectedAttackers: number
  expectedDefenders: number
}

// Re-export Stats so callers that only import from `@/types/match` can
// still reference the 8-stat block. Avoids forcing them to dual-import.
export type { Stats }

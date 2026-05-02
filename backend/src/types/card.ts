// Card-level types — what a player is, before any squad / match context.
// Stats, position, and the card object itself live here. Match-time stat
// reads via getEffectiveStats use these as the persistent source of truth.

// Outfield + GK positions a card can hold.
export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST'

// 8-stat block, each value 1–99. Same shape used for raw and effective stats.
export type Stats = {
  pace: number
  shooting: number
  passing: number
  dribbling: number
  defending: number
  physicality: number
  positioning: number
  stamina: number
}

// Stats after fatigue/chemistry/etc. modifiers are applied.
export type EffectiveStats = Stats

// A single player card. Stats are the raw values; engine reads always go
// through getEffectiveStats() so the runtime values can include modifiers.
export type Card = {
  id: string
  name: string
  position: Position
  country: string
  age: number
  stats: Stats
  injuryProneness: number // 0.0 – 1.0
  // Persistent form multiplier carried between matches. Defaults to 1.0
  // when omitted. Engines never mutate this directly — external persistence
  // layers update it post-match via mechanics/form.ts helpers.
  form?: number
  // Earned stat overlay — additive to natural `stats` when the engine reads.
  // Sourced from match-rating auto-boosts and user XP spend. Engine never
  // mutates these; the career layer (src/career/*) does.
  statBoosts?: Partial<Stats>
  // Hidden per-stat ceilings rolled at card generation. Auto-boost and XP
  // spend both refuse to push a stat past its potential. Not shown in UI.
  statPotentials?: Stats
  // Total stat points the card has gained (sum of statBoosts). Drives the
  // auto-boost damping curve so heavily-boosted cards level slower.
  boostCount?: number
  // Persistent injury status. Cleared (back to 'active') when the
  // returnsAfterMatch counter ticks to 0, or via XP-spent healing.
  injuryStatus?: 'active' | 'injured' | 'retired'
  injurySeverity?: 'knock' | 'light' | 'medium' | 'heavy'
  injuryReturnsAfterMatch?: number
}

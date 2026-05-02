// Career-layer types — XP, profiles, club legends. Match-engine code
// doesn't see these directly; they flow into a match via MatchInput
// (legend buffs precomputed) and out via post-match progression code.

// Role group derived from a card's position. Used by the legend buff system
// to scope retired-player bonuses to a section of the team.
export type RoleGroup = 'GK' | 'DEF' | 'MID' | 'ATT'

// Per-role multipliers fed in via MatchInput. Default to 1.0 when omitted.
// Computed from a profile's club legends in src/career/legends.ts.
export type RoleBuffs = {
  GK: number
  DEF: number
  MID: number
  ATT: number
}

// One retired player honored as a club legend. Buff is precomputed at
// retirement based on the legend's stack position within its role group
// (1st = +5%, 2nd = +3%, …) so future legend additions don't retroactively
// shrink existing buffs.
export type Legend = {
  retiredCardId: string
  role: RoleGroup
  retiredInSeason: number
  buffPct: number // 0.05 = +5%
}

// Account-level player profile. Owns the XP balance and accumulated
// legends. Stored at profile-scope, not on any single card. The career
// layer mutates this; the engine reads from it indirectly via MatchInput.
export type Profile = {
  id: string
  displayName: string
  xpBalance: number // never negative
  totalXpEarned: number // lifetime, monotonic
  legends: Legend[]
}

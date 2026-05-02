// All tunable numbers for the progression layer in one place. Mirrors the
// pattern of consts/engine.ts:SIM_CONSTANTS — anything you'd be tempted
// to inline as a magic number lives here instead.
//
// Spec: docs/06_progression-and-balance.md.

import type { RoleGroup } from '~/types'

export const PROGRESSION_CONSTANTS = {
  // ── XP earn (per-event, summed into a per-match total) ───────────────────
  xpRewards: {
    appearance: 50, // applied once per match the user's team played
    rating60: 10, // per player on user's team meeting threshold
    rating70: 20,
    rating80: 40,
    rating90: 80,
    rating100: 160, // perfect 10 — rare, heroic-tier reward

    goal: 30,
    assist: 20,
    cleanSheetPerDefender: 25, // per GK + defender on the pitch at full time
    win: 50,
    draw: 20
  },
  xpPenalties: {
    goalConceded: 50, // per goal the user's team conceded
    yellow: 20,
    red: 100,
    foul: 0
  },

  // ── XP spend — tiered cost to push a stat by +1 ──────────────────────────
  // Cost looks at the *current* stat value (natural + earned boosts).
  // Bands are inclusive on the upper bound. Cap is the array's last entry
  // since stats are clamped to 99 elsewhere.
  upgradeCosts: [
    { upTo: 60, cost: 100 },
    { upTo: 75, cost: 200 },
    { upTo: 85, cost: 400 },
    { upTo: 93, cost: 800 },
    { upTo: 99, cost: 1600 }
  ] as const,

  // ── Auto-boost (rating-driven, card-level) ───────────────────────────────
  autoBoost: {
    minRating: 7.0, // below this → no chance at all
    chance70: 0.25,
    chance80: 0.55,
    chance90: 0.8,
    chance100: 1.0,
    // chance is divided by (1 + boost_count * dampingPerBoost)
    levelDampingPerBoost: 0.05,
    // bias toward identity-defining stats when picking which one to bump
    highBandWeight: 2,
    midBandWeight: 1
    // low-band stats are NEVER auto-boosted (manual XP spend can target them)
  },

  // ── Hidden potentials (per-stat ceilings rolled at generation) ───────────
  // Tuned so a young 60-overall card has a realistic shot at growing into
  // an 80-overall through XP + auto-boost over a career. Low-band ceiling
  // stays modest to preserve position identity (a CB never becomes a
  // 75-shooting striker). Mid/high bands carry most of the lift.
  potentialBands: {
    high: { headroomMin: 20, headroomMax: 40, ceiling: 99 },
    mid: { headroomMin: 15, headroomMax: 30, ceiling: 88 },
    low: { headroomMin: 5, headroomMax: 18, ceiling: 77 }
  },

  // ── Injuries ─────────────────────────────────────────────────────────────
  injurySeverityWeights: {
    knock: 0.45,
    light: 0.35,
    medium: 0.15,
    heavy: 0.05
  },
  injuryDurations: {
    knock: { min: 0, max: 0 }, // off this match only
    light: { min: 1, max: 1 },
    medium: { min: 2, max: 3 },
    heavy: { min: 4, max: 5 }
  },
  maxConcurrentInjuriesPerTeam: 2, // 3rd+ injury rolled in a match → knock
  healCosts: {
    knock: 0, // not heal-able; resolves naturally
    light: 100,
    medium: 400,
    heavy: 1200
  },

  // ── Aging + retirement ───────────────────────────────────────────────────
  retirementAge: 40,
  // Card generation age range. Max is held below `retirementAge` so every
  // freshly-generated card has at least 5 playable seasons before age-out.
  generationAgeMin: 18,
  generationAgeMax: 35,
  // Lower-bound for procedurally-generated league teams (older average than
  // a fresh-pull starter pack — these are seasoned pros, not academy
  // graduates). Upper bound shares `generationAgeMax` so the 5-season floor
  // is universal.
  teamGenerationAgeMin: 22,
  // Floor on the age-headroom multiplier so even older cards retain
  // meaningful growth potential. Without this, a 32-year-old gets ~0.36×
  // headroom (linear taper from 18→35) and a 60-overall can never reach
  // 80. With a 0.5 floor, every card has at least half the band headroom
  // available regardless of age.
  ageHeadroomFloor: 0.5,

  // ── Club legends — stack-position → permanent buff (% as decimal) ────────
  // Index 0 = first legend in role, index 1 = second, etc. Index 3 is
  // re-used for every legend beyond the third (1% each, additively).
  legendBuffsByStackPos: [0.05, 0.03, 0.02, 0.01],

  // ── Fitness recovery between matches ─────────────────────────────────────
  // applyRecovery (career/fitness.ts) tops up account fitness for every
  // card after a match — played and unplayed alike. The amount per card is
  //   max(0, (staminaStat - threshold) × rate)
  // capped at 100. So a stamina-30 player recovers 0; stamina-100 recovers
  // 42. Low-stamina players need multiple matches' rest to fully recover
  // from a hard match; high-stamina players bounce back fast.
  fitness: {
    recoveryThreshold: 30,
    recoveryRate: 0.6,
    seasonStart: 100,
    cap: 100
  }
} as const

// Map a position to its role group. Used for legend buff scoping.
export const ROLE_BY_POSITION = {
  GK: 'GK',
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  CDM: 'MID',
  CM: 'MID',
  CAM: 'MID',
  LM: 'MID',
  RM: 'MID',
  LW: 'ATT',
  RW: 'ATT',
  ST: 'ATT'
} as const satisfies Record<string, RoleGroup>

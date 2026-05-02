// Card-generation constants. Tunable knobs for how stats roll, banded by
// position. Mirrors the SIM_CONSTANTS / PROGRESSION_CONSTANTS pattern —
// every magic number that controls card generation lives here.

import type { Position, Stats } from '@/types'

// Tier knob applied at generation. Shifts every rolled stat up or down so
// rookie/pro/super/legend teams sit predictably below/above the semipro
// baseline. Each step is roughly +6 overall on a 4-3-3 procgen squad,
// with super/legend high-band stats hitting the globalCeiling cap.
export type StatTier = 'rookie' | 'semipro' | 'pro' | 'super' | 'legend'

// The three quality bands a stat can fall into. POSITION_PROFILE maps
// every (position, stat) pair to one of these.
export type StatBand = 'low' | 'mid' | 'high'

// Structural data table. For each of 12 positions, which band each of the
// 8 stats falls into. Mirrors the position guidelines in 01_project-brief.
// GK uses the same shape as outfielders — defending/positioning/physicality
// are 'high' (they drive the save formula); pace/shooting/dribbling are 'low'.
export const POSITION_PROFILE: Record<Position, Record<keyof Stats, StatBand>> = {
  GK: {
    pace: 'low',
    shooting: 'low',
    passing: 'mid',
    dribbling: 'low',
    defending: 'high',
    physicality: 'high',
    positioning: 'high',
    stamina: 'mid'
  },
  CB: {
    pace: 'mid',
    shooting: 'low',
    passing: 'mid',
    dribbling: 'low',
    defending: 'high',
    physicality: 'high',
    positioning: 'high',
    stamina: 'mid'
  },
  LB: {
    pace: 'high',
    shooting: 'low',
    passing: 'mid',
    dribbling: 'mid',
    defending: 'high',
    physicality: 'mid',
    positioning: 'mid',
    stamina: 'high'
  },
  RB: {
    pace: 'high',
    shooting: 'low',
    passing: 'mid',
    dribbling: 'mid',
    defending: 'high',
    physicality: 'mid',
    positioning: 'mid',
    stamina: 'high'
  },
  CDM: {
    pace: 'low',
    shooting: 'low',
    passing: 'mid',
    dribbling: 'low',
    defending: 'high',
    physicality: 'high',
    positioning: 'high',
    stamina: 'mid'
  },
  CM: {
    pace: 'mid',
    shooting: 'mid',
    passing: 'high',
    dribbling: 'mid',
    defending: 'mid',
    physicality: 'mid',
    positioning: 'high',
    stamina: 'high'
  },
  CAM: {
    pace: 'mid',
    shooting: 'mid',
    passing: 'high',
    dribbling: 'high',
    defending: 'low',
    physicality: 'low',
    positioning: 'high',
    stamina: 'mid'
  },
  LM: {
    pace: 'high',
    shooting: 'mid',
    passing: 'mid',
    dribbling: 'high',
    defending: 'mid',
    physicality: 'mid',
    positioning: 'mid',
    stamina: 'high'
  },
  RM: {
    pace: 'high',
    shooting: 'mid',
    passing: 'mid',
    dribbling: 'high',
    defending: 'mid',
    physicality: 'mid',
    positioning: 'mid',
    stamina: 'high'
  },
  LW: {
    pace: 'high',
    shooting: 'mid',
    passing: 'mid',
    dribbling: 'high',
    defending: 'low',
    physicality: 'low',
    positioning: 'mid',
    stamina: 'mid'
  },
  RW: {
    pace: 'high',
    shooting: 'mid',
    passing: 'mid',
    dribbling: 'high',
    defending: 'low',
    physicality: 'low',
    positioning: 'mid',
    stamina: 'mid'
  },
  ST: {
    pace: 'mid',
    shooting: 'high',
    passing: 'low',
    dribbling: 'mid',
    defending: 'low',
    physicality: 'mid',
    positioning: 'high',
    stamina: 'low'
  }
}

export const CARD_CONSTANTS = {
  // Numeric range for each band before tier bonus + floors are applied.
  // Bands deliberately overlap a little (low/mid both touch 45–50) so the
  // distribution looks naturalistic rather than three discrete clusters.
  bandRanges: {
    low: [30, 50],
    mid: [50, 70],
    high: [70, 90]
  },

  // Flat shift to all rolled stats for a given tier. Each step adds ~6 to
  // the team overall on a 4-3-3 procgen squad; super/legend push high-band
  // rolls into the globalCeiling cap (95) so elite teams max out their
  // headline stats. Expected team overalls on a 4-3-3 procgen squad:
  //   rookie ≈ 63 · semipro ≈ 69 · pro ≈ 75 · super ≈ 80 · legend ≈ 84
  tierBonus: {
    rookie: 0,
    semipro: 6,
    pro: 12,
    super: 18,
    legend: 24
  },

  // Per-stat absolute minimum applied AFTER tier bonus. Stats not listed
  // fall back to `globalFloor`. Use this to prevent unplayable rolls — a
  // striker with 22 stamina is gassed by minute 30 and never functions.
  statFloors: {
    stamina: 40 // every player needs baseline endurance to last 90 minutes
  } as Partial<Record<keyof Stats, number>>,

  // Global clamp applied to every rolled stat. Stats with a higher specific
  // floor in `statFloors` use that instead.
  globalFloor: 15,
  globalCeiling: 95
} as const

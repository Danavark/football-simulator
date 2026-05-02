// All tunable simulation constants live here. Tweak and re-run.
// Sections: beat resolution, goal resolution, fouls, set pieces,
// injuries, stamina, momentum, possession, ratings, formations, zones.

import type { Formation, Position, Stats, StatWeights, WeatherCondition, Zone } from '~/types'

export const SIM_CONSTANTS = {
  // Beat resolution: how attack/defense delta becomes a chance.
  // Thresholds scaled to fit our 90-beat (1 minute each) match — half
  // the per-beat probability of when beats were 2 minutes long, so
  // per-match chance counts stay in target range.
  SCALE_FACTOR: 18,
  CHANCE_THRESHOLD: 0.115,
  BUILDUP_THRESHOLD: 0.23,
  INDIVIDUAL_BRILLIANCE_GAP: 15,
  INDIVIDUAL_BRILLIANCE_CHANCE: 0.0145,

  // Goal resolution
  // Note: spec values produced ~0.55-0.7 goals/match in batch testing.
  // GK modifiers tuned down to land in the 2.5-2.8 goals/match target band.
  CLEAR_CUT_BASE: 0.38,
  CLEAR_CUT_DELTA_WEIGHT: 0.008,
  CLEAR_CUT_MOMENTUM_WEIGHT: 0.003,
  CLEAR_CUT_MIN: 0.15,
  CLEAR_CUT_MAX: 0.65,
  CLEAR_CUT_MODIFIER_CLEAR: 0.9,
  CLEAR_CUT_MODIFIER_HALF: 0.6,
  GK_MODIFIER_CLEAR: 0.28,
  GK_MODIFIER_HALF: 0.46,

  // Fouls
  // Tuned for 90 beats per match (1 minute each). Halved from the
  // 0.49-per-beat rate that worked for 45 beats × 2 mins.
  BASE_FOUL_RATE: 0.245,
  FOUL_SKILL_WEIGHT: 0.002,
  FOUL_PHYS_BONUS: 0.015,
  FOUL_MENTALITY_ATTACKING: 0.015,
  FOUL_MENTALITY_DEFENSIVE: 0,
  FOUL_STAMINA_WEIGHT: 0.025,
  // Reduced from spec 0.20 to keep yellows in range with the higher foul rate
  // and to limit the "two yellows = red" cascade.
  YELLOW_BASE_CHANCE: 0.13,
  RED_BASE_CHANCE: 0.0035,
  TACTICAL_FOUL_MULTIPLIER: 1.4,
  ATTACKING_ZONE_MULTIPLIER: 1.3,
  // Spec 0.08 produced too many penalties; target is 1 per 10-15.
  PENALTY_FRACTION_OF_FOUL: 0.0033,

  // Set piece resolution: free kicks, penalties, corners.
  FREE_KICK_BASE_CONVERSION: 0.12,
  PENALTY_CONVERSION_FACTOR: 0.85,
  PENALTY_CONVERSION_MIN: 0.65,
  PENALTY_CONVERSION_MAX: 0.9,
  // Bumped after the wing-foul-as-corner mislabel was fixed: corners
  // now only come from open-play (saves and buildups), so each path
  // needs to fire more often to keep corners-per-match near target.
  CORNER_AFTER_SAVE: 0.85,
  CORNER_AFTER_BUILDUP: 0.7,
  CORNER_DELIVERY_WEIGHT: 0.4,

  // Injuries
  // Heavily scaled down from spec to hit the target of 1 every 5-8 matches.
  // Passive runs once per beat (so passive rates scale with beat count);
  // foul-injury runs per foul (so those rates stay beat-independent).
  // Tuned after exposing previously-silent passive injuries that fired in
  // foul beats — the visible rate had been ~half the actual rate.
  INJURY_BASE_RATE: 0.00006,
  INJURY_PRONENESS_WEIGHT: 0.0024,
  INJURY_FATIGUE_WEIGHT: 0.002,
  INJURY_FRAILTY_WEIGHT: 0.0012,
  INJURY_FOUL_RATE: 0.001,
  INJURY_FOUL_PRONENESS_WEIGHT: 0.0024,
  INJURY_FOUL_FATIGUE_WEIGHT: 0.002,
  INJURY_FOUL_FRAILTY_WEIGHT: 0.001,

  // Fitness drain per beat + half-time recovery + goal-adrenaline boost.
  // Drain rates lowered from spec so weak teams don't bottom out at 0 by
  // full-time. Combined with FITNESS_STAT_DRAIN_FLOOR below, a stamina-40
  // ST ends a clean 90 at ~25-30%; a stamina-90 GK at ~80%.
  // Tuning anchors:
  //   • Most involved attacking-team forward: ends ~25%
  //   • Least involved defensive-team GK / cover: ends ~60%
  //   • Tier differentiation lives in FITNESS_STAT_DRAIN_FLOOR/CEIL below.
  BASE_STAMINA_DRAIN: 0.45,
  ACTION_STAMINA_DRAIN: 0.125,
  MENTALITY_DRAIN_ATTACKING: 0.075,
  MENTALITY_DRAIN_DEFENSIVE: -0.025,
  // The drain divisor is `100 / clamp(FLOOR, CEIL, staminaStat)` — both
  // ends compressed so the curve only matters in the 60-70 band where most
  // outfielders sit. Floor at 60 stops rookie players from running out of
  // legs; ceiling at 70 stops legend players from coasting through 90 mins
  // — every player should still be visibly tired by full-time.
  FITNESS_STAT_DRAIN_FLOOR: 60,
  FITNESS_STAT_DRAIN_CEIL: 65,
  HALFTIME_RECOVERY: 10,
  HALFTIME_BEAT: 45,
  GOAL_STAMINA_BOOST: 3,

  // Momentum: per-event swings and per-beat decay.
  MOMENTUM_GOAL: 7,
  MOMENTUM_CONCEDE: -4,
  MOMENTUM_CHANCE: 3,
  MOMENTUM_CHANCE_CONCEDED: -1,
  MOMENTUM_GOOD_DEFENSE: 1,
  MOMENTUM_DECAY: 0.0145,
  MOMENTUM_MIN: -20,
  MOMENTUM_MAX: 20,

  // Possession: how midfield delta and momentum bend the home/away split.
  MIDFIELD_WEIGHT: 0.003,
  MOMENTUM_WEIGHT: 0.005,
  MENTALITY_MODIFIER: 0.03,
  // Per-player on-pitch advantage applied to homeBeatChance. A 1-man
  // disadvantage (red card or unreplaced injury) shifts possession by
  // ~20 percentage points; 2-man by ~40pp. Tuned upward after observing
  // momentum from early goals cancelled out a softer 0.10 weight.
  PLAYER_COUNT_WEIGHT: 0.2,

  // Attacking-mentality upside. Without these the attacking-team penalties
  // (counter vulnerability, fouls when defending, stamina drain) outweigh
  // the +0.03 possession bias and attacking ends up the worst mentality in
  // head-to-head testing. These bonuses apply only when the attacking-
  // mentality team is in possession this beat — pure offensive payoff for
  // the risk being taken.
  ATTACKING_CHANCE_THRESHOLD_BONUS: 0.04, // adds to CHANCE_THRESHOLD this beat
  ATTACKING_CLEAR_CUT_BONUS: 0.1, // adds to CLEAR_CUT_BASE in stage 1

  // Counter-attack defender penalty when opponent is attacking. Softened
  // from 15 to 8 — at 15 the counter penalty alone made attacking
  // mentality a net negative even with offensive payoffs. 8 still hurts
  // (enough to keep counter as a real threat) without making attacking
  // suicidal vs defensive opponents.
  COUNTER_DEFENDER_POSITIONING_PENALTY: 8,

  // Beat pacing: minutes advanced per beat + stoppage range.
  // Fixed 1 min/beat = 90 beats per 90-minute match. Per-beat event
  // probabilities (chance, foul, injury) are halved against the prior
  // 2-min/beat numbers so per-match totals stay near targets.
  BEAT_MIN_MINUTES: 1,
  BEAT_MAX_MINUTES: 1,
  STOPPAGE_MIN_BEATS: 2,
  STOPPAGE_MAX_BEATS: 8,

  // Match-rating deltas applied per event, plus the rating clamps.
  RATING_GOAL: 1.5,
  RATING_ASSIST: 1.0,
  RATING_KEY_PASS: 0.5,
  RATING_BUILDUP: 0.2,
  RATING_GOOD_DEFENSE: 0.2,
  RATING_SAVE: 0.4,
  RATING_FOUL: -0.3,
  RATING_YELLOW: -0.5,
  RATING_RED: -1.5,
  RATING_GOAL_CONCEDED: -0.4,
  RATING_CLEAN_SHEET: 0.8,
  RATING_MIN: 1.0,
  RATING_MAX: 10.0,
  RATING_START: 6.0,

  // Referee strictness multipliers applied to card rolls.
  REF_LENIENT: 0.7,
  REF_NORMAL: 1.0,
  REF_STRICT: 1.4,

  // Mid-match tactical adaptation thresholds. After these minutes, a
  // significant score gap forces leading/trailing teams into defensive/
  // attacking mentalities respectively.
  TACTICS_ADAPT_MINUTE_BIG: 60, // 2+ goal swing kicks in here
  TACTICS_ADAPT_MINUTE_SMALL: 75, // 1+ goal swing kicks in here

  // Chemistry bonus per same-country teammate among the starting 11.
  // Applied as a stat-read multiplier in getEffectiveStats. With max 10
  // same-country teammates, peak boost is +5% on every stat read.
  CHEMISTRY_BONUS_PER_TEAMMATE: 0.005,

  // Position fit — multipliers for a card playing a slot whose expected
  // position differs from theirs. Distance is the index in the destination
  // slot's POSITION_AFFINITY ladder; 0 = exact, higher = worse fit.
  POSITION_FIT_EXACT: 1.0, // CB in CB slot
  POSITION_FIT_NEIGHBOR: 0.96, // CDM in CB slot
  POSITION_FIT_TWO_AWAY: 0.92, // LB in CB slot
  POSITION_FIT_THREE_AWAY: 0.88, // RB in CB slot
  POSITION_FIT_UNRELATED: 0.7, // ST in CB slot — wholly out of role
  // Outfielder ↔ keeper swap. Real-world an outfielder going in goal
  // saves maybe 10-20% of what a real keeper would (and a keeper trying
  // to score from open play is even worse). 0.3× makes the swap visibly
  // catastrophic — clear-cut chances become near-certain goals against
  // the makeshift keeper.
  POSITION_FIT_GK_MISMATCH: 0.3,

  // Yellow-card-aware "safe mode" — cautious defenders pull out of
  // tackles, dropping their effective defending. Aggressive mode is the
  // mirror (currently unused; reserved for future user-chosen tactics).
  MODE_SAFE_DEFENDING_MULTIPLIER: 0.92,
  MODE_AGGRESSIVE_DEFENDING_MULTIPLIER: 1.05,

  // Home advantage — initial momentum bias plus an away-team stamina
  // drain penalty (travel fatigue, hostile crowd, unfamiliar pitch).
  HOME_ADVANTAGE_MOMENTUM: 5,
  AWAY_STAMINA_DRAIN_MULTIPLIER: 1.05,

  // Form — per-rating-point delta applied post-match, clamped to a band.
  // A 6.0 rating produces 0 change (the starting / "average game" line).
  FORM_DELTA_PER_RATING: 0.02,
  FORM_MIN: 0.85,
  FORM_MAX: 1.15
}

// ---------------------------------------------------------------------------
// Weather — per-condition stat multipliers, injury bonuses, zone biases.
// Rolled once pre-match in initializeMatchState and stored on MatchConfig.
// ---------------------------------------------------------------------------

// Multiplicative modifiers per stat. Missing entries imply 1.0 (no change).
export type WeatherStatMods = Partial<Record<keyof Stats, number>>

export const WEATHER_MODS: Record<
  WeatherCondition,
  {
    stats: WeatherStatMods
    injuryBonus: number // Added to per-beat injury probability.
    zoneBias: Partial<Record<Zone, number>>
  }
> = {
  // Default conditions — no effect anywhere.
  clear: {
    stats: {},
    injuryBonus: 0,
    zoneBias: {}
  },
  // Wet pitch: slower legs, easier slips, ball gets stuck. Per-spec injury
  // bump (~0.0008 over the per-beat passive rate of 0.00023).
  rain: {
    stats: { pace: 0.93, dribbling: 0.95 },
    injuryBonus: 0.0008,
    zoneBias: { centre: -0.02, long_ball: 0.02 }
  },
  // Snow: pace and ball control hit hard; long ball more attractive.
  snow: {
    stats: { pace: 0.85, dribbling: 0.85, passing: 0.92 },
    injuryBonus: 0.0012,
    zoneBias: { long_ball: 0.04, counter: -0.03 }
  },
  // Wind: passing and shooting accuracy suffer; long balls blow off course.
  wind: {
    stats: { passing: 0.92, shooting: 0.95 },
    injuryBonus: 0,
    zoneBias: { long_ball: -0.04, centre: 0.02 }
  }
}

// Pick probabilities for the pre-match weather roll. Most matches are clear;
// rain shows up moderately often, wind less, snow rarely.
export const WEATHER_PROBABILITIES: { weather: WeatherCondition; weight: number }[] = [
  { weather: 'clear', weight: 0.65 },
  { weather: 'rain', weight: 0.2 },
  { weather: 'wind', weight: 0.1 },
  { weather: 'snow', weight: 0.05 }
]

// ---------------------------------------------------------------------------
// Position affinity ladder — for each slot position, the order in which
// other positions can substitute when no exact match is available. The
// first entry is always the position itself. Used by the squad assembler
// (initial lineup) and the in-match auto-sub logic.
// ---------------------------------------------------------------------------

// Each entry is an ordered ladder of acceptable substitutes. Index 0 is
// always the position itself (exact match → 1.0×). Index 1 is "neighbor"
// (0.96×), index 2 is "two away" (0.92×), index 3+ is "three+ away"
// (0.88×). Anything not in the ladder gets POSITION_FIT_UNRELATED.
//
// Wide positions (LB/RB, LM/RM, LW/RW) cross-list each other at the end
// of the ladder so a wrong-foot wide player still reads at 0.88× rather
// than the unrelated 0.7× — they can do the job, just not as well.
export const POSITION_AFFINITY: Record<Position, Position[]> = {
  GK: ['GK'],
  CB: ['CB', 'CDM', 'LB', 'RB'],
  LB: ['LB', 'LM', 'CB', 'LW', 'RB'],
  RB: ['RB', 'RM', 'CB', 'RW', 'LB'],
  CDM: ['CDM', 'CM', 'CB', 'CAM'],
  CM: ['CM', 'CDM', 'CAM', 'LM', 'RM'],
  CAM: ['CAM', 'CM', 'LW', 'RW', 'ST'],
  LM: ['LM', 'LW', 'LB', 'CM', 'RM'],
  RM: ['RM', 'RW', 'RB', 'CM', 'LM'],
  LW: ['LW', 'LM', 'CAM', 'ST', 'RW'],
  RW: ['RW', 'RM', 'CAM', 'ST', 'LW'],
  ST: ['ST', 'CAM', 'LW', 'RW']
}

// ---------------------------------------------------------------------------
// Formation slot definitions (slot index -> position)
// ---------------------------------------------------------------------------

// Slot index → position, by formation. Single source of truth for the
// shape of each formation's starting 11 — also drives squad generation
// and zone matchup wiring below.
export const FORMATION_SLOTS: Record<Formation, Position[]> = {
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW'],
  '4-4-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  '4-2-3-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'CDM', 'CDM', 'LW', 'CAM', 'RW', 'ST'],
  '5-3-2': ['GK', 'LB', 'CB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'ST', 'ST'],
  '5-4-1': ['GK', 'LB', 'CB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  '3-4-3': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'CM', 'RM', 'LW', 'ST', 'RW']
}

// Slot indices that are considered "midfielders" for the midfield-score calc.
export const MIDFIELD_SLOTS: Record<Formation, number[]> = {
  '4-3-3': [5, 6, 7],
  '4-4-2': [5, 6, 7, 8],
  '4-2-3-1': [5, 6, 8],
  '5-3-2': [6, 7, 8],
  '5-4-1': [6, 7, 8, 9],
  '3-5-2': [4, 5, 6, 7, 8],
  '3-4-3': [4, 5, 6, 7]
}

// ---------------------------------------------------------------------------
// Zone matchup mappings — attacker slot indices per (formation, zone)
// ---------------------------------------------------------------------------

type ZoneAttackerMap = Record<Formation, number[]>

export const ATTACKER_SLOTS: Record<Zone, ZoneAttackerMap> = {
  left_wing: {
    '4-3-3': [8, 1, 5],
    '4-4-2': [5, 1, 6],
    // Spec says 3rd attacker is CDM (slot 5). Deviating to CAM (slot 8) —
    // CDM stat profile (low pace/dribbling) drags the weighted wing-attack
    // score ~25 points below CM/CAM. CAMs drift wide in real 4-2-3-1
    // sides (Özil/Bruno-style), so this is plausible footballingly.
    '4-2-3-1': [7, 1, 8],
    // 5-3-2: striker drifts wide, LB overlaps as wing-back, CM supports.
    '5-3-2': [9, 1, 6],
    '5-4-1': [6, 1, 10],
    // 3-back: wide midfielder is the wing-back; ST drifts, central CM supports.
    '3-5-2': [4, 9, 5],
    '3-4-3': [8, 4, 5]
  },
  right_wing: {
    '4-3-3': [10, 4, 7],
    '4-4-2': [8, 4, 7],
    // Mirror of left_wing — CAM (slot 8) replaces the spec's CDM (slot 6).
    '4-2-3-1': [9, 4, 8],
    '5-3-2': [10, 5, 8],
    '5-4-1': [9, 5, 10],
    '3-5-2': [8, 10, 7],
    '3-4-3': [10, 7, 6]
  },
  centre: {
    '4-3-3': [9, 5, 6, 7], // ST + 3 CMs
    '4-4-2': [9, 10, 6, 7], // 2 STs + 2 CMs
    // 4 bodies — ST + CAM + both wingers (LW/RW tucking inside, Bruno-
    // Fernandes / Özil style). Previously this pulled a CDM (slot 6) which
    // dragged the centre attack score with defensive stats; replacing it
    // with the inverted wingers gives 4-2-3-1 the same 4-body density as
    // 4-3-3 / 4-4-2 in centre attacks, all on attacking-profile cards.
    '4-2-3-1': [10, 8, 7, 9], // ST + CAM + LW + RW
    '5-3-2': [9, 10, 7],
    '5-4-1': [10, 7, 8],
    '3-5-2': [9, 10, 6],
    '3-4-3': [9, 5, 6]
  },
  long_ball: {
    '4-3-3': [9, 6],
    '4-4-2': [9, 10],
    '4-2-3-1': [10, 8],
    '5-3-2': [9, 10],
    '5-4-1': [10, 7],
    '3-5-2': [9, 10],
    '3-4-3': [9, 5]
  },
  // Counter pulls more bodies than long_ball — fast wide players running
  // the channels alongside the strikers, capitalising on the defenders
  // being caught upfield.
  counter: {
    '4-3-3': [9, 8, 10], // ST + LW + RW
    '4-4-2': [9, 10, 5, 8], // both STs + LM + RM
    '4-2-3-1': [10, 7, 9], // ST + LW + RW
    '5-3-2': [9, 10, 1, 5], // STs + LB + RB (wing-backs running)
    '5-4-1': [10, 6, 9], // ST + LM + RM
    '3-5-2': [9, 10, 4, 8], // STs + LM + RM (wing-backs)
    '3-4-3': [9, 8, 10] // ST + LW + RW
  }
}

export const DEFENDER_SLOTS: Record<Zone, ZoneAttackerMap> = {
  left_wing: {
    '4-3-3': [4, 7],
    '4-4-2': [4, 8],
    // Spec pulls RW (slot 9) here — but LW/RW defending stats are low,
    // and 4-2-3-1's wingers stay high in our model (CAM does wide-attack
    // duty instead). Use the right-side CDM (slot 6) sliding wide as the
    // FB pushes up — the realistic 4-2-3-1 defensive shift.
    '4-2-3-1': [4, 6],
    // 5-back: opposite full-back + nearest CM tracks back.
    '5-3-2': [5, 8],
    '5-4-1': [5, 9],
    // 3-back: opposite wide-mid drops to wing-back duty.
    '3-5-2': [8, 7],
    '3-4-3': [7, 6]
  },
  right_wing: {
    '4-3-3': [1, 5],
    '4-4-2': [1, 5],
    // Mirror of left_wing — left-side CDM (slot 5) covers wide.
    '4-2-3-1': [1, 5],
    '5-3-2': [1, 6],
    '5-4-1': [1, 6],
    '3-5-2': [4, 5],
    '3-4-3': [4, 5]
  },
  centre: {
    '4-3-3': [2, 3, 6],
    '4-4-2': [2, 3, 6],
    '4-2-3-1': [2, 3, 5, 6],
    // 5-back pulls all 3 CBs + central CM. 3-back pulls all 3 CBs + central CM.
    '5-3-2': [2, 3, 4, 7],
    '5-4-1': [2, 3, 4, 7],
    '3-5-2': [1, 2, 3, 6],
    '3-4-3': [1, 2, 3, 6]
  },
  long_ball: {
    '4-3-3': [2, 3],
    '4-4-2': [2, 3],
    '4-2-3-1': [2, 3],
    '5-3-2': [2, 3, 4],
    '5-4-1': [2, 3, 4],
    '3-5-2': [1, 2, 3],
    '3-4-3': [1, 2, 3]
  },
  counter: {
    '4-3-3': [2, 3],
    '4-4-2': [2, 3],
    '4-2-3-1': [2, 3],
    '5-3-2': [2, 3, 4],
    '5-4-1': [2, 3, 4],
    '3-5-2': [1, 2, 3],
    '3-4-3': [1, 2, 3]
  }
}

// ---------------------------------------------------------------------------
// Zone selection weights
// ---------------------------------------------------------------------------

export const ZONE_BASE_WEIGHTS: Record<Zone, number> = {
  left_wing: 0.2,
  right_wing: 0.2,
  centre: 0.25,
  long_ball: 0.15,
  counter: 0.2
}

export const ZONE_MENTALITY_MODS: Record<Zone, { attacking: number; defensive: number }> = {
  left_wing: { attacking: 0.02, defensive: -0.03 },
  right_wing: { attacking: 0.02, defensive: -0.03 },
  centre: { attacking: 0.05, defensive: -0.05 },
  long_ball: { attacking: -0.02, defensive: 0.03 },
  // Counter: attacking mentalities don't sit deep enough to break (so the
  // attacker bonus is negative), and defensive defending teams are too
  // compact to be countered (so the defensive bonus is also negative). The
  // pickZone inversion lines turn "defender attacking" into a counter
  // boost — that's the prime fast-break scenario.
  counter: { attacking: -0.07, defensive: -0.08 }
}

export const FORMATION_ZONE_BIAS: Record<Formation, Partial<Record<Zone, number>>> = {
  '4-3-3': { left_wing: 0.05, right_wing: 0.05 },
  '4-4-2': {},
  // CAM was promoted out of centre and into wing attacks, so 4-2-3-1's
  // strongest zone is now the wings, not the centre. Bias accordingly.
  '4-2-3-1': { left_wing: 0.04, right_wing: 0.04 },
  // 5-back: defensive shape, lean on long balls and counters.
  '5-3-2': { long_ball: 0.04, counter: 0.03, centre: -0.02 },
  '5-4-1': { long_ball: 0.05, counter: 0.04, centre: -0.03 },
  // 3-5-2: midfield-heavy, dictates through the centre.
  '3-5-2': { centre: 0.06 },
  // 3-4-3: wide attacking shape.
  '3-4-3': { left_wing: 0.04, right_wing: 0.04 }
}

// ---------------------------------------------------------------------------
// Attack/defense stat weights per zone
// ---------------------------------------------------------------------------

export const ATTACK_WEIGHTS: Record<Zone, StatWeights> = {
  left_wing: { pace: 0.3, passing: 0.2, dribbling: 0.3, positioning: 0.2 },
  right_wing: { pace: 0.3, passing: 0.2, dribbling: 0.3, positioning: 0.2 },
  centre: { pace: 0.15, passing: 0.35, dribbling: 0.2, positioning: 0.3 },
  long_ball: {
    pace: 0.3,
    passing: 0.3,
    physicality: 0.2,
    positioning: 0.2
  },
  counter: { pace: 0.4, passing: 0.15, dribbling: 0.25, positioning: 0.2 }
}

export const DEFENSE_WEIGHTS: StatWeights = {
  defending: 0.4,
  positioning: 0.25,
  pace: 0.2,
  physicality: 0.15
}

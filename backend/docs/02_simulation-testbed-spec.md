# Football Card Game — Simulation Testbed Spec (v1)

## 1. Goal

A command-line simulation engine that takes two squads and two tactical setups, runs a full match, and outputs a structured JSON match log. No UI, no interactivity, no meta-game. The purpose is to validate that the core simulation produces realistic-feeling football matches that can be tuned by adjusting probability constants.

This is the foundation for the full game. Every architectural decision here is made to ensure future features (pause system, AI manager, weather, chemistry, commentary, UI) slot in without a rewrite.

---

## 2. Card Data Model

### 2.1 Stats

Each card has 8 stats, each rated 1–99:

| Stat | Role |
|------|------|
| Pace | Sprint speed, chasing balls, counter-attacks |
| Shooting | Shot accuracy, finishing |
| Passing | Pass accuracy, crossing, through balls |
| Dribbling | Ball retention, beating a man |
| Defending | Tackling, interceptions, marking |
| Physicality | Strength, aerial duels, injury resistance |
| Positioning | Off-the-ball movement, spatial awareness |
| Stamina | Energy pool, determines fatigue curve |

### 2.2 Metadata

```typescript
interface Card {
  id: string;
  name: string;
  position: Position; // GK | CB | LB | RB | CDM | CM | CAM | LW | RW | ST
  country: string;
  age: number;
  stats: {
    pace: number;
    shooting: number;
    passing: number;
    dribbling: number;
    defending: number;
    physicality: number;
    positioning: number;
    stamina: number;
  };
  injuryProneness: number; // 0.0–1.0, hidden trait
}
```

### 2.3 Effective Stats (future-proofing)

**All stat reads in the engine must go through a single function:**

```typescript
function getEffectiveStats(card: Card, context: PhaseContext): EffectiveStats
```

For v1, this function simply returns the base stats multiplied by the fatigue modifier. Later, this is where you add chemistry bonuses, form modifiers, position-fit boosts, weather penalties, and yellow-card safe-mode reductions — all in one place, no engine changes needed.

---

## 3. Match Setup

### 3.1 Input

```typescript
interface MatchInput {
  homeSquad: Squad;       // 15 cards
  awaySquad: Squad;       // 15 cards
  homeTactics: Tactics;
  awayTactics: Tactics;
  seed?: number;          // Optional RNG seed for reproducibility
}

interface Squad {
  cards: Card[];          // 15 cards
  lineup: LineupSlot[];   // 11 starters assigned to formation slots
  subs: Card[];           // 4 bench players
}

interface Tactics {
  formation: Formation;
  mentality: 'defensive' | 'balanced' | 'attacking';
}
```

### 3.2 Formations (v1 — limited set)

Start with 3 formations to keep it simple. The data model supports any formation, so adding more later is just data, not code.

- **4-3-3**: [GK, LB, CB, CB, RB, CM, CM, CM, LW, RW, ST]
- **4-4-2**: [GK, LB, CB, CB, RB, LM, CM, CM, RM, ST, ST]
- **4-2-3-1**: [GK, LB, CB, CB, RB, CDM, CDM, LW, CAM, RW, ST]

Each formation defines which **zones** are strong/weak (used in zone selection weighting).

### 3.3 Pre-Match Rolls

Before the match loop begins:

```typescript
interface MatchConfig {
  refereeStrictness: number;  // Roll: 0.7 (lenient) | 1.0 (normal) | 1.4 (strict)
  // FUTURE: weather, homeAdvantage — add fields here, engine ignores them until implemented
}
```

---

## 4. Match State

A single object that represents everything about the match at any point in time. This is the core data structure — the match loop reads it, mutates it, and the pause system (later) will serialize/deserialize it.

```typescript
interface MatchState {
  minute: number;
  phase: number;
  score: { home: number; away: number };
  momentum: number;                        // -20 to +20, positive = home
  ballZone: 'defense' | 'midfield' | 'attack';

  players: {
    home: PlayerMatchState[];
    away: PlayerMatchState[];
  };

  events: MatchEvent[];                    // Append-only log
  config: MatchConfig;

  // FUTURE fields (add when needed, engine ignores until implemented):
  // pauseRequested: boolean;
  // pendingDecisions: PauseDecision[];
}

interface PlayerMatchState {
  cardId: string;
  currentStamina: number;      // 0–100 percentage
  isOnPitch: boolean;
  isInjured: boolean;
  yellowCards: number;          // 0, 1, or 2 (2 = sent off)
  redCard: boolean;
  mode: 'normal' | 'aggressive' | 'safe';  // v1: always 'normal'
  matchRating: number;          // Running total, starts at 6.0
  minutesPlayed: number;
}
```

---

## 5. Match Loop Architecture

### 5.1 Structure — State Machine (critical for future-proofing)

**Do not build this as a simple for-loop.** The match loop must be structured so that it can be paused and resumed. In v1 you run it straight through, but the architecture must support yielding control.

```typescript
// The engine processes ONE phase at a time and returns updated state
function processPhase(state: MatchState): MatchState {
  // 1. Determine possession
  // 2. Select zone
  // 3. Resolve phase (nothing / buildup / chance / foul)
  // 4. Process outcomes (goal resolution, cards, injuries)
  // 5. Update stamina, momentum, ratings
  // 6. Append events
  // 7. Advance minute
  return updatedState;
}

// The match runner calls processPhase in a loop
// FUTURE: this is where pause logic goes — check for pause triggers
//         between calls and yield to the player/AI
function runMatch(input: MatchInput): MatchResult {
  let state = initializeMatchState(input);

  while (state.minute <= 90) {
    state = processPhase(state);

    // FUTURE: check pause triggers here
    // if (shouldPause(state)) { yield state; state = applyDecisions(state, decisions); }
  }

  return buildMatchResult(state);
}
```

This means **processPhase must be a pure-ish function** — it takes state in, returns state out. No global variables, no closures over mutable data. The only side effect is the RNG, which should be a seeded PRNG passed through state or context.

### 5.2 Phase Count

A match consists of roughly **25 phases** covering 90 minutes. Each phase advances the clock by **3–4 minutes** (with slight randomness). Stoppage time adds 1–3 extra phases.

### 5.3 Seeded RNG

All randomness must go through a single seeded random number generator:

```typescript
// Use a simple seedable PRNG (e.g., mulberry32 or xoshiro128)
interface RNG {
  next(): number;  // Returns 0–1
}
```

This ensures:
- Reproducible matches for debugging (same seed = same result)
- Replay capability later (store the seed, regenerate the match)
- Testability (seed known edge cases)

---

## 6. Phase Resolution

### 6.1 Step 1 — Possession

Who gets the attacking phase:

```
midfieldScore(team) = average of (passing + positioning + dribbling) for all midfielders on pitch

midfieldDelta = homeScore - awayScore

homePhaseChance = 0.5
  + (midfieldDelta * 0.003)         // Midfield quality
  + (state.momentum * 0.005)        // Momentum
  + mentalityModifier               // Attacking: +0.03, Defensive: -0.03, Balanced: 0

roll < homePhaseChance → home attacks, else away attacks
```

### 6.2 Step 2 — Zone Selection

The attack flows through one of 5 zones. Selection is **weighted random** based on formation and mentality:

| Zone | Base Weight | Attacking Mod | Defensive Mod | Description |
|------|------------|---------------|---------------|-------------|
| Left wing | 0.20 | +0.02 | -0.03 | LW/LB vs RB |
| Right wing | 0.20 | +0.02 | -0.03 | RW/RB vs LB |
| Centre | 0.25 | +0.05 | -0.05 | CAM/CM/ST vs CB/CDM |
| Long ball | 0.15 | -0.02 | +0.03 | CM/CDM direct to ST vs CBs |
| Counter-attack | 0.20 | -0.07 | +0.08 | ST + pace vs CBs (defenders penalised if opponent was attacking) |

Formation adjustments: 4-3-3 gets +0.05 to wing zones, 4-2-3-1 gets +0.05 to centre.

### 6.3 Step 3 — Stat Matchup

Each zone defines which attackers and defenders are involved:

```typescript
interface ZoneMatchup {
  attackers: CardId[];     // Pulled from lineup based on zone
  defenders: CardId[];     // Pulled from opponent lineup based on zone
  attackWeights: StatWeights;
  defenseWeights: StatWeights;
}
```

**Attack stat weights by zone:**

| Zone | Pace | Shooting | Passing | Dribbling | Positioning |
|------|------|----------|---------|-----------|-------------|
| Left/Right wing | 0.30 | 0.00 | 0.20 | 0.30 | 0.20 |
| Centre | 0.15 | 0.00 | 0.35 | 0.20 | 0.30 |
| Long ball | 0.30 | 0.00 | 0.30 | 0.00 | 0.20 |
| Counter | 0.40 | 0.00 | 0.15 | 0.25 | 0.20 |

Physicality is added at weight 0.20 for long ball (aerial duel component).

**Defense stat weights** (all zones):
- Defending: 0.40, Positioning: 0.25, Pace: 0.20, Physicality: 0.15

Calculate:
```
attackScore = sum(attackerEffectiveStats[stat] * attackWeight[stat]) averaged across involved attackers
defenseScore = sum(defenderEffectiveStats[stat] * defenseWeight[stat]) averaged across involved defenders
```

### 6.4 Step 4 — Phase Outcome

Use a sigmoid on the delta to determine what happens:

```
delta = attackScore - defenseScore
chanceProbability = sigmoid(delta / SCALE_FACTOR)  // SCALE_FACTOR ≈ 18 (tunable)
```

This gives a base chance probability. Then determine the outcome:

```
roll = rng.next()

if (roll < chanceProbability * 0.4)       → CHANCE CREATED
else if (roll < chanceProbability * 0.8)  → BUILDUP (attack advanced but no clear chance)
else                                      → NOTHING (possession recycled)
```

**Individual brilliance check**: Before standard resolution, if any single attacker's dribbling exceeds every paired defender's defending by 15+, there's a **bonus 5% chance** of a chance created regardless of the main roll.

**Foul check**: Run independently each phase (see Section 8).

### 6.5 Sigmoid Function

```typescript
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
```

With SCALE_FACTOR = 18:
- Equal stats (delta 0) → sigmoid(0) = 0.50 → ~20% chance of a chance
- +10 delta → sigmoid(0.56) ≈ 0.63 → ~25% chance
- +20 delta → sigmoid(1.11) ≈ 0.75 → ~30% chance
- -15 delta → sigmoid(-0.83) ≈ 0.30 → ~12% chance

**Target distributions per match (25 phases):**
- Chances created: 4–8 total across both teams
- Goals: 1–3 total (from ~30–35% chance conversion rate)
- Buildup phases: 6–10
- Nothing phases: 10–15

---

## 7. Three-Stage Goal Resolution

Triggered when a chance is created.

### 7.1 Stage 1 — Chance Quality

```
clearCutProbability = 0.30 + (attackDelta * 0.008) + (momentum * 0.003)
// Clamped to 0.15–0.65

roll < clearCutProbability → CLEAR CUT
else                       → HALF CHANCE
```

### 7.2 Stage 2 — Shot Accuracy

Identify the shooter (highest shooting stat among involved attackers):

```
baseAccuracy = (shooter.shooting * 0.7 + shooter.positioning * 0.3) / 100
fatigueModifier = getFatigueMultiplier(shooter.currentStamina)

onTargetProbability = baseAccuracy * fatigueModifier * chanceTypeModifier
  // chanceTypeModifier: clear cut = 0.90, half chance = 0.60

// FUTURE: weather modifier applied here
```

### 7.3 Stage 3 — Goalkeeper Save

If the shot is on target, resolve against the GK:

```
gkScore = (gk.shooting * 0 + gk.defending * 0.3 + gk.positioning * 0.4 + gk.physicality * 0.3) / 100
// Note: GK uses defending/positioning/physicality since there's no dedicated GK stat
// The "shooting" stat is irrelevant for GKs

saveProbability = gkScore * chanceTypeModifier * fatigueModifier
  // chanceTypeModifier: clear cut = 0.70, half chance = 1.10

goalProbability = 1 - saveProbability
roll < goalProbability → GOAL
else                   → SAVE
```

**Design note on GK stats**: Since the 8-stat model doesn't include a dedicated goalkeeping stat, GK cards should have high defending, positioning, and physicality values. This naturally differentiates them — a GK with 85 positioning and 80 physicality will save more than one with 60s. Future versions could add a 9th "goalkeeping" stat, but this works for v1.

---

## 8. Fouls, Cards & Injuries

### 8.1 Foul Generation

Checked once per phase, independent of the main phase outcome:

```
foulChance = BASE_FOUL_RATE                              // 0.12 per phase
  + max(0, (attackerDribbling - defenderDefending)) * 0.002  // Skill mismatch
  + (defenderPhysicality < attackerPhysicality ? 0.015 : 0)  // Physical mismatch
  + mentalityFoulModifier                                     // Pressing/attacking: +0.025
  + (1 - defenderStamina / 100) * 0.025                      // Tired players foul more
```

Target: roughly 20–25 fouls per match across both teams.

If a foul occurs, determine the **zone** it happened in (same as the current phase zone) — this affects whether it's a set piece opportunity.

### 8.2 Card Probability

When a foul occurs:

```
yellowChance = 0.20 * refereeStrictness
  * (isTacticalFoul ? 1.4 : 1.0)       // Cynical foul
  * (isInAttackingZone ? 1.3 : 1.0)    // Dangerous area

// isTacticalFoul: true if the attacking phase would have been a CHANCE or BUILDUP
// isInAttackingZone: true if zone is centre or counter

redChance = 0.015 * refereeStrictness
```

If the player already has a yellow, any new yellow = second yellow → red card → player off.
If a red card is shown, the team plays with 10 men for the rest of the match.

**Playing with fewer players**: When a team has a player sent off, their midfield and attack scores are reduced by removing the sent-off player from matchup pools. This naturally weakens them without needing special-case logic.

### 8.3 Set Pieces from Fouls

If a foul occurs in a dangerous zone:

| Foul Zone | Set Piece |
|-----------|-----------|
| Centre (attacking third) | Free kick — resolve as a shooting chance: best shooter's shooting stat vs GK, base conversion ~12% |
| Left/Right wing (attacking third) | Crossing free kick — resolve as a corner (see below) |
| Inside the box | Penalty — very rare (foulChance * 0.08 chance the foul is in the box). Conversion: shooter.shooting / 100 * 0.85, clamped to 0.65–0.90 |

### 8.4 Corners

Generated when a phase results in a BUILDUP or SAVE (the ball goes out):
- Corner probability after a save: 0.50
- Corner probability after a buildup: 0.20

Resolution:
```
deliveryQuality = bestPasser.passing / 100
attackAerial = max(attackers.physicality + attackers.positioning) / 200  // Best header
defenseAerial = max(defenders.physicality + defenders.defending) / 200

cornerChance = deliveryQuality * 0.4 * (attackAerial - defenseAerial + 0.5)
// If corner creates a chance → run Stage 2 (shot) and Stage 3 (save)
// ~8-12% of corners should produce a goal
```

### 8.5 Injury Generation

Checked per phase (base) and on foul events (elevated):

```
// Per-phase passive check
injuryChance = 0.002                                    // Base rate
  + card.injuryProneness * 0.04                         // Hidden trait
  + max(0, (1 - currentStamina / 100)) * 0.03           // Fatigue
  + max(0, (1 - card.stats.physicality / 100)) * 0.015  // Frailty

// On foul events (replaces base rate)
injuryChance = 0.035                                    // Elevated base
  + card.injuryProneness * 0.05
  + max(0, (1 - currentStamina / 100)) * 0.04
  + max(0, (1 - card.stats.physicality / 100)) * 0.02

// FUTURE: wet pitch adds +0.008
```

If triggered: the player is marked as injured, removed from the pitch. In v1, no sub is made automatically — the team plays with fewer players (same as a red card mechanically). The event is logged so the future pause system can offer a sub.

**FUTURE-PROOFING NOTE**: Log injury events with a `requiresDecision: true` flag. The current runner ignores this. The future pause system will check for it and halt.

Target: roughly 1 injury every 5–8 matches.

---

## 9. Fatigue System

### 9.1 Stamina Drain (v1 — simplified)

Every player starts at 100% stamina. Each phase:

```
drainPerPhase = BASE_DRAIN                    // 2.5%
  + (wasInvolvedInPhase ? ACTION_DRAIN : 0)   // +1.5%
  + mentalityDrain                            // Attacking: +0.8%, Defensive: -0.4%, Balanced: 0

currentStamina = max(0, currentStamina - drainPerPhase)
```

A player's **stamina stat** modifies the drain: `actualDrain = drainPerPhase * (100 / card.stats.stamina)`. A player with 90 stamina drains at 1.11x the base rate. A player with 60 stamina drains at 1.67x. This means high-stamina players last longer.

### 9.2 Fatigue Multiplier

Applied via `getEffectiveStats()`:

| Stamina Remaining | Multiplier |
|-------------------|------------|
| 80–100% | 1.00 |
| 60–79% | 0.95 |
| 40–59% | 0.85 |
| 20–39% | 0.70 |
| 0–19% | 0.55 |

### 9.3 Half-Time Recovery

At phase ~13 (minute 45), all players recover **+10% stamina**.

---

## 10. Momentum

A single number tracking match flow:

```
Initial value: 0 (FUTURE: home advantage sets this to +5)
Range: -20 to +20
Positive = home team momentum

Adjustments per event:
  Goal scored:      +7 for scoring team (or -7 from opponent's perspective)
  Goal conceded:    -4
  Chance created:   +3
  Chance conceded:  -1
  Good defense:     +1 (NOTHING outcome when defending)

  Time decay: each phase, momentum moves 5% toward 0
```

Momentum feeds into:
- Possession probability (+0.005 per point)
- Chance quality in goal resolution (+0.003 per point)

---

## 11. Match Rating

Each player starts at **6.0**. Updated after each phase based on involvement:

| Event | Change |
|-------|--------|
| Goal scored | +1.5 |
| Assist (created the chance that led to a goal) | +1.0 |
| Chance created (key pass) | +0.5 |
| Successful attack involvement (BUILDUP) | +0.2 |
| Won the defensive phase (defender in NOTHING outcome) | +0.2 |
| Foul committed | -0.3 |
| Yellow card | -0.5 |
| Red card | -1.5 |
| Goal conceded (defenders + GK) | -0.4 |
| Clean sheet (full time, defenders + GK) | +0.8 |

Clamped to **1.0–10.0**.

In v1, ratings are calculated but only output in the final match result. FUTURE: fed into the form system post-match.

---

## 12. Match Output

The engine outputs a single JSON object:

```typescript
interface MatchResult {
  seed: number;
  score: { home: number; away: number };
  phases: PhaseResult[];
  playerSummaries: PlayerSummary[];
}

interface PhaseResult {
  phase: number;
  minute: number;
  attackingTeam: 'home' | 'away';
  zone: Zone;
  outcome: 'nothing' | 'buildup' | 'chance' | 'foul';

  // Present if outcome is 'chance'
  chanceDetail?: {
    quality: 'half_chance' | 'clear_cut';
    shooter: string;       // Card ID
    onTarget: boolean;
    saved: boolean;
    goal: boolean;
  };

  // Present if outcome is 'foul'
  foulDetail?: {
    fouler: string;        // Card ID
    victim: string;
    card?: 'yellow' | 'red' | 'second_yellow';
    injury: boolean;
    setPiece?: 'free_kick' | 'penalty' | 'corner';
    setPieceResult?: { goal: boolean };
  };

  // Snapshot after this phase
  momentum: number;
  // FUTURE: full stamina snapshot per player (expensive, add when needed for UI)
}

interface PlayerSummary {
  cardId: string;
  team: 'home' | 'away';
  minutesPlayed: number;
  finalStamina: number;
  matchRating: number;
  goals: number;
  assists: number;
  foulsCommitted: number;
  yellowCards: number;
  redCard: boolean;
  injured: boolean;
}
```

---

## 13. Tunable Constants

All magic numbers are defined in a single constants file for easy tweaking:

```typescript
const SIM_CONSTANTS = {
  // Phase resolution
  SCALE_FACTOR: 18,
  CHANCE_THRESHOLD: 0.4,
  BUILDUP_THRESHOLD: 0.8,
  INDIVIDUAL_BRILLIANCE_GAP: 15,
  INDIVIDUAL_BRILLIANCE_CHANCE: 0.05,

  // Goal resolution
  CLEAR_CUT_BASE: 0.30,
  CLEAR_CUT_MODIFIER_CLEAR: 0.90,
  CLEAR_CUT_MODIFIER_HALF: 0.60,
  GK_MODIFIER_CLEAR: 0.70,
  GK_MODIFIER_HALF: 1.10,

  // Fouls
  BASE_FOUL_RATE: 0.12,
  YELLOW_BASE_CHANCE: 0.20,
  RED_BASE_CHANCE: 0.015,

  // Injuries
  INJURY_BASE_RATE: 0.002,
  INJURY_FOUL_RATE: 0.035,

  // Stamina
  BASE_STAMINA_DRAIN: 2.5,
  ACTION_STAMINA_DRAIN: 1.5,
  HALFTIME_RECOVERY: 10,

  // Momentum
  MOMENTUM_GOAL: 7,
  MOMENTUM_CONCEDE: -4,
  MOMENTUM_CHANCE: 3,
  MOMENTUM_DECAY: 0.05,

  // Possession
  MIDFIELD_WEIGHT: 0.003,
  MOMENTUM_WEIGHT: 0.005,
  MENTALITY_MODIFIER: 0.03,

  // Corners
  CORNER_AFTER_SAVE: 0.50,
  CORNER_AFTER_BUILDUP: 0.20,
};
```

---

## 14. Testing & Validation Strategy

### 14.1 Single Match Inspection

Run a single match with a known seed, read through the phase log. Does it read like a plausible match? Are there passages of midfield play? Do chances feel earned by stat advantages? Do scorelines look realistic?

### 14.2 Batch Simulation

Run 1,000+ matches and check distributions:

| Metric | Realistic Target |
|--------|-----------------|
| Average goals per match | 2.5–2.8 |
| Clean sheets | 20–25% of matches |
| Higher-rated team wins | 55–65% |
| Draws | 20–28% |
| Fouls per match | 20–26 |
| Yellow cards per match | 3–5 |
| Red cards | ~1 per 8–12 matches |
| Injuries | ~1 per 5–8 matches |
| Penalties | ~1 per 10–15 matches |
| Corners per match | 8–12 |

### 14.3 Edge Cases to Test

- Team with all 99-rated players vs all 30-rated: the 99s should dominate but not win every single match (target: 90–95% win rate)
- 10-man team (red card minute 5): should lose most matches but not be mathematically eliminated
- All players at 0% stamina: massive stat penalties, lots of fouls and injuries

---

## 15. Future Features — Integration Points

Each future feature and where it plugs in:

| Feature | Integration Point | Effort |
|---------|-------------------|--------|
| Weather modifiers | `getEffectiveStats()` + zone weights + `SIM_CONSTANTS` | Small |
| Chemistry/country bonuses | `getEffectiveStats()` | Small |
| Form system | `getEffectiveStats()` + post-match update | Small |
| Position-fit bonus | `getEffectiveStats()` | Small |
| Pause system | `runMatch()` loop — check triggers between `processPhase()` calls | Medium |
| Yellow card safe/aggressive mode | `PlayerMatchState.mode` → `getEffectiveStats()` + foul probability | Small |
| AI manager | `decideActions(state)` callback in `runMatch()` | Medium |
| Commentary generation | Consumer of `MatchEvent[]` — separate module | Medium |
| XP & progression | Post-match processing, no engine changes | Small |
| Home advantage | `MatchState.momentum` initial value + stamina drain modifier | Small |
| Top-down pitch UI | Consumer of `PhaseResult[]` — rendering only | Large |
| Pack shop / meta-game | Completely separate system, no engine changes | Large |
| PvP multiplayer | Replace `runMatch()` caller with WebSocket handler that pauses for both players | Medium |

---

## 16. File Structure

```
src/
  engine/
    types.ts              // All interfaces and type definitions
    constants.ts          // SIM_CONSTANTS — all tunable values
    rng.ts                // Seeded PRNG implementation
    stats.ts              // getEffectiveStats(), fatigue multiplier
    possession.ts         // Midfield dominance, phase allocation
    zones.ts              // Zone selection, matchup pairing
    phase.ts              // processPhase() — the core resolver
    goals.ts              // Three-stage goal resolution
    fouls.ts              // Foul, card, and injury generation
    setPieces.ts           // Free kicks, corners, penalties
    momentum.ts           // Momentum tracking and decay
    ratings.ts            // Match rating updates
    stamina.ts            // Drain calculations
    match.ts              // runMatch() — the main loop

  data/
    sample-cards.ts       // Test squad of 30 cards (two teams)

  test/
    run-single.ts         // Run one match, print full log
    run-batch.ts          // Run N matches, print distribution stats
```

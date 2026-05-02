# Football Card Game — Systems Overview

A tour of every system in the simulation engine as it actually exists today. This complements:

- `01_project-brief.md` — the _what_ and _why_
- `02_simulation-testbed-spec.md` — the v1 spec
- _this doc_ — _how it actually works_, including spec deviations and additions made during development

Read order suggestion: skim Part 1 to understand the in-match runtime, then dip into Part 2 when you need to generate cards/squads. Cross-references use `file:line` format so you can jump straight to source.

---

# Part 1 — Match Engine Runtime

The match engine takes two squads + tactics + an optional seed and produces a `MatchResult`. The runtime is structured as a state machine — `processBeat(state, rng) → state` is the atomic unit, called ~45 times per match.

## 1.1 Seeded RNG (`lib/rng.ts`)

**Purpose**: Single source of randomness for the entire engine. Same seed = same match, every time.

**Implementation**: Mulberry32 — fast 32-bit PRNG, ~50 lines.

**API**: `createRng(seed: number): RNG` returns `{ next, int, pick, weightedPick, chance, seed }`. Every other system in the engine takes an `RNG` instance and uses these helpers — no direct calls to `Math.random()` anywhere in the engine.

**Why this matters**: Reproducible matches let you debug edge cases ("what happened in beat 22 of match 12345?"), enable replay capability, and let test runners (`run-batch`, `run-season`, `run-formation-season`) compare results across changes.

**Constraint**: Anything that needs randomness inside a match _must_ take the RNG as a parameter. Helpers that roll dice (e.g. `rollPassiveInjury`, `rollFoulInjury`, `pickWeightedDefender`) all do this.

---

## 1.2 Match Runner (`engine/match.ts`)

**Purpose**: Public entry points — `runMatch(input)` (synchronous, full match) and `runMatchLive(input, onBeat)` (async, yields between beats).

**Lifecycle**:

1. Seed an RNG from `input.seed` (or random if omitted).
2. `initializeMatchState(input, rng)` — builds the live `MatchState`:
   - Rolls referee strictness (lenient/normal/strict, ~33% each).
   - Initialises `PlayerMatchState` for every card (stamina 100, on-pitch flag, rating 6.0, etc.).
   - **Critically: shallow-clones each squad's `lineup` array and the input `tactics`** so mid-match mutations (auto-subs, tactical adaptation) don't leak into the caller's input. Cards/subs arrays stay shared (immutable).
3. Loop: `state = processBeat(state, rng); adaptTactics(state)` while `minute < 90 && beat < 50`.
4. Stoppage: 1–4 extra beats (rolled once via `rollStoppage`).
5. `finalizeMatch(state)` — applies clean-sheet bonuses to defenders+GK, builds `MatchResult` with per-player summaries, totals, and team aggregates.

**Live mode**: `runMatchLive` is identical except it `await`s an `onBeat(event, state)` callback after every beat. The callback is the integration point for pacing (CLI live mode), SSE streaming (the planned Next.js frontend), or eventually the pause system.

**Constants**: `STOPPAGE_MIN_BEATS: 1`, `STOPPAGE_MAX_BEATS: 4`, `RATING_CLEAN_SHEET: 0.8`.

**Future hook**: The line `// FUTURE: pause-trigger hook would go here.` between `processBeat` and `adaptTactics` is where the pause system's `shouldPause(state)` check goes. Yielding state and resuming on `applyDecisions` is the planned shape.

---

## 1.3 Beat Processor (`engine/beat.ts`)

**Purpose**: The single state-mutating step. Takes `state` + `rng`, returns mutated `state` with one new `BeatResult` appended.

**The 8-step beat**: `processBeat` reads top-to-bottom as numbered steps. Each step's output feeds the next:

1. **Advance clock** — fixed 2 minutes per beat.
2. **Possession** — `pickAttackingSide(state, rng.next())` decides home or away (see §1.4).
3. **Zone** — `pickZone(atkTactics, defTactics, rng)` (see §1.5), then `buildMatchup(state, side, zone)` and `scoreMatchup(matchup)` (see §1.6).
4. **Outcome** — sigmoid the delta; bucket into `chance / buildup / nothing` (see §1.7). Plus an "individual brilliance" bonus chance.
5. **Chance resolution** — if `chance`, run 3-stage goal resolution (see §1.8). Increment score on goal.
6. **Corners** — only if no goal yet. After save: 50% corner. After buildup: 20% corner. Resolves via set-piece system (see §1.10).
7. **Foul + card + injury** — independent roll per beat (see §1.9). Set piece if foul is in a dangerous zone.
8. **Passive injury check** — one random on-pitch player, low rate.
9. **Ratings, momentum, stamina, attribution, half-time recovery** — bookkeeping.

**Output**: One `BeatResult` is appended to `state.events`, capturing zone, outcome, chanceDetail, foulDetail, cornerTaken, momentum.

**Pure-ish guarantee**: No globals. No closures over mutable data. The only shared state is the `RNG` and the `MatchState` parameter. This is what makes the future pause system tractable.

---

## 1.4 Possession Selection (`engine/mechanics/possession.ts`)

**Purpose**: Decide which team attacks this beat.

**Formula** (per the spec):

```
midfieldDelta = avg(home midfielders' passing+positioning+dribbling) - avg(away midfielders')

homePhaseChance = 0.5
  + midfieldDelta * MIDFIELD_WEIGHT      (0.003)
  + state.momentum * MOMENTUM_WEIGHT     (0.005)
  + mentalityModifier                    (±MENTALITY_MODIFIER for attacking/defensive)
```

`MIDFIELD_SLOTS[formation]` defines which slots count as midfielders for the score (e.g. 4-3-3 = `[5, 6, 7]`, 3-5-2 = `[4, 5, 6, 7, 8]`).

**Constants**: `MIDFIELD_WEIGHT: 0.003`, `MOMENTUM_WEIGHT: 0.005`, `MENTALITY_MODIFIER: 0.03`.

**Limitation**: Possession is binary per beat — there's no "midfield contested, no clear attacker" outcome. Deliberate v1 simplification per the spec.

---

## 1.5 Zone Selection (`engine/zones.ts:pickZone`)

**Purpose**: Once we know who's attacking, pick which of the 5 zones the attack flows through.

**The 5 zones**:

- `left_wing`, `right_wing` — flank attacks via the wide players
- `centre` — through the middle
- `long_ball` — direct ball over the top
- `counter` — fast break against caught-out defenders

**Weighting** combines three layers:

1. **Base weights** (`ZONE_BASE_WEIGHTS`): `left_wing 0.20, right_wing 0.20, centre 0.25, long_ball 0.15, counter 0.20`.
2. **Mentality mods** (`ZONE_MENTALITY_MODS`): each zone has `{attacking, defensive}` modifiers applied based on attacker / defender mentality. The `pickZone` code applies them directly when matched, and inverts (×−0.5) when the opposite mentality is in play.
3. **Formation bias** (`FORMATION_ZONE_BIAS`): each formation has a partial map, e.g. `4-3-3 → { left_wing: 0.05, right_wing: 0.05 }` (4-3-3 prefers wings), `3-5-2 → { centre: 0.06 }`, etc.

**Counter zone subtlety**: counter weight increases when the _defender_ is in attacking mentality (caught upfield) — that's the prime fast-break scenario. Both `attacking` and `defensive` mods on counter are negative, and the inversion line in `pickZone` turns "defender attacking" into a positive boost. (See `constants.ts` comments.)

---

## 1.6 Zone Matchup & Scoring (`engine/zones.ts`)

**Purpose**: Once a zone is picked, identify _which players_ from each side join the duel, then compute attack and defense scores.

**Slot lookup**:

- `ATTACKER_SLOTS[zone][formation]` → list of slot indices for the attacking team. e.g. `ATTACKER_SLOTS.left_wing["4-3-3"] = [8, 1, 5]` = LW + LB + CM.
- `DEFENDER_SLOTS[zone][formation]` → mirror for the defending team. e.g. `DEFENDER_SLOTS.left_wing["4-3-3"] = [4, 7]` = RB + CM.

`pullCards(squad, playerStates, slotIndices)` resolves slot → card via `squad.lineup` (which is mutated by auto-subs), filters out injured/red-carded players (`!ps.isOnPitch`), and returns the live cards + states.

**Scoring** (`scoreMatchup`):

1. Read `effective(card, ps)` for each attacker and defender — applies fatigue multiplier via `getEffectiveStats` (see §1.13).
2. Apply the **counter penalty**: if the zone is `counter` AND the defender's mentality is `attacking`, drop each defender's positioning by `COUNTER_DEFENDER_POSITIONING_PENALTY` (8). Softened from 15 — at the original value the counter penalty alone made attacking mentality net-negative even with offensive payoffs.
3. Compute weighted score per player: `weightedScore(stats, weights)` using `ATTACK_WEIGHTS[zone]` for attackers, `DEFENSE_WEIGHTS` (universal) for defenders.
4. Average across each side. The **delta** = `attackScore - defenseScore` is what feeds the sigmoid.

**Stat weights** (`ATTACK_WEIGHTS`):

| Zone            | Pace | Passing | Dribbling | Positioning | Physicality |
| --------------- | ---- | ------- | --------- | ----------- | ----------- |
| left/right wing | 0.30 | 0.20    | 0.30      | 0.20        | —           |
| centre          | 0.15 | 0.35    | 0.20      | 0.30        | —           |
| long_ball       | 0.30 | 0.30    | —         | 0.20        | 0.20        |
| counter         | 0.40 | 0.15    | 0.25      | 0.20        | —           |

**Defense**: `{ defending: 0.40, positioning: 0.25, pace: 0.20, physicality: 0.15 }` for all zones.

**Counter zone gets more bodies**: We deliberately deviate from spec — counter pulls 3-4 players (ST + wide pace) vs long_ball's 2. This makes the two zones mechanically distinct (see `constants.ts:ATTACKER_SLOTS.counter`).

---

## 1.7 Beat Outcome (`engine/beat.ts`)

**Purpose**: Map the attack-defense delta to one of `chance / buildup / nothing`.

**Math**:

```
chanceProb = sigmoid(delta / SCALE_FACTOR)        // SCALE_FACTOR = 18
threshold  = CHANCE_THRESHOLD                     // 0.23 baseline
            + (atk mentality === "attacking" ? ATTACKING_CHANCE_THRESHOLD_BONUS : 0)  // +0.08
roll = rng.next()
roll < chanceProb * threshold
  → chance
else roll < chanceProb * BUILDUP_THRESHOLD        // 0.46
  → buildup
else
  → nothing
```

**Individual brilliance** (`individualBrillianceTriggers`): If any one attacker's dribbling exceeds _every_ paired defender's defending by `INDIVIDUAL_BRILLIANCE_GAP` (15), there's a `INDIVIDUAL_BRILLIANCE_CHANCE` (~3%) bonus chance to upgrade `nothing/buildup` → `chance`.

**Constants**: `SCALE_FACTOR: 18`, `CHANCE_THRESHOLD: 0.23`, `BUILDUP_THRESHOLD: 0.46`, `ATTACKING_CHANCE_THRESHOLD_BONUS: 0.08`. The attacking bonus is the offensive payoff that justifies attacking-mentality teams trading off defensive vulnerability (counter penalty + foul rate). Without it, attacking is the worst mentality net of all costs.

**Target distributions** (across the league): chances 4-8/match, goals 1-3/match, buildup 6-10, nothing 10-15. `run-batch` validates these.

---

## 1.8 Goal Resolution (`engine/resolution/goals.ts`)

**Purpose**: When a chance is created, resolve it through three sequential stages. Triggered from `processBeat:104`.

**Stage 1 — Chance Quality**:

```
clearCutProb = CLEAR_CUT_BASE
  + (atk mentality === "attacking" ? ATTACKING_CLEAR_CUT_BONUS : 0)
  + delta * CLEAR_CUT_DELTA_WEIGHT
  + momentum * CLEAR_CUT_MOMENTUM_WEIGHT
  clamp [CLEAR_CUT_MIN, CLEAR_CUT_MAX] = [0.15, 0.65]

roll < clearCutProb → CLEAR_CUT, else HALF_CHANCE
```

`ATTACKING_CLEAR_CUT_BONUS: 0.10` adds to clear-cut probability when the attacking-mentality team is in possession this beat. Pairs with the chance-threshold bonus from §1.7 — together they give attacking teams a ~30% relative bump in clear-cut chances created.

**Stage 2 — Shot Accuracy**: Identify the shooter (highest shooting stat among involved attackers). Then:

```
baseAccuracy = (shooter.shooting * 0.7 + shooter.positioning * 0.3) / 100
fatigueModifier = getFatigueMultiplier(shooter.currentStamina)

onTargetProb = baseAccuracy * fatigueModifier * chanceTypeModifier
  // CLEAR_CUT_MODIFIER_CLEAR = 0.90, CLEAR_CUT_MODIFIER_HALF = 0.60
```

**Stage 3 — GK Save**: Only runs if shot is on target. The GK is whoever is currently in slot 0 of the defending team's lineup (handles auto-subs).

```
gkScore = (gk.defending * 0.3 + gk.positioning * 0.4 + gk.physicality * 0.3) / 100
saveProb = gkScore * gkChanceModifier * fatigueModifier
  // GK_MODIFIER_CLEAR = 0.28, GK_MODIFIER_HALF = 0.46
goalProb = 1 - saveProb
```

**Assist attribution**: `pickAssister` returns the highest-passing player among the _other_ involved attackers (not the shooter). If only one attacker was involved, no assist.

**GK rating bonus**: When `chanceDetail.saved` is true, the defending GK gets `RATING_SAVE: 0.4` (added to `beat.ts` after the rating-on-chance branch). Before this addition, GKs only moved on goals conceded / clean sheet.

**Constants tuned heavily**: Spec values produced ~0.6 goals/match in batch testing. We tuned `CLEAR_CUT_BASE: 0.38`, `GK_MODIFIER_CLEAR: 0.28`, `GK_MODIFIER_HALF: 0.46` to land in the 2.5–2.8 goals/match band.

---

## 1.9 Fouls, Cards, Injuries (`engine/resolution/fouls.ts`)

**Purpose**: One foul roll per beat, independent of the beat's main outcome.

**Foul probability** (`foulProbability`):

```
p = BASE_FOUL_RATE                                     (0.49 — tuned high)
  + max(0, atkDribbling - defDefending) * 0.002        // skill mismatch
  + (atkPhys > defPhys ? FOUL_PHYS_BONUS : 0)          (0.015)
  + (defenderTeamMentality === "attacking" ? FOUL_MENTALITY_ATTACKING : 0)  (0.015)
  + (1 - avgDefStamina / 100) * FOUL_STAMINA_WEIGHT    (0.025)
clamp [0, 0.98]
```

**Fouler picking** (`pickWeightedDefender`): biased toward worse defenders + tired legs. Yellowed defenders are normally excluded ("safe mode") but `ALLOW_YELLOWED_FOUL` (1.5%) chance lets them back in — produces second-yellow reds at a realistic rate.

**Card resolution**: red roll first (`RED_BASE_CHANCE * refStrictness`, ~0.45% baseline). If no red, yellow roll with multipliers for tactical fouls (×1.4) and dangerous-zone fouls (×1.3). A second yellow auto-converts to a red and marks the player off-pitch.

**Injuries** — two sources:

1. **Foul-triggered** (`rollFoulInjury`): elevated rate. `INJURY_FOUL_RATE 0.0014 + injuryProneness * 0.0036 + fatigue * 0.0029 + frailty * 0.0014`.
2. **Passive** (`rollPassiveInjury`): one random on-pitch player per beat. `INJURY_BASE_RATE 0.00023 + ...`.

Both rates scaled way down from spec to hit the 1-injury-per-5-8-matches target across 45 beats.

**Player off-pitch state**: red cards flip `isOnPitch = false` directly in `fouls.ts:91-92,97-98`. Injuries do the same in `beat.ts`. Both then fire `tryAutoSub` (red cards are gated — see §1.14, but actually injuries only — red-carded teams play short).

**Referee strictness**: rolled once per match in `initializeMatchState` (33% lenient/normal/strict). Multiplies all yellow/red probabilities — a strict ref turns a 13% yellow into 18%.

---

## 1.10 Set Pieces (`engine/resolution/setPieces.ts`)

**Purpose**: Resolve free kicks, penalties, and corners.

**Foul-triggered set pieces** (`classifySetPiece`):

| Foul zone         | Set piece                                                              |
| ----------------- | ---------------------------------------------------------------------- |
| Centre or counter | Free kick (penalty if `rng.chance(PENALTY_FRACTION_OF_FOUL = 0.0033)`) |
| Wing              | Crossing free kick → resolved as a corner                              |
| (other)           | No set piece                                                           |

**Free kick** (`resolveFreeKick`): best shooter's shooting stat vs GK. `FREE_KICK_BASE_CONVERSION 0.12` is the floor.

**Penalty** (`resolvePenalty`): `shooter.shooting / 100 * PENALTY_CONVERSION_FACTOR (0.85)`, clamped `[0.65, 0.90]`. Tight band — penalties almost always go in or hit the post.

**Corner** (`resolveCorner`): generated open-play (after a save: 50%, after a buildup: 20%) or from a wing-zone foul.

```
delivery = bestPasser.passing / 100
attackAerial = max(att.physicality + att.positioning) / 200
defenseAerial = max(def.physicality + def.defending) / 200

cornerChance = delivery * CORNER_DELIVERY_WEIGHT (0.4) * (attackAerial - defenseAerial + 0.5)
```

If a corner produces a chance, we re-run Stages 2 and 3 of goal resolution. ~8-12% of corners produce a goal, on target with the spec.

**Tracking**: open-play corners are recorded via `BeatResult.cornerTaken = true`. Foul-derived corners go on `BeatResult.foulDetail.setPiece`. `buildResult` sums both for `teamTotals.corners`.

---

## 1.11 Stamina (`engine/mechanics/stamina.ts`)

**Purpose**: Track per-player fatigue across the match.

**Per-beat drain** (`applyBeatStaminaDrain`):

```
drain = BASE_STAMINA_DRAIN                             (1.44)
  + ACTION_STAMINA_DRAIN if involved in this beat      (0.86)
  + mentalityDrain                                     (att +0.48, def -0.24, bal 0)

actualDrain = drain * (100 / max(1, card.stats.stamina))
```

The stamina-stat division means a player with stamina 100 drains at 1.0×, stamina 50 at 2.0×, stamina 80 at 1.25×. **Higher stamina stat = slower drain**.

**Half-time recovery**: At beat 23 (minute ~46), every on-pitch player gets `+HALFTIME_RECOVERY (10)` stamina, capped at 100. Triggered inside `processBeat` when `state.beat === HALFTIME_BEAT`.

**Goal-scorer adrenaline boost** (`applyGoalStaminaBoost`): every on-pitch player on the _scoring_ side gets `+GOAL_STAMINA_BOOST (3)` stamina after a goal. Capped at 100. Conceding side gets nothing. Fires after the regular drain so the net effect for an involved scorer is roughly drain − 3 (the boost ~cancels the work they just did).

**Fatigue multiplier** (`engine/stats.ts:getFatigueMultiplier`): the read side. Used by `effective` to scale every stat read:

| Stamina | Multiplier |
| ------- | ---------- |
| 80–100% | 1.00       |
| 60–79%  | 0.95       |
| 40–59%  | 0.85       |
| 20–39%  | 0.70       |
| 0–19%   | 0.55       |

A player at 30% stamina sees all their stats read as 0.70× their printed values.

---

## 1.12 Momentum (`engine/mechanics/momentum.ts`)

**Purpose**: A single number tracking match flow — used by both possession and chance quality.

**Range**: −20 to +20. Positive favours home. Starts at 0.

**Per-beat updates**:

| Event                          | Delta                          |
| ------------------------------ | ------------------------------ |
| Goal scored                    | ±MOMENTUM_GOAL (7)             |
| Chance created                 | ±MOMENTUM_CHANCE (3)           |
| Chance conceded                | ±MOMENTUM_CHANCE_CONCEDED (−1) |
| Good defense (NOTHING outcome) | ±MOMENTUM_GOOD_DEFENSE (1)     |

**Decay**: Every beat, momentum moves 5% (`MOMENTUM_DECAY: 0.029`) toward 0. Prevents permanent runaway.

**Helpers**:

- `adjustMomentumForHome(current, delta)`: adds delta, clamps to `[MOMENTUM_MIN, MOMENTUM_MAX]`.
- `decayMomentum(value)`: returns the value times `(1 - MOMENTUM_DECAY)`.

**Where it feeds in**:

- Possession: `+ momentum * MOMENTUM_WEIGHT (0.005)` to home phase chance.
- Goal resolution Stage 1: `+ momentum * CLEAR_CUT_MOMENTUM_WEIGHT (0.003)` to clear-cut probability.

**Future**: home advantage will set initial momentum to +5 (currently `0`).

---

## 1.13 Match Ratings (`engine/mechanics/ratings.ts`)

**Purpose**: Per-player performance score, 1.0–10.0, starting at 6.0 for everyone.

**Helper**: `adjustRating(ps, delta)` adds delta and clamps to `[RATING_MIN, RATING_MAX]`.

**Events** (constants in `SIM_CONSTANTS`):

| Event                                    | Delta                       |
| ---------------------------------------- | --------------------------- |
| Goal                                     | +RATING_GOAL (1.5)          |
| Assist                                   | +RATING_ASSIST (1.0)        |
| Key pass (chance with no goal)           | +RATING_KEY_PASS (0.5)      |
| GK save                                  | +RATING_SAVE (0.4)          |
| Buildup involvement                      | +RATING_BUILDUP (0.2)       |
| Good defense (NOTHING outcome, defender) | +RATING_GOOD_DEFENSE (0.2)  |
| Foul committed                           | −RATING_FOUL (0.3)          |
| Yellow card                              | −RATING_YELLOW (0.5)        |
| Red card / second yellow                 | −RATING_RED (1.5)           |
| Goal conceded (defender / GK)            | −RATING_GOAL_CONCEDED (0.4) |
| Clean sheet (full time, defender / GK)   | +RATING_CLEAN_SHEET (0.8)   |

**Where they're applied**: most are in `beat.ts` (goal/buildup/nothing branches, foul rating bumps). `RATING_CLEAN_SHEET` is in `match.ts:applyCleanSheet` after the loop. `RATING_SAVE` is in `beat.ts` when `chanceDetail.saved` fires for a defending GK.

**Output**: ratings appear in `playerSummaries` with one decimal place of precision. They're not yet fed into form/progression — that's future post-match processing.

---

## 1.14 Auto-Substitutions (`engine/mechanics/subs.ts`)

**Purpose**: Bring on a bench player to fill a slot vacated by an injured starter. Red-carded teams play a man down (real football rule).

**API**: `tryAutoSub(state, side, vacatedCardId): Card | null` — returns the sub that came on, or null if no eligible bench player.

**Algorithm**:

1. Find the vacated slot via `squad.lineup.find(l => l.cardId === vacatedCardId)`.
2. Read the position the formation expects at that slot: `FORMATION_SLOTS[formation][slot]`.
3. Walk the `POSITION_AFFINITY` ladder (e.g. CDM → CM → CB → CAM) and pick the first bench player whose position matches the current tier and isn't already injured / sent off / on the pitch.
4. Update `slotInfo.cardId = candidate.id`, set `ps.isOnPitch = true`.

**`POSITION_AFFINITY`** (`consts/engine.ts`): for each slot position, an ordered list of acceptable substitute positions. First entry is always the position itself. Used by both this system and `squad-generator.ts` (initial lineup assembly).

**Trigger sites in `beat.ts`**:

- After foul-injury (`beat.ts:177`): `tryAutoSub(state, victimSide, victimId)`.
- After passive injury (`beat.ts:225`): `tryAutoSub(state, pickSide, pickId)`.

**NOT triggered**: red cards. Players sent off are not replaced; the team plays short.

**Why we clone `lineup` at match start**: `tryAutoSub` mutates `state.{home,away}Squad.lineup` directly. Without the shallow-clone in `initializeMatchState`, mutations would leak into the caller's `Squad` object — which would corrupt subsequent matches in `run-season` / `run-formation-season` that re-use the same squad references.

**Limitation**: bench is 4 cards. After 4 substitutions (very rare in v1), further injuries leave slots empty. Substituted players stay off-pitch — there's no re-substitution back in.

---

## 1.15 Tactical Adaptation (`engine/mechanics/tactics.ts`)

**Purpose**: Mid-match mentality switches based on score and time.

**API**: `adaptTactics(state)` — idempotent, mutates `state.{home,away}Tactics.mentality` if rules say so.

**Rules**:

| Minute | Score gap | Effect                                  |
| ------ | --------- | --------------------------------------- |
| < 60   | any       | No change                               |
| ≥ 60   | ≥ 2 goals | Leader → defensive, trailer → attacking |
| ≥ 75   | ≥ 1 goal  | Leader → defensive, trailer → attacking |

Constants: `TACTICS_ADAPT_MINUTE_BIG: 60`, `TACTICS_ADAPT_MINUTE_SMALL: 75`.

**Idempotent**: re-evaluates from current state every beat. A score swing (2-0 → 2-1 → 2-2) walks back through the rule cleanly — when score equalises and the gap drops below 1, the rules don't fire and the tactics are left as-is (locked-in once changed; no automatic revert to starting mentality).

**Called from**: `runMatch` and `runMatchLive` after every `processBeat` (both regular and stoppage beats). See `match.ts:adaptTactics` calls.

**Why we clone `tactics` at match start**: same reason as lineup — avoids leaking mid-match mentality changes into the caller's input `Tactics` object across reused matches in season runners.

**Visible effect**: defensive 5-back teams holding leads (Iron Wall FC consistently top-3 in seasons), attacking-mentality teams chasing late goals when behind.

---

## 1.16 Effective Stats / Single Read Point (`engine/stats.ts`)

**Purpose**: All in-match stat reads go through `effective(card, ps, weather)` (or `getEffectiveStats(card, ctx)` for the verbose form).

**Composition**:

```
base = card.stats[s] + (card.statBoosts?.[s] ?? 0)        -- earned overlay
read = base × fatigue × chem × form × fit × legend × weather × mode
```

Stamina-the-stat skips fatigue but takes the rest.

**Today's modifiers**:

1. **Earned stat boosts** (§1.23) — additive overlay applied before any multiplier. Sourced from auto-boost (§3.2) and XP spend (§3.4). Engine never mutates these; the career layer does.
2. **Fatigue** (§1.11) — `getFatigueMultiplier(currentStamina)` returns 0.55–1.00.
3. **Chemistry** (§1.17) — `1 + chemistry * CHEMISTRY_BONUS_PER_TEAMMATE` from `PlayerMatchState.chemistry`. Multiplies every stat (including stamina-the-stat).
4. **Form** (§1.20) — `card.form` (default 1.0).
5. **Position fit** (§1.19) — `playerState.positionFit` (1.0 exact, down to 0.7 unrelated).
6. **Legend buff** (§1.23) — `playerState.legendBuff` (1.0 if no profile/legends; 1.05–1.11+ for users with retired-card legends in that role).
7. **Weather** (§1.18) — `WEATHER_MODS[weather].stats` is a partial map of stat → multiplier. Missing entries imply 1.0.
8. **Mode** (§1.21) — yellow-card safe mode reduces `defending` only.

Each modifier is a multiplier; they compose. A 100-shooting striker at 50% stamina, with chemistry 4, in rain reads:
`100 × 0.85 (fatigue) × 1.02 (chem 4 × 0.005 + 1) × 1.0 (rain doesn't touch shooting) = 86.7`

**Helpers**:

- `weightedScore(stats, weights)`: sums `stat * weight` across the keys present in `weights` (handles partial weight maps).
- `sigmoid(x)`: logistic curve, used by beat-outcome.

**Future modifiers (deferred)**: form (post-match update affects future matches), position-fit (LB in CB slot reads at 0.9×), yellow-card mode (`PlayerMatchState.mode === "safe"` reduces aggression).

**Constraint**: nothing else in the engine is allowed to read raw `card.stats.X` for in-match decisions. `zones.ts:scoreMatchup` is the canonical consumer. Foul probability does dip into raw stats for some inputs (`avgAtkPhys`, `avgDefPhys`), but those are arguably borderline.

**Persistent-stat exceptions**: `applyBeatStaminaDrain` (`mechanics/stamina.ts`) and `rollPassiveInjury` (`resolution/fouls.ts`) read `card.stats.X + (card.statBoosts?.X ?? 0)` rather than going through `getEffectiveStats`. Earned boosts count (persistent character growth), but match-time multipliers like chemistry/weather don't — drain rate and injury frailty are anchored to the persistent card sheet, not the live match conditions.

---

## 1.17 Chemistry (`engine/match.ts:initPlayers`, `engine/stats.ts`)

**Purpose**: Reward squads built around shared nationality with a small stat boost per player.

**Computation**: Once at match start, `initPlayers` walks the starting 11 and counts same-country teammates per card. The result lives on `PlayerMatchState.chemistry` (0–10 range, since max 10 same-country teammates exist in an 11-man lineup minus self).

**Subs**: chemistry is also pre-computed for bench cards against the _starting_ 11's country distribution. When a sub comes on, their pre-computed value is used as-is (no recompute, since the on-pitch composition only changes by 1 player).

**Application**: `getEffectiveStats` multiplies every stat by `1 + chemistry × CHEMISTRY_BONUS_PER_TEAMMATE`. With `CHEMISTRY_BONUS_PER_TEAMMATE: 0.005`, max boost is 10 × 0.005 = +5%.

**Asymmetric value across squad types**:

- Mixed-nationality squad (the default for any procedurally-generated team): chemistry 0–2 per player → 0–1% boost. Mostly noise.
- Single-nationality squad (pin `country` on `generateSquad`): chemistry 10 per player → +5% on every stat read.

Most generated squads are mixed-nationality (each card pulls from a random country pool). Pinning `country` is the opt-in for full-chemistry squads — used by hand-crafted fixtures, not by default AI-team generation.

**Constants**: `CHEMISTRY_BONUS_PER_TEAMMATE: 0.005` (0.5% per teammate).

---

## 1.18 Weather (`engine/match.ts:pickWeather`, `consts/engine.ts:WEATHER_MODS`)

**Purpose**: Pre-match pitch conditions that reshape stat reads, injury rates, and zone preference.

**Conditions** (4): `clear`, `rain`, `snow`, `wind`. Rolled once in `initializeMatchState` via `WEATHER_PROBABILITIES` (clear 65% / rain 20% / wind 10% / snow 5%) and stored on `MatchConfig.weather`. Exposed on `MatchResult.weather`.

**Effects table** (`WEATHER_MODS`):

| Weather | Stat multipliers                           | Injury bonus | Zone bias                      |
| ------- | ------------------------------------------ | ------------ | ------------------------------ |
| `clear` | none                                       | 0            | none                           |
| `rain`  | pace ×0.93, dribbling ×0.95                | +0.0008      | centre −0.02, long_ball +0.02  |
| `snow`  | pace ×0.85, dribbling ×0.85, passing ×0.92 | +0.0012      | long_ball +0.04, counter −0.03 |
| `wind`  | passing ×0.92, shooting ×0.95              | 0            | long_ball −0.04, centre +0.02  |

**Where it's applied**:

- **Stat reads** — `getEffectiveStats` multiplies each stat by `WEATHER_MODS[weather].stats[stat] ?? 1`.
- **Injury rolls** — `rollFoulInjury` and `rollPassiveInjury` add `WEATHER_MODS[weather].injuryBonus` to the per-beat injury probability. Rain/snow ~3-5× passive injury rate.
- **Zone selection** — `pickZone` adds `WEATHER_MODS[weather].zoneBias[zone] ?? 0` to each zone's weight. Snow nudges teams toward long balls; wind nudges away from them.

**Symmetric impact**: weather affects both teams. The deltas it creates aren't between teams but between zones (wing attacks suffer in rain because pace drops; long balls suffer in wind). Total goals/match dropped ~3-4% in the formation-season test (2.27 → 2.18) because most non-clear conditions reduce attacker stats more than defender stats (DEFENSE_WEIGHTS lean on defending+positioning which weather doesn't touch much).

**Future**: more conditions (heat, fog), per-stadium weather distributions, weather forecast displayed pre-match.

---

## 1.19 Position Fit (`engine/stats.ts:computePositionFit`)

**Purpose**: Penalise cards playing out of position. A natural CB filling a CB slot reads at full strength; a winger forced into central defence reads markedly weaker.

**Computation**: For each starter, look at their card's natural `position` and the position the formation expects at their slot (`FORMATION_SLOTS[formation][slot]`). Walk the destination slot's `POSITION_AFFINITY` ladder and pick a multiplier based on how far down the ladder the card's position appears:

| Distance       | Multiplier | Constant                  | Example        |
| -------------- | ---------- | ------------------------- | -------------- |
| Exact match    | 1.00       | `POSITION_FIT_EXACT`      | CB in CB slot  |
| Ladder index 1 | 0.96       | `POSITION_FIT_NEIGHBOR`   | CDM in CB slot |
| Ladder index 2 | 0.92       | `POSITION_FIT_TWO_AWAY`   | LB in CB slot  |
| Ladder index 3 | 0.88       | `POSITION_FIT_THREE_AWAY` | RB in CB slot  |
| Not in ladder  | 0.7        | `POSITION_FIT_UNRELATED`  | ST in CB slot  |

**Storage**: Result is pre-computed per starter in `initPlayers` and stored on `PlayerMatchState.positionFit`. Bench cards default to 1.0; `tryAutoSub` overwrites it with the real value when a sub takes a slot.

**Application**: `getEffectiveStats` multiplies every stat by `positionFit`, including stamina-the-stat (an out-of-position player tires roughly the same but reads as if they had less stamina to give).

**Why this matters**: enforces the squad-assembler's affinity ladder mechanically. A starter pack that lands a CB in a CDM slot now actually plays at 96% — visible enough to favour exact-position cards in pack draws.

---

## 1.20 Form (`engine/mechanics/form.ts`)

**Purpose**: Persistent stat multiplier carried _between_ matches. A player on a hot streak reads above their printed stats; a slumping player reads below.

**Storage**: `Card.form` is an optional number (defaults to 1.0 when absent). Lives on the card itself — persistence between matches is the caller's responsibility (mutation of `Card.form` is the persistence layer).

**Read**: `getEffectiveStats` multiplies every stat by `card.form ?? 1`. Same composition as chemistry — it's a flat multiplier on every stat (including stamina-the-stat).

**Update**: `mechanics/form.ts:applyFormUpdates(homeSquad, awaySquad, result)` mutates each appearing player's `card.form`:

```
delta = (matchRating - RATING_START) * FORM_DELTA_PER_RATING   // 0.02 per point
card.form = clamp(card.form + delta, FORM_MIN, FORM_MAX)       // [0.85, 1.15]
```

A 6.0 rating produces 0 change. A 9.0 rating bumps form by +0.06 (a hat-trick night). A 4.5 rating drops form by −0.03. Bench-warmers (`minutesPlayed === 0`) are skipped.

**Engine never calls this**. The engine reads `card.form` and that's it. Test runners, season runners, and future progression systems opt-in to form persistence by invoking `applyFormUpdates` between matches. None of the existing CLIs do — form stays at 1.0 across all of them. (Smoke-tested working: feeding the same matchup 5 times with form-update enabled drifts top performers up to 1.05–1.08.)

**Constants**: `FORM_DELTA_PER_RATING: 0.02`, `FORM_MIN: 0.85`, `FORM_MAX: 1.15`. Tuned so a strong run of 5–10 matches lifts form ~10%; a cold streak drops it the same. The engine cap means form alone never swings a stat read by more than ±15%.

---

## 1.21 Yellow-Card Safe Mode (`engine/resolution/fouls.ts`, `engine/stats.ts`)

**Purpose**: A defender on a yellow card gets cautious — both less likely to commit another foul (already modelled) and less effective in tackles (the new piece).

**`PlayerMatchState.mode`**: a 3-state field — `"normal" | "aggressive" | "safe"`. Until this section it was always `"normal"` (set in `initPlayers`). Now `fouls.ts:resolveFoul` flips the fouler to `"safe"` after their first yellow. Red cards / second yellows take the player off-pitch instead.

**Two effects in tandem**:

1. **Foul-commit suppression** (pre-existing) — `pickWeightedDefender` excludes yellowed defenders from foul rolls except for a 1.5% `ALLOW_YELLOWED_FOUL` chance per beat. This drops second-yellow reds dramatically.
2. **Defending stat penalty** (new) — `getEffectiveStats` multiplies the player's `defending` (only `defending` — other stats unchanged) by `MODE_SAFE_DEFENDING_MULTIPLIER` (0.92). A safe-mode CB defends at 92% of their printed defending value.

**Mirror — aggressive mode**: `MODE_AGGRESSIVE_DEFENDING_MULTIPLIER` (1.05) is reserved for future user-chosen tactics ("press hard", aggression-first cards, etc.). No engine code currently sets `mode = "aggressive"`.

**Visible impact**: red cards in the 500-match batch dropped from 1/7.8 to 1/10.2 (now in spec range). Penalties also self-corrected from 1/22.7 to 1/13.9 — fewer late, desperate fouls because the same fouler isn't going in twice.

---

## 1.22 Home Advantage (`engine/match.ts:initializeMatchState`, `engine/mechanics/stamina.ts`)

**Purpose**: The home team gets two small edges — initial momentum tilt and an away-team stamina tax. Models crowd, familiarity, and travel fatigue.

**1. Initial momentum bias**: `initializeMatchState` now seeds momentum at `HOME_ADVANTAGE_MOMENTUM` (5) instead of 0. Momentum feeds possession (`+ momentum * 0.005` to home phase chance) and chance quality (`+ momentum * 0.003` to clear-cut probability). With the standard `MOMENTUM_DECAY` (0.029/beat), the +5 bonus halves over ~24 beats — meaningful for the opening half-hour.

**2. Away stamina drain penalty**: `stamina.ts:drainOne` multiplies the away team's per-beat drain by `AWAY_STAMINA_DRAIN_MULTIPLIER` (1.05). 5% faster drain → away players hit fatigue thresholds (the 80/60/40/20 stamina cliffs) ~5% earlier. Effects compound late-match.

**Visible impact**: 500-match batch shows home wins at 39.6% vs away wins at 37.2% (draws 23.2%). 2.4 percentage-point edge to home, plus avg score 1.46 vs 1.39. Realistic — top European leagues sit around 45% home / 27% away historically; our current edge is conservative and tuneable.

**Future**: per-stadium home advantage (e.g. some grounds have stronger crowds), referee bias toward home (very real in football, currently absent here), pitch-condition variance.

---

## 1.23 Legend Buff (engine integration of `career/legends.ts`)

**Purpose**: A user's retired cards become club legends; each legend permanently boosts every current player in the same role group. The engine just reads a precomputed multiplier — the buff math (stack-position, diminishing returns) lives in `career/legends.ts` (§3.5).

**Wire shape**:

- `MatchInput.homeLegendBuffs` and `awayLegendBuffs` carry `RoleBuffs = { GK, DEF, MID, ATT }`. Each value is a multiplier (1.0 = no buff). Either side may be omitted; missing → `NO_LEGEND_BUFFS` (all 1.0).
- `initPlayers` (`engine/match.ts`) maps each card's position to a role via `ROLE_BY_POSITION` and stores the appropriate multiplier on `PlayerMatchState.legendBuff`.
- `getEffectiveStats` multiplies every stat (including stamina-the-stat) by `legendBuff`.

**Subs**: bench cards have their `legendBuff` precomputed against the same role-buff table. When `tryAutoSub` swaps them onto the pitch, the value is already correct — no recompute needed.

**AI scope**: AI teams pass no buffs (or `homeLegendBuffs` only when the user is home). AI legends are not tracked.

**Why this lives in the engine**: legends are a stat modifier, and the engine's contract is "all modifiers go through `getEffectiveStats`". The career layer owns the data; the engine reads a derived per-match snapshot.

---

# Part 2 — Generation Systems

These are pre-match data primitives. They produce `Card` and `Squad` objects that the engine then consumes. None of them run during a match.

## 2.1 Card Stats (`generators/card-stats.ts` + `consts/card.ts`)

**Purpose**: Stat-rolling primitives. The constants and `POSITION_PROFILE` data table live in `consts/card.ts`; the rolling logic (`rollStat`, `generateStats`, `generateStatPotentials`) lives in `generators/card-stats.ts`.

**`POSITION_PROFILE`** (in `consts/card.ts`): For each of 12 positions (`GK`, `CB`, `LB`, `RB`, `CDM`, `CM`, `CAM`, `LM`, `RM`, `LW`, `RW`, `ST`), maps each of 8 stats to one of three bands (`low`, `mid`, `high`). Mirrors the position guidelines table in the brief. Example: `ST: { pace: 'mid', shooting: 'high', passing: 'low', dribbling: 'mid', defending: 'low', physicality: 'mid', positioning: 'high', stamina: 'low' }`.

**`CARD_CONSTANTS`** (in `consts/card.ts`):

- `bandRanges` — `low: [30, 50]`, `mid: [50, 70]`, `high: [70, 90]`. Bands deliberately overlap a little around 45–50 so the distribution looks naturalistic rather than three discrete clusters.
- `tierBonus` — `rookie: -6`, `semipro: 0`, `pro: +6`, `super: +12`, `legend: +22`. Flat shift applied to every rolled stat. Expected team overalls on a 4-3-3 procgen squad: rookie ≈ 57, semipro ≈ 63, pro ≈ 69, super ≈ 75, legend ≈ 84.
- `statFloors` — per-stat absolute minimums applied AFTER tier bonus. Currently `stamina: 40` (every player needs baseline endurance — no more rookie strikers gassed by minute 30). Stats not listed fall back to `globalFloor`.
- `globalFloor: 15`, `globalCeiling: 95` — ultimate clamp on any rolled value.

**API** (in `generators/card-stats.ts`):

- `rollStat(position, stat, tier, rng)` — single stat. Bands → tier bonus → floor (per-stat or global) → ceiling.
- `generateStats(position, tier, rng)` — full 8-stat block.
- `generateStatPotentials(position, stats, rng)` — full 8-stat hidden-ceiling block. Each stat's potential = current + `rng(headroomMin..headroomMax)`, capped at the band's hard ceiling. Constants in `PROGRESSION_CONSTANTS.potentialBands` (separate from `CARD_CONSTANTS` because potentials are a progression concern). `low` band: 0–10 headroom, ceiling 65. `mid`: 5–20, 85. `high`: 10–30, 99. See §3.1.

**GK note**: there's no dedicated GK stat. Goalkeepers use defending + positioning + physicality (all `high` band) for their save formula. Their pace/shooting/dribbling are forced low.

---

## 2.2 Name Pools (`generators/card-names.ts`)

**Purpose**: Country-tagged name pools for procedural card naming.

**Shape**: `CARD_NAMES: CountryNamePool[]` with `{ country, firstNames[], lastNames[] }`.

**Coverage**: 12 countries — England, Scotland, Ireland, Spain, Italy, France, Germany, Netherlands, Brazil, Argentina, Portugal, Wales. Each has 12 first names + 12 last names → 144 unique combinations per country, 1,728 across all pools.

**Style**: realistic-but-fictional (matching the tone of the hand-built sample squads). E.g. England: `["Harry", "Jack", ...]` × `["Walker", "Whitfield", ...]`.

**Coupling guarantee**: a card's `country` field always matches the pool its name was drawn from. There's no path in the code where these diverge. (Mixed-heritage names — English first + Italian last — are not currently generated. Implementation note: easy to add by decoupling pool selection per name, but no use case yet.)

**Limitation**: no Asian, African, Eastern European, North American countries. Adding them is mechanical: just append to the array.

---

## 2.3 Card Generator (`generators/card-generator.ts`)

**Purpose**: Produce a single fully-populated `Card`. Building block for packs, drafts, and squad assembly.

**API**: `generateCard(rng, opts?): Card`. Opts: `{ position?, country?, tier?, idPrefix?, excludeNames? }` — pin any field to bypass the random roll.

**What it does**:

1. **Position**: opts.position, else weighted-random via `POSITION_WEIGHTS` (CB×2, CM×2, ST×1.5, LM/RM×0.5, others ×1).
2. **Pool**: opts.country lookup in `CARD_NAMES`, falls through to random pool if not found (silent fallback — known pre-existing quirk).
3. **Name**: `pickName(rng, pool, excludeNames?)` — random first + last from the pool, with retry-on-collision if `excludeNames` is provided. Up to 20 random retries → deterministic scan of all 144 combinations → numbered suffix as last resort.
4. **Stats**: `generateStats(position, tier, rng)` from §2.1.
5. **Hidden potentials**: `generateStatPotentials(position, stats, rng)` — rolled at the same time, stored on `card.statPotentials`. Capped by position band (a CB's shooting ceiling stays low). See §3.1.
6. **Other fields**: `id` = `${idPrefix}-${6hex}` (not globally unique), `age` = `rng.int(18, 35)`, `injuryProneness` = `0.05 + rng.next() * 0.25`.

**Side effect**: if `opts.excludeNames` is passed, the generated name is added to the set so the next call can avoid it.

**Used by**:

- `squad-generator.ts` — batch of 18 cards with `excludeNames` for dedup.
- `run-formation-season.ts` — 15 cards per generated team, also with dedup.
- Future pack shop / draft system.

---

## 2.4 Squad Generator (`generators/squad-generator.ts`)

**Purpose**: Single 18-card squad factory with two modes, picked by whether `opts.formation` is set.

**API**: `generateSquad(opts?: GenerateSquadOpts): GeneratedSquad`. Opts include `name`, `tier`, `seed`, `formation`, `mentality`, `country`, `idPrefix`. Returns `{ squad, tactics, formationScores? }` — `formationScores` only present when formation was auto-detected.

### Mode A — Pack-pull (formation unset)

What a new user gets when they first join. Composition is partially forced (so every formation is at least playable) and partially random (so the pack's shape varies):

| Forced         | Count | Why                                                     |
| -------------- | ----- | ------------------------------------------------------- |
| GK             | 2     | First-choice + backup                                   |
| LB, CB, CB, RB | 4     | Back four foundation — lets every 4-back formation play |
| ST             | 1     | Always at least one striker                             |

| Random         | Count | From                                                                   |
| -------------- | ----- | ---------------------------------------------------------------------- |
| Defenders      | 2     | `{CB, LB, RB}` — extra back-line cover; opens 5-back if 2 wide-back roll |
| Midfielders    | 6     | `{CDM, CM, CAM, LM, RM}` — uniformly random                            |
| Wide attackers | 3     | `{LW, RW, ST}` — uniformly random                                      |

Total: 7 forced + 2 + 6 + 3 = 18.

**Best-fit formation**: `scoreAllFormations(cards)` walks each formation's `FORMATION_SLOTS` and counts how many starting-11 slots are filled by an exact-position card (greedy match). Highest score wins. Ties are broken by **lineup-fit avg** — for each tied formation, simulate the lineup that `assignLineup` would produce and prefer the one with the highest average position-fit. If still tied, deterministic `rng.pick`. This avoids the failure mode where two formations score equally but one would force an unrelated-position fallback (e.g., choosing 4-4-2 with no RM available, jamming a CB into RM at the unrelated penalty).

**Lineup assignment** (`assignLineup`, 3-pass):

1. Exact-position matches.
2. Affinity matches via `POSITION_AFFINITY` (CDM slot prefers CM > CB; LW slot prefers LM > CAM, etc.). Wide positions (LB/RB, LM/RM, LW/RW) cross-list each other so a wrong-foot wide player still reads at 0.88× rather than the unrelated 0.7×.
3. Final fallback: any unused outfielder.

Out-of-position assignments are silently fine (the engine doesn't care about position when scoring matchups), but the CLI tags them in the output.

**Distribution observed** (50 random seeds): 4-4-2 ~38%, 4-2-3-1 ~34%, 5-4-1 ~12%, 4-3-3 ~8%, 5-3-2 ~6%, 3-4-3 ~2%, 3-5-2 ~0%. 4-back dominates because the forced LB+RB are wasted bench players in 3-back formations, lowering 3-back's score.

### Mode B — Procedural team (formation set)

Used to spawn AI opposition or fixture league teams. Skips the pack-pull pool logic entirely:

- Cards generated to fit the supplied formation's slots exactly (one card per slot in `FORMATION_SLOTS[formation]`).
- Bench: 7 fixed positions — `["GK", "CB", "LB", "CDM", "CM", "ST", "RW"]` — covers backup at every line plus wide cover on both flanks.
- No best-fit detection — caller already chose the shape, so `formationScores` is omitted from the return.

### Country handling

- `opts.country` unset (default for both modes) → each card pulls from a random `CARD_NAMES` country pool. Squad is mixed-nationality.
- `opts.country` set → every card pulls from that pool. Squad is single-nationality (full chemistry — see §1.17).

Mixed-nationality is the default everywhere because AI teams in career mode shouldn't artificially inherit a +5% chemistry edge. Single-nationality is opt-in via the `country` option on `generateSquad`.

### Hidden potentials

Every card gets `statPotentials` rolled alongside its stats regardless of mode — see §3.1.

### Used by

- Pack-pull mode: `test/run-squad.ts` (preview CLI). In career mode (designed): user onboarding.
- Procedural mode: `test/fixtures/league-teams.ts` (8 procgen) and `test/fixtures/test-teams.ts` (2 procgen used by run-single / run-batch / run-progression). In career mode (designed): the 19 AI teams per league.

---

# Part 2.5 — Commentary

A stateful render layer that turns `BeatResult` events plus structural hooks (kickoff, half-time, full-time) into prose lines. Lives in `src/commentary/`. The engine emits no prose; the commentator is invoked by callers (currently `test/run-single.ts`).

## 2.5.1 Architecture

**Render layer, not engine output.** `BeatResult` shape is unchanged. The commentator consumes events and produces strings; engine seed-replay invariants are unaffected.

**Stateful per match.** `createCommentator(engineSeed)` returns an object that tracks score, recently-used line indices per pool, sendings-off, and stoppage state across the call sequence. One instance per match.

**Deterministic via derived RNG.** The commentator's RNG is `createRng(engineSeed ^ 0xC0DECAFE)` — same engine seed always produces the same prose, but adding new lines to a pool only changes commentary, not match outcomes.

## 2.5.2 API

```ts
const c = createCommentator(seed)
c.openMatch(home, away, weather)              → string[]   // kickoff + optional weather flavour
c.beat(ev, homeSquad, awaySquad)               → string[]   // per-beat lead-in / outcome / reactions
c.halfTime(homeName, awayName, snapshotScore)  → string[]   // half-time prose
c.fullTime(result)                             → string[]   // full-time prose
```

Caller is responsible for calling `halfTime` between beats 22 and 23 (or wherever it wants the break to appear) and `fullTime` after the last beat. `beat` auto-detects stoppage on the first beat with `minute > 90`.

## 2.5.3 Line architecture

**Base pools** (`commentary/lines.ts`) — 15 lines each per outcome: `NOTHING / BUILDUP / CHANCE / GOAL / SAVE / OFF_TARGET / FOUL`. Goal lines are pre-amped (caps + exclamations) since goals are big-moment register by default.

**Modifier prefixes** (`commentary/modifiers.ts`) — short contextual sentences keyed on `(time bucket × score state)`. Time buckets: `early ≤30' / mid 31-70' / late 71-90' / stoppage 90+'`. Score state: `level / leading / trailing` from the attacking team's perspective. ~3 prefixes per bucket, fired ~25% of the time on `nothing / buildup` outcomes only. Big moments (goals, reds) skip modifiers.

**Down-to-ten flavour** — overrides the time/scoreline modifier when the attacking team is short-handed.

**Special-moment pools** (`commentary/special.ts`) — kickoff, weather kickoff, half-time (3 sub-pools by scoreline), full-time (3 sub-pools by result), stoppage announcement, late-goal reactions (`minute >= 86`), equaliser reactions (trailing → level), comeback-lead reactions (trailing → leading), red-card reactions (one-off after a sending off).

## 2.5.4 Repetition avoidance

Per-pool last-8 index window. `pick(pool)` rolls up to 6 times trying to avoid the recent set, then falls back to uniform. With 15 lines per pool, the avoidance never depletes the pool but visibly suppresses runs of repeats.

## 2.5.5 Determinism contract

Engine seed → commentary seed via XOR. Same seed = same prose. Pool changes never disturb match logic. Commentary RNG is independent of the engine RNG, so prose authoring is safe to evolve without breaking match-replay tests.

## 2.5.6 Used by

- `test/run-single.ts` — wires the commentator into both static (`printBeatLog`) and live (`runLive`) modes. Banner output (HALF TIME / FULL TIME headers) preserved alongside prose for visual structure.
- Future UI / SSE / TTS layers will consume the same `string[]` outputs.

---

# Part 3 — Progression Systems

Post-match systems that turn match results into long-term player and account growth. The engine itself is untouched; these all run after `runMatch` returns. Constants live in `src/consts/career.ts:PROGRESSION_CONSTANTS`. Full design rationale: `06_progression-and-balance.md`.

## 3.1 Hidden Stat Potentials (`generators/card-stats.ts:generateStatPotentials`)

**Purpose**: Per-stat ceilings rolled at card generation. Hidden from the UI — discovered empirically when a stat stops growing.

**Formula**: For each of 8 stats, look up the position-band, then roll `current + rng(headroomMin..headroomMax)`, capped at the band's hard ceiling.

| Band   | Headroom    | Hard cap |
| ------ | ----------- | -------- |
| `high` | rng(10..30) | 99       |
| `mid`  | rng(5..20)  | 85       |
| `low`  | rng(0..10)  | 65       |

**Storage**: `card.statPotentials: Stats` (full 8-stat block).

**Application**: both auto-boost (§3.2) and manual XP spend (§3.4) check `current + 1 ≤ potential` before applying. If at potential, that stat is locked.

**Identity preservation**: a striker rolled with `defending: low` may have a defending potential of ~30. Even infinite XP can't make them a competent CB. Position bands stick.

---

## 3.2 Auto-Boost (`src/career/auto-boost.ts:applyAutoBoosts`)

**Purpose**: After a match, walk every card on the squad that played and roll for a +1 to a position-relevant stat. Magnitude always +1; chance is rating-driven and damped by total boosts received.

**API**: `applyAutoBoosts(squad, matchResult, side, rng): AutoBoostEvent[]`. Mutates `card.statBoosts` and `card.boostCount` in place. Returns one event per card that gained a stat.

**Rating → base chance**:

| Rating | Base chance |
| ------ | ----------- |
| ≥ 7.0  | 25%         |
| ≥ 8.0  | 55%         |
| ≥ 9.0  | 80%         |
| 10.0   | 100%        |

**Damping**: `baseChance / (1 + boostCount × 0.05)` so heavily-boosted cards level slower without ever hitting 0%.

**Stat eligibility**: `POSITION_PROFILE[position]` filtered to `high`-band (weight ×2) and `mid`-band (weight ×1) stats only. `low`-band stats never auto-boost (a CB never randomly grows their shooting). Stats already at potential are excluded.

**Magnitude cap**: one +1 per card per match, regardless of rating.

---

## 3.3 Earned-Stat Overlay (`engine/stats.ts:getEffectiveStats`)

**Purpose**: Where the engine actually reads earned boosts back out. Engine-side, not career-side, but the data flows from the career layer.

**Read path**: `(card.stats[s] + (card.statBoosts?.[s] ?? 0))` is computed _before_ any multiplier in `getEffectiveStats`. Then fatigue/chemistry/form/fit/legend/weather/mode all stack on top.

**No mutation in engine**: the engine never touches `statBoosts`. Only `auto-boost.ts:applyStatBoost` and `xp-spend.ts:applyStatUpgrade` write it.

**Storage**: `card.statBoosts: Partial<Stats>` — only stats with non-zero boost are present. `card.boostCount: number` is a denormalised sum used by the auto-boost damping curve.

---

## 3.4 XP Economy (`src/career/xp.ts`, `src/career/xp-spend.ts`)

**Purpose**: Account-level XP that the user earns per match and spends on whatever they want — currently stat upgrades and injury heals; designed to take more purchase kinds without rewriting.

**Earn — `computeMatchXp(result, userSide)`**: pure function returning a breakdown:

| Source                          | Per-event XP                                         |
| ------------------------------- | ---------------------------------------------------- |
| Match appearance                | +50 (once)                                           |
| Rating ≥ 6 / 7 / 8 / 9 / 10     | +10 / +20 / +40 / +80 / +160 (per qualifying player) |
| Goal                            | +30                                                  |
| Assist                          | +20                                                  |
| Clean sheet (per GK + defender) | +25                                                  |
| Win / Draw                      | +50 / +20                                            |
| Goal conceded                   | −50 (per goal)                                       |
| Yellow card                     | −20                                                  |
| Red card                        | −100                                                 |

Net floors at 0 — never negative. `awardMatchXp(profile, result, userSide)` mutates `profile.xpBalance` and `profile.totalXpEarned`.

**Spend — `spend(profile, request, ctx)`**: extensible discriminated-union dispatcher. Adding a new purchase kind is three steps:

1. Add a variant to `XpPurchaseRequest` (e.g. `{ kind: "buy_scout", regionId: string }`).
2. Add a `case` to `costFor()` and `spend()`.
3. Write the per-kind cost calculator + apply handler.

`PurchaseContext.findCard(id)` decouples this module from any storage layer — caller resolves card IDs.

**Built variants**:

- `stat_upgrade` — cost from `PROGRESSION_CONSTANTS.upgradeCosts` based on current value (50→60: 100 XP; 95→99: 1600 XP). Validates the stat is below its potential. Mutates `card.statBoosts` via the same `applyStatBoost` helper auto-boost uses.
- `heal_injury` — cost from `PROGRESSION_CONSTANTS.healCosts`. Light: 100 XP, medium: 400 XP, heavy: 1200 XP. Knocks aren't heal-able (resolve naturally).

---

## 3.5 Persistent Injuries (`src/career/injuries.ts`)

**Purpose**: Turn the engine's one-shot `MatchResult.playerSummaries[i].injured` flag into a multi-match recovery process with a team-wide concurrency cap.

**Severity tiers** (rolled per new injury):

| Severity | Weight | Games out           |
| -------- | ------ | ------------------- |
| Knock    | 0.45   | 0 (this match only) |
| Light    | 0.35   | 1                   |
| Medium   | 0.15   | 2–3                 |
| Heavy    | 0.05   | 4–5                 |

**API**: `processSquadInjuries(squad, result, side, rng): InjuryEvent[]`. Three-step:

1. **Tick existing**: decrement `card.injuryReturnsAfterMatch`. When it hits 0, flip `card.injuryStatus = 'active'` and clear severity.
2. **Roll new**: for each `summary.injured`, roll severity from the weights table.
3. **Apply 2-cap**: count active injuries before applying. If already at `maxConcurrentInjuriesPerTeam` (2), downgrade the new one to a knock — player still off-pitch this match (engine handled it), but no carryover.

**Storage** on the card: `injuryStatus`, `injurySeverity`, `injuryReturnsAfterMatch`. All optional/undefined when healthy.

**Lineup integration** (designed, lives in the still-unbuilt career loop): before a fixture starts, `isUnavailable(card)` flags injured players so the lineup picker can swap them with bench cover.

**Heal path**: `xp-spend.ts:heal_injury` clears the injury early at a tunable XP cost. See §3.4.

---

## 3.6 Club Legends (`src/career/legends.ts`)

**Purpose**: When a user's card retires, it becomes a club legend. Each legend grants a small permanent buff to all current players in the same role group. Stacks with diminishing returns.

**API**:

- `recordLegend(profile, card, season): Legend` — appends to `profile.legends`, freezing `buffPct` at the value for its current stack-position so future legends don't retroactively shrink existing buffs.
- `computeRoleBuffs(profile): RoleBuffs` — flattens `profile.legends` into per-role multipliers. Buffs sum additively within a role: `1 + sum(buffPct)`.

**Stack-position ladder** (`PROGRESSION_CONSTANTS.legendBuffsByStackPos`):

| Stack pos | Buff     |
| --------- | -------- |
| 1st       | +5%      |
| 2nd       | +3%      |
| 3rd       | +2%      |
| 4th+      | +1% each |

**Role mapping**: `ROLE_BY_POSITION` (`consts/career.ts`) flattens 12 positions into 4 role groups (GK / DEF / MID / ATT).

**Engine integration**: `RoleBuffs` are passed into `MatchInput.{home,away}LegendBuffs` and read by `initPlayers` (§1.23). AI teams don't track legends — they pass nothing.

**Auto-trigger pending**: there's no automatic age-out + retirement loop yet (waiting on the season-rollover code). For now `recordLegend` is called explicitly by the smoke test (`run-progression.ts`).

---

## 3.7 Smoke Test (`src/test/run-progression.ts`)

**Purpose**: End-to-end sanity check for Part 3. Runs N matches between the two sample squads, applying all post-match systems in order and printing the deltas.

**What it does each match**:

1. `runMatch(input)` with the user's current legend buffs fed in.
2. `applyFormUpdates(home, away, result)` — existing v1 form mechanic.
3. `applyAutoBoosts(home, result, "home", rng)` and same for away — print stat-bumps.
4. `processSquadInjuries(home, result, "home", rng)` and same for away — print severities.
5. `awardMatchXp(profile, result, "home")` — print itemised breakdown + new balance.

**At the end**: demos a `stat_upgrade` purchase, retires the oldest user card into a legend, prints the new role-buff vector.

**CLI**: `npm run progression -- --seed 12345 --matches 5`. Output snapshot in `06_progression-and-balance.md`.

---

# Part 4 — Test Runners

CLI tools for inspecting and validating the engine. None of these are called by the engine itself — they're consumers.

| Script                    | npm command                | Purpose                                                                               |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `run-single.ts`           | `npm run single`           | One match, full beat-by-beat log + summaries. `--live` for paced output.              |
| `run-batch.ts`            | `npm run batch`            | N matches, aggregate stats vs. spec target distributions.                             |
| `run-season.ts`           | `npm run season`           | Full home-and-away round-robin across `LEAGUE_TEAMS` (10 teams).                      |
| `run-card.ts`             | `npm run card`             | Print N generated cards. `--position`, `--country`, `--tier` filters.                 |
| `run-squad.ts`            | `npm run squad`            | One generated starter squad with formation fit scores.                                |
| `run-formation-season.ts` | `npm run formation-season` | 30 teams, 4-5 per formation, mixed mentalities. 870-match round-robin.                |
| `run-progression.ts`      | `npm run progression`      | Career-progression smoke test: auto-boost + XP + injuries + legends across N matches. |
| `npm run typecheck`       | —                          | `tsc --noEmit`. The only validation step (no unit tests in this project).             |

---

# Part 5 — Integration Map

Where new features plug in:

| Feature                     | Integration point                                                                                         | Status                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------- |
| Weather modifiers           | `getEffectiveStats()` + zone weights + injury rolls                                                       | ✅ Done (§1.18)             |
| Chemistry / country bonuses | `getEffectiveStats()`                                                                                     | ✅ Done (§1.17)             |
| Position-fit penalty        | `getEffectiveStats()` (e.g. LB in CB slot reads 0.92×)                                                    | ✅ Done (§1.19)             |
| Form (persistent)           | `getEffectiveStats()` + post-match update                                                                 | ✅ Done (§1.20)             |
| Yellow-card safe mode       | `PlayerMatchState.mode` → `getEffectiveStats` + foul probability                                          | ✅ Done (§1.21)             |
| Home advantage              | Initial `momentum: +5` + away-stamina-drain modifier                                                      | ✅ Done (§1.22)             |
| Earned stat boosts          | Additive overlay in `getEffectiveStats` + persistent-stat exceptions                                      | ✅ Done (§3.3)              |
| Hidden stat potentials      | Rolled at card generation, gating auto-boost + XP spend                                                   | ✅ Done (§3.1)              |
| Match-rating auto-boost     | Post-match: `applyAutoBoosts(squad, result, side, rng)`                                                   | ✅ Done (§3.2)              |
| XP economy (earn + spend)   | `awardMatchXp` + extensible `spend(profile, request, ctx)`                                                | ✅ Done (§3.4)              |
| Persistent injuries         | Severity tiers + 2-cap + countdown via `processSquadInjuries`                                             | ✅ Done (§3.5)              |
| Club legends                | `recordLegend` + `computeRoleBuffs` → `MatchInput.{home,away}LegendBuffs` → `PlayerMatchState.legendBuff` | ✅ Done (§1.23, §3.6)       |
| Aging + auto-retirement     | Per-season tick + age-out into `recordLegend`                                                             | Pending (needs season loop) |
| AI mid-season progression   | Reuse `applyAutoBoosts` against AI squads in season post-match step                                       | Pending (needs season loop) |
| DB persistence + multi-user | Supabase + Drizzle + RLS — see `04_persistence-and-career.md`                                             | Pending                     |
| Pause system                | The `// FUTURE: pause-trigger hook` in `runMatch`                                                         | Medium                      |
| AI manager                  | New `decideActions(state)` callback in `runMatch` (lives where `adaptTactics` is now)                     | Medium                      |
| Commentary engine           | Consumer of `BeatResult[]` — separate module, no engine changes                                           | Medium                      |
| Pack shop                   | Pure post-match meta — `Card` generator already exists; future XP-spend variants in `xp-spend.ts`         | Large (UI)                  |
| Top-down pitch UI           | Consumer of `BeatResult[]` — rendering only                                                               | Large                       |
| PvP multiplayer             | Replace `runMatchLive` caller with WebSocket handler that pauses for both clients                         | Medium                      |

**The four engine pillars hold all of this together**:

1. `processBeat(state, rng) → state` — pure-ish, allows yielding for pause/AI/multiplayer.
2. `getEffectiveStats(card, ctx)` — single integration point for stat modifiers.
3. Seeded RNG everywhere — reproducibility for replay, debugging, validation.
4. All magic numbers in `SIM_CONSTANTS` (engine) or `PROGRESSION_CONSTANTS` (career) — tune from one file per concern.

If a future feature looks like it needs to break one of these, that's the signal to stop and re-think — there's almost always a way to plug in cleanly.

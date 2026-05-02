# Progression & Balance — Spec

How players grow, how injuries persist, how AI keeps up. All systems here are post-match additions — the engine itself stays untouched. Constants live in `src/consts/career.ts` (`PROGRESSION_CONSTANTS`) so everything is tuneable from one place, mirroring `SIM_CONSTANTS`.

**Status**: §1–§5, §7, §9 are **built** in `src/career/` and verified end-to-end via `npm run progression`. §6 (aging + auto-retirement) and §8 (AI parity wiring into a season loop) are still designed-only — they need the season-rollover loop, which lives behind the still-pending DB layer in `04_persistence-and-career.md`.

Read order:

- `04_persistence-and-career.md` — DB schema + career loop
- `05_features-roadmap.md` — bullet inventory
- _this doc_ — progression mechanics

---

## 1. Two parallel growth tracks

Every card has two ways to gain stats:

1. **Auto-boost** — earned by the card itself when it plays well. System-chosen stat. Magnitude always +1.
2. **Manual XP spend** — user picks a card + a stat, pays XP from the **profile-level** balance. Magnitude always +1 per spend.

XP is **never** stored on a card. Cards never "have XP". A card's progression history is captured only by `card.boost_count` (how many +1s it's received total) and `card.stat_boosts` (where those +1s went).

Both tracks respect the same per-stat hidden potential cap.

---

## 2. XP economy (profile-level)

### Earn — static values per match event

| Event                                    | XP        |
| ---------------------------------------- | --------- |
| Match appearance (your team played)      | +50       |
| Rating ≥ 6.0 (any of your players)       | +10 each  |
| Rating ≥ 7.0                             | +20 each  |
| Rating ≥ 8.0                             | +40 each  |
| Rating ≥ 9.0                             | +80 each  |
| Rating = 10.0 (perfect game)             | +160 each |
| Goal scored (any of your players)        | +30 each  |
| Assist (any of your players)             | +20 each  |
| Clean sheet (per GK + defender on pitch) | +25 each  |
| Win                                      | +50       |
| Draw                                     | +20       |
| Per goal conceded                        | −50       |
| Per yellow card                          | −20       |
| Per red card                             | −100      |
| Per foul committed                       | 0         |

Match total floors at **0** — a disastrous match earns nothing, never negative XP.

All values live in `PROGRESSION_CONSTANTS.xpRewards` and `PROGRESSION_CONSTANTS.xpPenalties`.

### Spend — stat-value-scaled cost

| Current stat value | Cost per +1 |
| ------------------ | ----------- |
| 1–60               | 100 XP      |
| 61–75              | 200 XP      |
| 76–85              | 400 XP      |
| 86–93              | 800 XP      |
| 94–99              | 1600 XP     |

Costs from `PROGRESSION_CONSTANTS.upgradeCosts`. The user picks any card on their team and any stat that's below its hidden potential. No position-relevance restriction on manual spend — but position-band ceilings (§4) make wasteful spends self-limiting.

### Storage

```
profile
  xp_balance int default 0           -- never negative
  total_xp_earned int default 0      -- lifetime, for stats UI

card
  stat_boosts jsonb default '{}'     -- e.g. { "shooting": 3, "pace": 1 }
  boost_count int default 0          -- sum of stat_boosts values, denormalised
  stat_potentials jsonb              -- hidden ceilings, set at generation
```

`Card.stats` (the natural roll) is **never** mutated by progression. `getEffectiveStats` reads `(natural[s] + (stat_boosts[s] ?? 0))` then applies its multiplier chain.

---

## 3. Auto-boost (card-level)

After every match, walk every card on the user's team that played. For each:

```
if rating < 7.0: skip
if all position-relevant stats already at potential: skip

baseChance = ratingChance(rating)             // see table
levelDamping = 1 / (1 + boost_count × 0.05)
finalChance = baseChance × levelDamping

if rng.next() < finalChance:
  pick a position-relevant stat below its potential, weighted toward `high`-band stats
  card.stats[s] += 0  (untouched — natural stats are immutable)
  card.stat_boosts[s] = (stat_boosts[s] ?? 0) + 1
  card.boost_count += 1
```

### Rating → base chance

| Rating     | Base chance |
| ---------- | ----------- |
| ≥ 7.0      | 25%         |
| ≥ 8.0      | 55%         |
| ≥ 9.0      | 80%         |
| 10.0 (max) | 100%        |

### Damping curve

`1 / (1 + boost_count × 0.05)`:

| boost_count | Multiplier |
| ----------- | ---------- |
| 0           | 1.00       |
| 5           | 0.80       |
| 10          | 0.67       |
| 20          | 0.50       |
| 50          | 0.29       |

So a fresh card with rating 8.0: 55% × 1.0 = 55% chance. The same card after 20 boosts: 55% × 0.5 = 27.5%. Magnitude stays +1; rate slows.

### Stat eligibility

Position-relevant = stats marked `high` or `mid` in `consts/card.ts:POSITION_PROFILE`. A CB's eligible auto-boost pool is `defending`, `physicality`, `positioning` (high), plus `pace`, `passing`, `stamina` (mid). Their `shooting` and `dribbling` are `low` — never auto-boosted. (Manual XP spend can still target them, but the potential ceiling is brutal — see §4.)

### Stat selection within eligibility

Weighted random: `high`-band stats weighted ×2, `mid`-band stats ×1. Slight bias toward identity-defining stats.

### One boost max per match per card

A single match never grants more than +1 to any card. Even rating 10.0 = 1 stat point.

---

## 4. Hidden stat potentials

Rolled once at card generation. Stored in `card.stat_potentials` jsonb. Hidden from the UI — user discovers them empirically when a stat stops growing.

### Potential roll formula

For each of the 8 stats, based on its position-band:

| Band   | Headroom over current | Hard ceiling |
| ------ | --------------------- | ------------ |
| `high` | rng(20..40)           | 99           |
| `mid`  | rng(15..30)           | 88           |
| `low`  | rng(5..18)            | 75           |

So a striker (shooting `high`, defending `low`) might roll:

- shooting potential: 99 (current 80 + 30, capped at 99)
- defending potential: 35 (current 25 + 10, hard-ceilinged at 75)

Even with infinite XP, that ST will never have 76+ defending. Position identity preserved while still leaving room for meaningful growth — a 60-overall card has a realistic shot at reaching 80 overall through XP + auto-boost.

### Application

Both auto-boost (§3) and manual spend (§2) check `current + 1 ≤ potential` before applying. If at potential, that stat is locked.

### Age scaling at generation

Headroom is multiplied by an age factor when a card is created. Younger players (closer to `generationAgeMin`) get the full band headroom; older players (closer to `retirementAge`) get progressively less. Linear taper: factor = `max(ageHeadroomFloor, (retirementAge - age) / (retirementAge - generationAgeMin))`.

The floor (`ageHeadroomFloor: 0.5`) keeps every card with at least half the band headroom available — so even an older player can still develop, just not as fast as a wonderkid. Without the floor, a 35yo would get only ~0.23× headroom and progression would be effectively impossible for them.

Concretely under the bumped bands: an 18yo with 60-overall stats averages 78 potential overall (with ~17% chance of crossing 80); a 25yo 60-overall averages 75; a 30yo 60-overall averages 71. The wonderkid path is the easiest route to 80+ overall but mid-career growth is still meaningful.

### Frozen at creation

`statPotentials` is set once when the card is generated and **never mutated** by the season-rollover loop. Aging-up (`card.age++` per season) does not shrink the ceiling. Potential represents the player's innate ceiling; whether they reach it depends on how much XP and how many minutes they get before retirement.

### Tuning

All constants in `PROGRESSION_CONSTANTS.potentialBands`. Tweak ranges to make mid-band stats more or less ceiling-friendly. Age curve can be shifted by changing `retirementAge` / `generationAgeMin` (in the same constants object).

---

## 5. Injuries

### Severity + duration

| Severity | Games out           | Match-level frequency |
| -------- | ------------------- | --------------------- |
| Knock    | 0 (this match only) | Common                |
| Light    | 1                   | Common                |
| Medium   | 2–3 (rolled)        | Uncommon              |
| Heavy    | 4–5 (rolled)        | Rare                  |

Tuneable in `PROGRESSION_CONSTANTS.injuryDurations` and `injurySeverityWeights`.

### Roll location

Engine already produces injury booleans in `BeatResult.foulDetail.injury` and via `rollPassiveInjury`. Severity rolling is a **post-match** step — engine flags "injured", the career layer rolls severity from the weights table.

### 2-injury team cap

Before persisting a new injury, count active injuries on that team (`card.status = 'injured'`). If already 2, the new injury **downgrades to a knock** — player still flagged off-pitch for that match, but no carryover.

This applies to both user and AI teams.

### Persistence

```
card
  status enum('active','injured','retired') default 'active'
  injury_severity enum('knock','light','medium','heavy') null
  injury_returns_after_match int null   -- gameweek number
```

After each match:

- Decrement injury counters across all cards (`injury_returns_after_match -= 1` if status='injured')
- When counter hits 0, flip status back to 'active', clear severity + counter

### Lineup enforcement

Before a fixture starts, the career layer checks the user's `team_lineup` for any injured cards. If found, swap them out with the user's bench picks (or auto-pick highest-rated bench player at the same position) and warn the user.

### XP healing

User can spend profile XP to clear an injury early.

| Severity | Heal cost                |
| -------- | ------------------------ |
| Knock    | n/a (resolves naturally) |
| Light    | 100 XP                   |
| Medium   | 400 XP                   |
| Heavy    | 1200 XP                  |

Heal sets `status = 'active'`, clears severity + counter. Costs in `PROGRESSION_CONSTANTS.healCosts`.

---

## 6. Aging & retirement

### Per-season tick

End-of-season job (already specced in `04_persistence-and-career.md`) increments `card.age` by 1 for every active card. Applies to both user and AI cards.

### Retirement threshold

`card.age >= PROGRESSION_CONSTANTS.retirementAge` (default 40) at season end → `card.status = 'retired'`. Card stays in DB so old replays still resolve names.

Card generation caps the starting age at `PROGRESSION_CONSTANTS.generationAgeMax` (default 35) so every fresh card gets at least 5 playable seasons before age-out. The card generator pulls from `[generationAgeMin (18), generationAgeMax (35)]`; the team generator pulls from `[teamGenerationAgeMin (22), generationAgeMax (35)]` since league pros skew older than academy pulls.

For the user's team, a retired card frees up its slot — replaced via youth academy / transfers (future), or temporarily empty (the engine handles short squads via auto-sub fallback to any outfielder).

For AI teams: replaced immediately by a procedurally-generated young card (age 18–22) at the same position, calibrated to the league's `LEAGUE_BASE_AVG`.

---

## 7. Club legends

Triggered when a user's card retires. Persisted on the profile (or a `legend` table), not on the card.

### Buff shape

Per role group (GK / DEF / MID / ATT, derived from position):

| # of legends in role | Buff added |
| -------------------- | ---------- |
| 1st                  | +5%        |
| 2nd                  | +3%        |
| 3rd                  | +2%        |
| 4th+                 | +1% each   |

Stacks within a role group. Permanent.

### Engine application

Plugs into `getEffectiveStats` as the final multiplier in the chain:

```
(natural + boosts)
  × fatigue
  × chemistry
  × weather
  × form
  × position_fit
  × legend_buff       // new — derived per role at match init
```

`legend_buff` is precomputed per starter at match start (similar to chemistry) from the user profile's accumulated legends. Stored on `PlayerMatchState.legendBuff`. Subs use a value computed against the same role group.

### AI scope

**AI teams do not track legends.** Their effective stats skip the legend multiplier (treated as 1.0). Keeps it as a meta-progression carrot for the human player.

### Storage

```
legend
  id, profile_id, retired_card_id,
  role enum('GK','DEF','MID','ATT'),
  retired_in_season,
  buff_pct numeric                   -- precomputed at retirement based on stack position
```

---

## 8. AI parity matrix

Which progression systems run for AI teams:

| System                  | User teams   | AI teams                   |
| ----------------------- | ------------ | -------------------------- |
| Auto-boost (§3)         | ✅           | ✅                         |
| XP earn                 | ✅ (profile) | ❌ (no profile)            |
| Manual XP spend         | ✅           | ❌                         |
| Auto-spend at threshold | ❌           | ✅ — see below             |
| Hidden potentials       | ✅           | ✅                         |
| Injuries                | ✅           | ✅                         |
| XP healing              | ✅           | ❌ — natural recovery only |
| Aging + retirement      | ✅           | ✅                         |
| Club legends            | ✅           | ❌                         |

### AI auto-spend

Since AI doesn't have a profile XP pool, it skips manual spend entirely. AI cards progress purely through §3 auto-boost. Mid-season they get harder because their good performances trigger boosts on the same odds as the user's cards.

This means a strong AI team in League 1 (high ratings most weeks) develops faster than a weak AI team (low ratings). Realistic and self-balancing.

---

## 9. Constants summary

All in `src/consts/career.ts`:

```ts
export const PROGRESSION_CONSTANTS = {
  xpRewards: {
    appearance: 50,
    rating60: 10,
    rating70: 20,
    rating80: 40,
    rating90: 80,
    rating100: 160,
    goal: 30,
    assist: 20,
    cleanSheetPerDefender: 25,
    win: 50,
    draw: 20
  },
  xpPenalties: {
    goalConceded: 50,
    yellow: 20,
    red: 100,
    foul: 0
  },
  upgradeCosts: [
    { upTo: 60, cost: 100 },
    { upTo: 75, cost: 200 },
    { upTo: 85, cost: 400 },
    { upTo: 93, cost: 800 },
    { upTo: 99, cost: 1600 }
  ],
  autoBoost: {
    chance70: 0.25,
    chance80: 0.55,
    chance90: 0.8,
    chance100: 1.0,
    levelDampingPerBoost: 0.05,
    highBandWeight: 2,
    midBandWeight: 1
  },
  potentialBands: {
    high: { headroomMin: 20, headroomMax: 40, ceiling: 99 },
    mid: { headroomMin: 15, headroomMax: 30, ceiling: 88 },
    low: { headroomMin: 5, headroomMax: 18, ceiling: 77 }
  },
  ageHeadroomFloor: 0.5,
  injuryDurations: {
    light: { min: 1, max: 1 },
    medium: { min: 2, max: 3 },
    heavy: { min: 4, max: 5 }
  },
  injurySeverityWeights: {
    knock: 0.45,
    light: 0.35,
    medium: 0.15,
    heavy: 0.05
  },
  maxConcurrentInjuriesPerTeam: 2,
  healCosts: { light: 100, medium: 400, heavy: 1200 },
  retirementAge: 40,
  generationAgeMin: 18,
  generationAgeMax: 35, // ≥ 5 seasons before age-out
  teamGenerationAgeMin: 22,
  legendBuffsByStackPos: [0.05, 0.03, 0.02, 0.01] // index 3 used for 4th+
}
```

---

## 10. Schema deltas

Changes to `04_persistence-and-career.md`:

```diff
profile
+ xp_balance int default 0
+ total_xp_earned int default 0

card
- xp                                      (removed — XP is profile-level)
- unspent_points                          (removed — same)
+ stat_boosts jsonb default '{}'
+ boost_count int default 0
+ stat_potentials jsonb                   -- hidden, set at generation
+ injury_severity enum(...) null
+ injury_returns_after_match int null

+ legend
+   id, profile_id, retired_card_id,
+   role enum('GK','DEF','MID','ATT'),
+   retired_in_season, buff_pct numeric
```

`04_persistence-and-career.md` will be updated in the same PR that introduces these tables. Until then, this doc is the source of truth.

---

## 11. Implementation status

| Step                                                  | Status      | Lives in                                                                                                 |
| ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| Constants                                             | ✅ Built    | `src/consts/career.ts`                                                                                   |
| Hidden potentials at generation                       | ✅ Built    | `generators/card-stats.ts:generateStatPotentials`, wired into `card-generator.ts` + `squad-generator.ts` |
| Auto-boost (rating-driven, position-relevant, damped) | ✅ Built    | `src/career/auto-boost.ts:applyAutoBoosts`                                                               |
| Earned-stat overlay in `getEffectiveStats`            | ✅ Built    | `engine/stats.ts`                                                                                        |
| Legend-buff multiplier in `getEffectiveStats`         | ✅ Built    | `engine/stats.ts` + `engine/match.ts:initPlayers` (per-role precompute)                                  |
| XP earn (per-match breakdown)                         | ✅ Built    | `src/career/xp.ts:computeMatchXp` / `awardMatchXp`                                                       |
| XP spend (extensible dispatcher)                      | ✅ Built    | `src/career/xp-spend.ts:spend`                                                                           |
| `stat_upgrade` purchase variant                       | ✅ Built    | `xp-spend.ts`                                                                                            |
| `heal_injury` purchase variant                        | ✅ Built    | `xp-spend.ts`                                                                                            |
| Injury severity rolling + 2-cap                       | ✅ Built    | `src/career/injuries.ts:processSquadInjuries`                                                            |
| Legend recording + role-buff aggregation              | ✅ Built    | `src/career/legends.ts`                                                                                  |
| Aging + auto-retirement                               | 🟡 Designed | needs season-loop (DB)                                                                                   |
| AI auto-progression hook in season loop               | 🟡 Designed | code reusable as-is, needs loop                                                                          |
| Smoke test runner                                     | ✅ Built    | `npm run progression` (`src/test/run-progression.ts`)                                                    |

Future purchase kinds (training, scouting, stadium upgrades) are a one-variant + one-handler addition to `xp-spend.ts` — see the file header comment.

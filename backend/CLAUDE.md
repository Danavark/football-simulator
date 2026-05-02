# Football Card Game — Simulation Engine

CLI-only TypeScript simulation testbed for a card-based football game. No UI, no DB, no server. Two squads of 15 (11 starters + 4 subs) play a simulated match; engine outputs a structured `MatchResult` JSON object.

This repo is the foundation for the full game. UI, pause system, AI manager, weather, chemistry, commentary, multiplayer all come later — architecture below is shaped to slot them in without rewrites.

## Run it

```bash
npm run single                         # single match, random seed
npx ts-node src/test/run-single.ts --seed 12345
npx ts-node src/test/run-single.ts --live --speed 2500   # paced live mode
npm run batch                          # 1000-match aggregate stats
npm run season                         # season run
npm run card -- --count 5              # generate N random cards
npm run squad -- --seed 42             # generate a 15-card starter squad
npm run progression -- --matches 10    # career-progression smoke test
npm run typecheck                      # tsc --noEmit (no tests in this repo)
```

Tweak any probability constant in `src/consts/engine.ts` and re-run.

## Architecture — non-negotiable

Four rules. Breaking any of them costs a future feature.

1. **`processBeat(state, rng) → state`** is the heart of the loop. Pure-ish: state in, state out, no globals, no closures over mutable data. The pause/AI/multiplayer systems will sit between `processBeat` calls in `runMatch` / `runMatchLive`. Do **not** collapse the loop into a single start-to-finish pass.
2. **All stat reads go through `getEffectiveStats(card, ctx)`** in `src/engine/stats.ts`. Reads compose as `(natural + earned boost) × fatigue × chemistry × form × position-fit × legend × weather × mode`. Nothing else may read raw `card.stats` for in-match decisions. The two documented exceptions (stamina drain in `mechanics/stamina.ts`, injury frailty in `resolution/fouls.ts`) read `(natural + earned boost)` so persistent character growth still counts but match-time multipliers don't.
3. **All randomness goes through the seeded RNG** (`src/lib/rng.ts`, mulberry32). No `Math.random()` anywhere in the engine — same seed must reproduce the same match.
4. **All magic numbers live in one of three consts files**: `SIM_CONSTANTS` (`src/consts/engine.ts`) for engine tuning, `PROGRESSION_CONSTANTS` (`src/consts/career.ts`) for career/progression tuning, `CARD_CONSTANTS` (`src/consts/card.ts`) for card-generation tuning (band ranges, tier bonus, stat floors). If you're tempted to inline a probability, threshold, cost, or duration, put it in the relevant constants file instead.

## Match shape

- 7 supported formations: **4-3-3**, **4-4-2**, **4-2-3-1** (4-back); **5-3-2**, **5-4-1** (5-back); **3-5-2**, **3-4-3** (3-back). All wired through `FORMATION_SLOTS` / `ATTACKER_SLOTS` / `DEFENDER_SLOTS` / `FORMATION_ZONE_BIAS` in `constants.ts`. Adding another formation = extending those four tables.
- 45 regular beats (2 in-game minutes each = 90 mins) + 1–4 stoppage beats.
- **Auto-sub on injury** — the engine swaps in the best-affinity bench card via `mechanics/subs.ts` (red-carded players are NOT replaced; team plays a man down).
- **Mid-match tactical adaptation** — `mechanics/tactics.ts` re-evaluates each team's mentality every beat after minute 60 (2-goal swing) or 75 (1-goal swing). Leading teams shift defensive, trailing teams attacking.
- **Lineup + tactics cloned at match start** — `initializeMatchState` shallow-copies the input squads' `lineup` arrays and `tactics` so per-match auto-subs and adaptation don't leak into the caller's objects (important for season runners that reuse the same Squad across many matches).
- **Weather** — rolled pre-match (clear 65% / rain 20% / wind 10% / snow 5%). Stored on `MatchConfig.weather` and exposed on `MatchResult.weather`. Affects stat reads via `WEATHER_MODS[w].stats`, injury rolls via `injuryBonus`, and zone selection via `zoneBias`.
- **Chemistry** — per-player count of same-country starters, computed once in `initializeMatchState` and stored on `PlayerMatchState.chemistry`. Each teammate adds `CHEMISTRY_BONUS_PER_TEAMMATE` (0.5%) to all that player's stat reads, capped at 10 teammates → +5%. Subs use a chemistry value computed against the starting 11 (no recompute on sub).
- **Position fit** — pre-computed per-card multiplier (1.0 / 0.96 / 0.92 / 0.88 / 0.7) based on the affinity distance between the card's natural position and the slot's expected position. Stored on `PlayerMatchState.positionFit`; refreshed by `tryAutoSub` when a bench player comes on. Wide positions (LB/RB, LM/RM, LW/RW) cross-list each other in `POSITION_AFFINITY` so a wrong-foot wide player still reads at 0.88× rather than the unrelated 0.7×.
- **Form** — persistent multiplier on `Card.form` (defaults to 1.0). Read by `getEffectiveStats`. Updated post-match by `mechanics/form.ts:applyFormUpdates(homeSquad, awaySquad, result)`, which the engine _never_ calls itself — callers opt-in for between-match persistence. Clamped to `[FORM_MIN, FORM_MAX]` = `[0.85, 1.15]`.
- **Yellow-card safe mode** — yellowed defenders flip `PlayerMatchState.mode = "safe"`, dropping their effective defending by `MODE_SAFE_DEFENDING_MULTIPLIER` (0.92). Combined with the existing `pickWeightedDefender` exclusion, this measurably reduced repeat-foul red cards (1/7.8 → 1/10.2 in batch).
- **Home advantage** — initial momentum starts at `HOME_ADVANTAGE_MOMENTUM` (5) instead of 0, plus away-team fitness drains `AWAY_STAMINA_DRAIN_MULTIPLIER` (1.05×) faster. Visible in batch as ~2.4 percentage-point home-win edge.
- **Fitness** (was: per-match stamina) — season-persistent gauge. Account state lives outside the engine; caller passes the per-card snapshot in via `MatchInput.fitness?.{home,away}: Record<cardId, number>` (defaults to 100 when missing). Engine drains it per beat using the card's `stamina` stat (higher = slower drain), then reports the post-match value on `PlayerSummary.startFitness` / `endFitness`. Recovery between matches lives in `career/fitness.ts:applyRecovery` — caller opts in. Half-time at beat ~22 (minute 45) — on-pitch players get +10% fitness back; +3 boost on a goal for the scoring side.
- **Pause / decision system** — `runMatchPausable(input)` is an `async function*` that yields `PauseCheckpoint`s when `MatchInput.shouldPause(state, ev)` returns a non-null `PauseReason`. Caller iterates with `await gen.next(decisions)`; engine applies decisions via `engine/decisions.ts:applyDecisions` (subs / mentality / formation+lineup) and resumes. Determinism: `MatchState.rngState` is snapshotted after every beat so a yielded checkpoint is enough to resume across a network round-trip / save game. The default predicate `commonPauseTriggers({ userSide })` fires on half-time, own-side red cards, own-side injuries, and either-side goals — compose with a user-pause flag for "pause now" buttons. AI uses `adaptTactics` (no pause-time decisions for v1).
- Each beat: pick attacking side → pick zone → build matchup → score it → resolve outcome (nothing / buildup / chance / foul) → run goal-resolution if chance → run foul/card/injury rolls → maybe corner → update stamina, momentum, ratings, log event.
- Goal resolution is three stages: chance quality (clear-cut vs half) → shot accuracy → GK save.
- GKs have **no dedicated stat** — saving uses defending + positioning + physicality.

## Code map

```
src/
  types/                  domain types, split by concern; index.ts is a barrel re-export
    card.ts               Position, Stats, Card
    squad.ts              Formation, Mentality, LineupSlot, Squad, Tactics
    match.ts              MatchInput, MatchState, BeatResult, MatchResult, PlayerMatchState, …
    career.ts             RoleGroup, RoleBuffs, Legend, Profile
    index.ts              re-exports everything from the four siblings
  consts/
    engine.ts             SIM_CONSTANTS + formation slot tables + zone weights
    career.ts             PROGRESSION_CONSTANTS + ROLE_BY_POSITION
    card.ts               CARD_CONSTANTS (band ranges, tier bonus, stat floors) + POSITION_PROFILE
  lib/
    rng.ts                mulberry32 seeded PRNG — used by engine, generators, career
  engine/
    match.ts              runMatch / runMatchLive / runMatchPausable — public entry, beat loop, finalise
    beat.ts               processBeat — 8-step beat resolver
    stats.ts              getEffectiveStats, weightedScore, sigmoid
    zones.ts              pickZone, buildMatchup, scoreMatchup
    triggers.ts           commonPauseTriggers — default predicate for runMatchPausable
    decisions.ts          applyDecisions, suggestLineup — handle pause-time user decisions
    mechanics/            possession, momentum, stamina, ratings, subs, tactics, form
    resolution/           goals (3-stage), fouls (foul/card/injury), setPieces
  generators/             card / squad / team factories — production code
    card-stats.ts         stat-rolling logic (rollStat, generateStats, generateStatPotentials)
    card-names.ts         CARD_NAMES — country → first/last name pools
    card-generator.ts     generateCard(rng, opts?) — single random card
    squad-generator.ts    generateSquad() — pack-pull (auto-detect) OR procedural (fixed formation) modes
  career/                 post-match progression (auto-boost, XP, injuries, legends, fitness)
    auto-boost.ts         applyAutoBoosts (rating-driven stat bumps), statAtPotential
    xp.ts                 computeMatchXp / awardMatchXp — profile-level XP economy
    xp-spend.ts           extensible spend(profile, request, ctx) — stat_upgrade + heal_injury
    injuries.ts           rollSeverity, processSquadInjuries, isUnavailable
    legends.ts            recordLegend, computeRoleBuffs (retired-card → role buff)
    fitness.ts            applyRecovery, freshSeasonFitness — between-match fitness top-up
  commentary/             render layer over BeatResult — prose for CLI / future UI
    commentator.ts        createCommentator (stateful; tracks score, recent lines, sendings-off)
    lines.ts              base prose pools (15 each: nothing/buildup/chance/goal/save/off-target/foul)
    modifiers.ts          time × scoreline prefix sentences + down-to-ten flavour
    special.ts            kickoff / half-time / full-time / stoppage / late-goal / comeback / red-card prose
    zone-phrase.ts        Zone → natural-language fragments ("down the left", "long ball")
  test/
    fixtures/             procgen squads built once at import time, consumed by CLI runners
      test-teams.ts       testHome / testAway — used by run-single, run-batch, run-progression
      user-team.ts        userSquad / userTactics — pack-pull starter (Avark FC)
      league-teams.ts     LEAGUE_TEAMS — user team + 19 AI teams (20 total) for run-season
    run-single.ts         CLI: one match, formatted log + summaries
    run-batch.ts          CLI: N matches, aggregate stats vs. spec targets
    run-season.ts         CLI: full season run
    run-card.ts           CLI: print N generated cards
    run-squad.ts          CLI: print one generated starter squad + formation fit scores
    run-formation-season.ts  CLI: 10-team round-robin, one team per formation
    run-progression.ts    CLI: career-progression smoke test (auto-boost + XP + legends)
docs/
  01_project-brief.md     product brief — read this first
  02_simulation-testbed-spec.md  full v1 spec with formulas + targets
  03_systems.md           per-system reference — what's actually built, integration points
  04_persistence-and-career.md   DB / multi-user / career-mode plan (not built yet)
  05_features-roadmap.md  bullet inventory: built / designed / future
  06_progression-and-balance.md  progression spec — XP, auto-boost, injuries, legends
  nextjs-frontend.md      future HTTP/SSE wiring guide (not built yet)
```

Path alias `@/*` → `src/*` (configured in `tsconfig.json`, registered via `tsconfig-paths`).

## Tuning targets (batch validation)

`run-batch` should land in these bands. Drift outside means tweak `SIM_CONSTANTS`, not the engine.

| Metric                 | Target               |
| ---------------------- | -------------------- |
| Goals per match        | 2.5–2.8              |
| Clean sheets           | 20–25%               |
| Higher-rated team wins | 55–65%               |
| Draws                  | 20–28%               |
| Fouls per match        | 20–26                |
| Yellows per match      | 3–5                  |
| Red cards              | ~1 per 8–12 matches  |
| Injuries               | ~1 per 5–8 matches   |
| Penalties              | ~1 per 10–15 matches |
| Corners per match      | 8–12                 |

## Conventions

- TypeScript strict. Use `type`, never `interface`. Don't over-annotate where inference works.
- No unit tests in this repo — validate by reading single-match logs and checking batch distributions against the targets above.
- Future fields (weather, `pauseRequested`, `requiresDecision`) may be present in types/state already — engine ignores them until implemented. Don't strip them.
- When changing types in `src/types/index.ts`, remember the SSE contract in `docs/nextjs-frontend.md` — frontend will need the same shapes.

# Football Card Game — Simulation Testbed

CLI-only TypeScript simulation engine. No UI, no DB, no server.

## Install

```bash
npm install
```

## Run a single match

```bash
npx ts-node src/test/run-single.ts --seed 12345
```

Prints a phase-by-phase event log, then final score and player summaries.

### Live mode

Watch the match unfold over time, one phase at a time. A match has 45
regular phases (each = 2 in-game minutes) plus 1–4 stoppage phases.

```bash
npx ts-node src/test/run-single.ts --live              # ~5 min match (default 5000ms/phase)
npx ts-node src/test/run-single.ts --live --speed 2500 # faster (~2 min match)
npx ts-node src/test/run-single.ts --live --seed 12345 # reproducible live match
```

A "HALF TIME" banner is printed at the break with a longer pause.
Ctrl-C to abort.

## Run a batch

```bash
npx ts-node src/test/run-batch.ts --count 1000
```

Prints aggregate stats compared against the spec's target distributions.

## Tweaking

All probability constants are in `src/engine/constants.ts`. Tweak and re-run.

## Code tour

Follow this path to learn the simulation from the outside in:

1. **`src/test/run-single.ts`** — CLI entry point. Parses args, calls `runMatch` or `runMatchLive`, formats the beat-by-beat log + match stats panel + player summaries.
2. **`src/engine/match.ts`** — `runMatch` / `runMatchLive`. Initialises `MatchState`, loops `processBeat` until full time + stoppage, then builds the `MatchResult` (per-team totals, summaries).
3. **`src/engine/beat.ts`** — `processBeat(state, rng) → state`. The heart of the simulation. Reads top-to-bottom as 8 numbered steps: possession → zone → outcome → chance resolution → corners → fouls → injury check → ratings/momentum/stamina/event log.

Then drill into the modules `processBeat` calls, in the order it calls them:

4. **`src/engine/mechanics/possession.ts`** — `pickAttackingSide`. Decides which team gets this beat based on midfield quality, momentum and mentality.
5. **`src/engine/zones.ts`** — `pickZone`, `buildMatchup`, `scoreMatchup`. Picks the zone, pulls the right players from each lineup, and scores the attacker-vs-defender duel.
6. **`src/engine/stats.ts`** — `getEffectiveStats`, `weightedScore`, `sigmoid`. The single integration point for every stat read; v1 only applies fatigue but it's the future home for chemistry/weather/form modifiers.
7. **`src/engine/resolution/goals.ts`** — `resolveChance`. Three-stage goal resolution: chance quality → shot accuracy → GK save.
8. **`src/engine/resolution/fouls.ts`** — `foulProbability`, `resolveFoul`, `rollFoulInjury`, `rollPassiveInjury`. Foul / card / injury rolls.
9. **`src/engine/resolution/setPieces.ts`** — `classifySetPiece`, `resolveSetPiece`. Free kicks, penalties, corners.
10. **`src/engine/mechanics/stamina.ts`** — `applyBeatStaminaDrain`. Per-beat fatigue bookkeeping.
11. **`src/engine/mechanics/momentum.ts`** — `adjustMomentumForHome`, `decayMomentum`. Tiny module; momentum biases possession + chance quality.
12. **`src/engine/mechanics/ratings.ts`** — `adjustRating`. One-line rating clamp helper.

Supporting files you can read any time:

- **`src/types/index.ts`** — all type definitions (`Card`, `MatchState`, `BeatResult`, `MatchResult`, etc.).
- **`src/engine/constants.ts`** — `SIM_CONSTANTS` plus formation/zone slot tables. Every magic number lives here.
- **`src/lib/rng.ts`** — mulberry32 seeded PRNG. All randomness in the engine flows through this.
- **`src/data/sample-cards.ts`** — the two test squads (Northern United vs. Real Andalucia).
- **`src/test/run-batch.ts`** — runs N matches and prints aggregate distribution stats vs. spec targets.

# Features Roadmap

Bullet-list inventory of every system in the project — built, designed, and future. Short by intent. For depth, follow the cross-references to the other docs.

Status legend:

- **B** — Built (in `src/` today)
- **D** — Designed (specced in another doc, not yet built)
- **F** — Future (idea-stage, no spec yet)

---

## Match engine

- **B** 45-beat phase loop, each beat = 2 in-game minutes
- **B** Seeded RNG (mulberry32) — reproducible matches
- **B** 7 formations: 4-3-3, 4-4-2, 4-2-3-1, 5-3-2, 5-4-1, 3-5-2, 3-4-3
- **B** 3 tactical mentalities: defensive / balanced / attacking
- **B** 5 attack zones: left wing / right wing / centre / long ball / counter
- **B** 3-stage goal resolution: chance quality → shot accuracy → GK save
- **B** Foul system with referee strictness (lenient / normal / strict)
- **B** Cards: yellow, red, second-yellow auto-conversion
- **B** Set pieces: free kicks, penalties, corners (foul-derived + open-play)
- **B** Stamina drain + half-time recovery + goal-scorer adrenaline boost
- **B** Match momentum (−20 to +20) with per-beat decay
- **B** Per-player match ratings (1.0–10.0)
- **B** Auto-substitution on injury (position-affinity ladder)
- **B** Red-carded teams play a man down (no replacement)
- **B** Mid-match tactical adaptation (chase / hold leads after minute 60/75)
- **B** Home advantage (initial momentum + away-team stamina drain penalty)
- **F** Pause system (yield mid-match for user decisions)
- **F** AI manager hook (decision callback for AI teams)
- **F** Commentary engine (consumes `BeatResult[]`, separate module)

## Cards & squads

- **B** 8-stat block: pace, shooting, passing, dribbling, defending, physicality, positioning, stamina
- **B** 12 positions (GK + 11 outfield)
- **B** Country tagging (12 countries, ~144 unique names each)
- **B** Random card generator with position / country / tier filters
- **B** Starter squad generator (15-card pack + best-fit formation detection)
- **B** Procedural team generator (single-nationality, formation-specific)
- **B** Hidden stat potentials (per-stat ceilings rolled at generation)

## Stat-modifier pipeline (`getEffectiveStats`)

- **B** Fatigue multiplier
- **B** Chemistry (same-country teammate bonus)
- **B** Weather (clear / rain / snow / wind — stats, injury rate, zone bias)
- **B** Position fit (out-of-position penalty)
- **B** Form (persistent post-match multiplier, caller-driven)
- **B** Yellow-card safe mode (defending stat penalty after first yellow)
- **B** Earned stat boosts (additive overlay from auto-boost + XP spend)
- **B** Club legend buffs (retired-player → role-group multiplier)

## CLI test runners

- **B** Single-match log (with optional live-paced mode)
- **B** 1000-match batch validator vs spec target distributions
- **B** 10-team round-robin season
- **B** 30-team formation comparison season
- **B** Card generator preview
- **B** Squad generator preview

## Persistence & multi-user

- **D** Supabase Postgres database
- **D** Supabase Auth (no custom auth layer)
- **D** Row-Level Security per user
- **D** Per-user isolated career universe (no shared world in v1)
- **D** Career save (persistent across seasons)
- **F** PvP multiplayer (cross-universe friendlies between users)
- **F** Multi-team per user (manage multiple clubs)

## League & season structure

- **D** League pyramid with tiered difficulty
- **D** 20 teams per league, 38-game season (home + away)
- **D** Promotion / relegation (top 3 up / bottom 3 down)
- **D** Lazy league spawn (new tier generated only when user promotes out the top)
- **D** Persistent fixture list per season (seeds + weather rolled at season start)
- **D** League table (derived from match results)
- **D** Top scorers (derived from `match_player` aggregates)

## AI opponents

- **D** Strength calibration anchored to `LEAGUE_BASE_AVG[tier]` ± spread
- **D** Tweakable spread constant in `CAREER_CONSTANTS`
- **D** AI mid-season progression (`applyAutoBoosts` already works for AI squads — needs wiring into the AI post-match step once that exists)
- **D** AI lineup regeneration each match (via existing `assignLineup`)

## Player progression

- **B** Match-rating auto stat boosts (≥7.0 chance, damped by `boost_count`, position-relevant high/mid-band stats only) — `src/career/auto-boost.ts`
- **B** XP earned per match (base + rating tiers + goals + assists + clean sheet + result, minus concede + yellows + reds + fouls, floor 0) — `src/career/xp.ts`
- **B** Profile-level XP balance (account-scope, not per-card) — `Profile.xpBalance`
- **B** Tiered XP cost to upgrade a stat (50→60: 100 XP, 95→99: 1600 XP) — `PROGRESSION_CONSTANTS.upgradeCosts`
- **B** Manual stat-point spend with potential validation — `xp-spend.ts:stat_upgrade`
- **B** Extensible XP-spend dispatcher (discriminated union, ready for new purchase kinds) — `src/career/xp-spend.ts`
- **B** Position-band caps prevent absurd builds (CB shooting capped at ~65)

## Injuries & medical

- **B** Severity tiers: knock (0), light (1), medium (2–3), heavy (4–5) — `PROGRESSION_CONSTANTS.injuryDurations`
- **B** Persistent across matches via `card.injuryStatus` + `injuryReturnsAfterMatch` countdown
- **B** Max 2 simultaneous injuries per team (3rd+ downgrades to knock) — `src/career/injuries.ts`
- **B** XP-spent healing, cost scales with severity — `xp-spend.ts:heal_injury`
- **F** Recovery training events (between-match scenarios)

## Career & legacy

- **D** Player aging (+1 per season — needs the season-rollover loop)
- **D** Auto-retirement at age threshold (`PROGRESSION_CONSTANTS.retirementAge` is set; trigger pending)
- **B** Club legends (`recordLegend` + `computeRoleBuffs` → permanent role-group buff, diminishing returns when stacked) — `src/career/legends.ts`
- **F** Player history page (career stats per card)
- **F** Hall of fame across seasons

## Match replay

- **D** User-fixture replays stored as `BeatResult[]` JSON (AI vs AI not stored)
- **F** Replay scrubber UI (pause / rewind / speed control)
- **F** Highlight extraction (auto-clip goals + key moments)

## Frontend & transport

- **D** HTTP server (`/api/match`, `/api/match/stream`) — see `nextjs-frontend.md`
- **D** Server-Sent Events for live match streaming
- **D** Next.js client app (separate repo)
- **D** Pre-match tactics + lineup picker (user team only)
- **F** Top-down pitch UI rendering `BeatResult[]` as live animation
- **F** Mid-match interactive pause + decision UI

## Power-ups & shop

- **F** Pack shop (buy randomised card packs)
- **F** Power-up: instant injury heal card
- **F** Power-up: single-match boost for one player
- **F** Power-up: single-match boost for a position group (all attackers, all defenders, etc.)
- **F** Currency system (earned + premium tiers)

## Stadium & club infrastructure

- **F** Stadium upgrades increase team's starting momentum
- **F** Training-ground upgrades affect XP earn rate
- **F** Medical-centre upgrades affect injury recovery speed
- **F** Youth academy generates new cards over time

## Transfers

- **F** Transfer market (cards move between teams for a fee)
- **F** End-of-season free agency
- **F** AI-driven transfer activity
- **F** Schema reserved (`card_transfer` table planned in `04_persistence-and-career.md`)

---

## Cross-doc references

| Topic | Doc |
|---|---|
| What's actually built today, with file:line refs | `03_systems.md` |
| Engine v1 spec + targets | `02_simulation-testbed-spec.md` |
| Product brief | `01_project-brief.md` |
| Database schema + career mode | `04_persistence-and-career.md` |
| HTTP/SSE wiring | `nextjs-frontend.md` |

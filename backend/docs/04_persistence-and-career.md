# Persistence & Career Mode — Plan

How the simulation engine becomes a multi-user career game. Adds a database, auth, league pyramid, promotion/relegation, and per-user persistence — without touching the engine.

This doc is a plan, not a built feature. The progression layer it depends on (XP, auto-boost, injuries, legends) **is** built — see `06_progression-and-balance.md` and `src/career/`. The DB / season-loop / auth layer is what's still missing.

Read order:

- `01_project-brief.md` — what the game is
- `02_simulation-testbed-spec.md` — engine v1 spec
- `03_systems.md` — what's actually built (engine + progression)
- `nextjs-frontend.md` — HTTP/SSE wiring (future)
- *this doc* — DB layer + career-mode loop (future)
- `06_progression-and-balance.md` — XP, auto-boost, injuries, legends (built; see `src/career/`)

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Database | **Supabase** (hosted Postgres) | Multi-user from day one, room for PvP |
| Auth | **Supabase Auth** | Free signup/login/JWT — we're not building it |
| Authorisation | **Postgres RLS** | One-line policies; engine never thinks about user IDs |
| ORM | **Drizzle** | TS-first, no codegen step, plays well with Supabase |
| Migrations | Drizzle Kit + hand-written SQL for RLS | Versioned in repo |

Local dev: `supabase init` / `supabase start` runs Postgres + Auth + Studio in Docker. The existing CLI tools (`run-single`, `run-batch`, `run-season`) keep working against in-memory `LEAGUE_TEAMS` — they don't touch the DB.

---

## World model — one universe per user

Each authenticated user gets their own isolated pyramid:

- Their team
- Their AI opponents (19 per league, generated lazily)
- Their league pyramid (starts as a single bottom-tier league; grows upward as they promote)
- Their season counter, fixtures, match history, replays

No shared world. RLS on every table is `using (user_id = auth.uid())`, so a user only ever sees their own data.

PvP later = a separate `pvp_match` table that pairs two users' teams in a friendly outside their leagues. Not in v1 schema.

---

## Schema

Tables grouped by concern. All non-public tables carry `user_id` for RLS.

### Identity

```
profile
  user_id PK            references auth.users
  display_name
  current_team_id       references team
  xp_balance int default 0          -- account-level XP, never negative
  total_xp_earned int default 0     -- lifetime, for stats UI
  onboarded_at
```

### Pyramid + season

```
league
  id, user_id, tier int, name
  -- tier 1 = bottom. New tiers spawned lazily on user promotion.

season
  id, user_id, year_number, status, started_at, completed_at

league_season
  id, season_id, league_id, status
  -- one row per (league, season). All fixtures and standings hang off this.
```

### Teams + cards

```
team
  id, user_id, name, country, id_prefix,
  owner enum('user','ai'),
  base_formation, base_mentality,
  current_league_id        references league
  created_in_season
  -- persistent across seasons. current_league_id moves on promo/relegation.

league_season_team
  league_season_id, team_id, final_position int null
  -- 20 rows per league_season. Drives the league table.

card
  id, team_id, name, position, country, age,
  stats jsonb,                       -- the 8-stat block (natural; never mutated)
  stat_boosts jsonb default '{}',    -- earned via auto-boost + XP spend; sum into reads
  stat_potentials jsonb,             -- hidden per-stat ceilings rolled at generation
  boost_count int default 0,         -- denormalised sum of stat_boosts; drives auto-boost damping
  injury_proneness, form,
  status enum('active','injured','retired'),
  injury_severity enum('knock','light','medium','heavy') null,
  injury_returns_after_match int null,
  joined_team_at_season,
  created_at
  -- progression: see 06_progression-and-balance.md

card_transfer
  id, card_id, from_team_id null, to_team_id,
  season_id, fee int null
  -- empty in v1. Schema reserved for transfer market.

legend
  id, profile_id, retired_card_id,
  role enum('GK','DEF','MID','ATT'),
  retired_in_season,
  buff_pct numeric
  -- written when a user's card retires. Drives the legend multiplier in
  -- getEffectiveStats. AI teams don't track legends. See 06_progression-and-balance.md.
```

### Live tactical state

```
team_lineup
  team_id, slot 0-10, card_id
  -- 11 rows per team. User edits persist; applied to next match.
  -- AI teams: regenerated each match via assignLineup() — not persisted.

team_tactics
  team_id PK, formation, mentality
  -- current pre-match selection. Edits persist till next change.
```

### Fixtures + results

```
fixture
  id, league_season_id, gameweek,
  home_team_id, away_team_id,
  seed, weather,
  home_score, away_score,
  played_at null,
  involves_user bool          -- precomputed, drives replay write

match_player
  fixture_id, card_id, side,
  minutes, rating,
  goals, assists, yellows, red_card, injured
  -- written for every fixture. Source for top scorers + form updates.

match_replay
  fixture_id PK,
  beats jsonb,                -- BeatResult[]
  totals jsonb,               -- MatchResult.totals
  team_totals jsonb           -- MatchResult.teamTotals
  -- ONLY written when fixture.involves_user = true.
  -- AI vs AI fixtures: skipped to keep DB lean.
```

### Indexes

- `fixture(league_season_id, gameweek)` — render fixture list / next match lookup
- `card(team_id, status)` — squad page filters
- `match_player(card_id)` — season-long scorer aggregation
- `team(user_id, owner)` — find user's own team fast

---

## What's persisted vs derived

**Persisted** — anything that costs randomness to regenerate or that the user can edit:

- Profiles, leagues, seasons, teams, cards
- Profile XP balance + lifetime XP earned
- Card `stat_boosts`, `boost_count`, `stat_potentials` (hidden), injury status
- Fixture list (seeds + weather rolled at season start so results are reproducible)
- `match_player` rows for every fixture
- User team's lineup + tactics
- Replays for user fixtures only
- Legends earned by the user's profile

**Derived per request** — computed on read from the above:

- League table (sum points/GD/GF over `match_player` joined to `fixture`, scoped to a `league_season`)
- Top scorers (sum `match_player.goals` per card within a season)
- AI lineup for a given match (call existing `assignLineup` against the AI team's current cards)
- Chemistry (engine computes at match init from the persisted lineup's countries — no DB column)
- Form going into a match (read straight from `card.form`)

Keeping aggregates derived means tweaking standing rules or scorer logic doesn't need a backfill.

---

## Promotion / relegation + lazy league spawn

End-of-season job, runs once after the final fixture:

1. **Compute final standings** for each `league_season` from `match_player` + `fixture`. Write `final_position` back to `league_season_team`.
2. **Mark moves** — top 3 promoted, bottom 3 relegated.
3. **Apply** — update `team.current_league_id` for the next season.
4. **Lazy spawn** — if a team is promoted into a tier that doesn't yet exist (only when the user promotes out of the top of their pyramid), create a new `league` row at `tier + 1`, generate 17 fresh AI teams at the appropriate stat tier, slot in the 3 promoted teams.
5. **Backfill** — if a league sends teams up but receives none from below (bottom league, or a tier above which never had a tier above-above-it), generate replacement AI teams for the empty slots.
6. **Roll over** — increment season number, create new `season` + `league_season` rows for every existing league, regenerate fixture lists.

Persistence rules:

- `team` rows are never deleted. Relegated AI teams keep their squad, age, form, history.
- `card.age` ticks +1 per season.
- Cards retire at `PROGRESSION_CONSTANTS.retirementAge` (40). Generation caps at `generationAgeMax` (35) so every card gets ≥ 5 seasons.
- Retired cards stay in the DB (`status = 'retired'`) so old replays still resolve `card_id → name`.

---

## Stat tiers across the pyramid

The engine supports `rookie | semipro | pro | super | legend` tiers in `consts/card.ts:CARD_CONSTANTS.tierBonus`. The pyramid uses these:

| League tier | Default AI team stat tier |
|---|---|
| 1 (bottom) | rookie |
| 2 | rookie / semipro mix |
| 3 | semipro → pro as user climbs |
| 4+ | pro → super → legend at the top |

Specific tier-per-league mapping lives in the new `CAREER_CONSTANTS` so it's tuneable in one place — same convention as `SIM_CONSTANTS`.

---

## Module layout

Engine code (`src/engine/*`) doesn't change. Two new layers:

```
src/db/
  client.ts              postgres client + drizzle init
  schema.ts              drizzle table defs (mirrors the schema above)
  migrations/            drizzle-kit output + hand-written RLS SQL
  repos/
    profile.ts
    team.ts              saveTeam(squad, tactics, …), loadTeam(id) → { squad, tactics }
    season.ts            createSeason, listFixtures, recordResult, computeStandings
    card.ts              age, retire, persistFormUpdate

src/career/
  constants.ts           CAREER_CONSTANTS (retirement age, tier mapping, prize rules…)
  bootstrap.ts           first login: profile + bottom league + 19 AI + user team
                         + season 1 + fixture list
  pre-match.ts           load fixture → load both teams → merge user tactics override
                         → return MatchInput for runMatch
  post-match.ts          write match_player rows, write replay if involves_user,
                         call existing applyFormUpdates, persist new card.form,
                         mark fixture played
  end-of-season.ts       standings → promo/relegation → lazy spawn → next season

src/server/              (per nextjs-frontend.md, extended)
  middleware/auth.ts     verify Supabase JWT, attach user_id to req
  routes/
    profile.ts           POST /profile (onboarding), GET /profile
    team.ts              GET /team/:id, PATCH /team/:id/tactics, PATCH /team/:id/lineup
    season.ts            GET /season/current (table + fixtures), GET /season/scorers
    match.ts             POST /match/:fixtureId/play → SSE stream
    replay.ts            GET /replay/:fixtureId (user fixtures only — RLS enforces)
```

`team.ts` round-trip: a `Squad` saved and reloaded must equal the original (modulo `id` shape). This is the one invariant to test before building anything else on top.

---

## Engine round-trip rules

Mapping the existing types onto rows:

- `Card` ↔ `card` row. `stats` goes into a `jsonb` column verbatim.
- `Squad.cards` — derived from `card WHERE team_id = ? AND status = 'active'`.
- `Squad.lineup` ↔ `team_lineup` rows.
- `Squad.subs` — derived: cards on the team that don't appear in `team_lineup`.
- `Tactics` ↔ `team_tactics`.

`runMatch` / `runMatchLive` signatures don't change. The four engine pillars (`processBeat`, `getEffectiveStats`, seeded RNG, `SIM_CONSTANTS`) stay untouched.

`Card.form` is the engine's only persistent mutation surface, and `mechanics/form.ts:applyFormUpdates` already handles it — `post-match.ts` just calls it and writes the new values back to `card.form`.

---

## Auth + RLS

Supabase Auth issues JWTs on signup/login. The Express server (per `nextjs-frontend.md`) verifies them in middleware, attaches `req.user_id`, and passes it down to the repos.

RLS does the actual gatekeeping. Every user-scoped table gets:

```sql
alter table <table> enable row level security;

create policy "owner read"
  on <table> for select
  using (user_id = auth.uid());

create policy "owner write"
  on <table> for insert with check (user_id = auth.uid());

create policy "owner update"
  on <table> for update using (user_id = auth.uid());
```

Tables without `user_id` directly (e.g. `card`, `match_player`, `team_lineup`) get policies that join through `team` to its `user_id`. Drizzle doesn't manage RLS — these go in hand-written SQL migrations, versioned in `src/db/migrations/`.

---

## Replay strategy

`match_replay.beats` is a `jsonb` column holding `BeatResult[]` straight from `MatchResult.beats`. Re-rendering a replay is a frontend concern: read the array, walk it with the same pacing logic the live SSE stream uses.

Only written when `fixture.involves_user`. AI-vs-AI fixtures: nothing in `match_replay`. This caps replay storage at ~38 rows/season/user, each ~50KB → tiny.

If we ever want frame-perfect replays of AI matches too, the schema is unchanged — just stop gating the write. Or store the seed alone and re-run `runMatch` deterministically (cheaper for storage, costs CPU on read).

---

## Open scope reserved on schema, not built in v1

These have schema room but no logic yet:

- **Transfers** — `card_transfer` row + `card.team_id` move
- **Multi-team users** — `profile.current_team_id` lets a user swap which team they manage; multiple teams per user means relaxing one RLS constraint and adding a UI picker
- **PvP** — separate `pvp_match` table, untouched by RLS-per-universe model

For full mechanics on aging, retirement, injuries, legends, XP, and auto-boost, see `06_progression-and-balance.md`.

---

## Open implementation order (when ready to build)

1. Stand up Supabase locally + add `src/db/{client,schema}.ts` with the tables above.
2. Write RLS migration. Smoke-test with two test users from `psql` — verify cross-user reads return 0 rows.
3. `repos/team.ts` round-trip: take a `generateSquad` output, save it, load it back, run it through `runMatch`. Confirm same `MatchResult` as in-memory baseline given same seed.
4. `career/bootstrap.ts` — onboarding flow. Creates profile + bottom league + 19 AI teams + user team + season 1 + fixtures.
5. `career/pre-match.ts` + `post-match.ts` + the SSE route from `nextjs-frontend.md`. End-to-end: user plays a fixture, table updates, form persists.
6. `career/end-of-season.ts` — standings + promo/relegation + lazy league spawn.
7. Frontend (separate repo) consumes the routes.

Steps 1–3 are the load-bearing ones. If round-trip works and RLS holds, the rest is plumbing.

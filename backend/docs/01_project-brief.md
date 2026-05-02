# Football Card Game — Project Brief

## What This Is

A football (soccer) card game simulation engine built in TypeScript. Players build a squad of 15 fictional player cards, each with unique stats, set a formation and mentality, then watch a simulated match play out. Think Football Manager meets a card game.

## What We're Building Right Now

**Just the simulation engine as a command-line testbed.** No UI, no database, no web server, no interactivity. The goal is a script I can run from the terminal that simulates a match between two squads and outputs a structured JSON log of everything that happened — phases, chances, goals, fouls, injuries, stamina, ratings.

I need to be able to:
- Run a single match and read the full event log
- Run a batch of 1,000+ matches and see aggregate stats (average goals, clean sheet %, foul count, etc.)
- Tweak probability constants in one file and re-run to see how the distributions change
- Use a seed for reproducible results when debugging

## Tech

- TypeScript, Node.js
- No frameworks, no dependencies beyond a test runner if needed
- Everything runs locally from the command line

## Key Design Principles

- **`processPhase(state): state`** — the engine processes one phase at a time and returns updated state. This is critical. Do not build it as a single loop that runs start to finish. I need to be able to insert pause points between phases later without a rewrite.
- **`getEffectiveStats(card, context)`** — all stat reads go through one function. Right now it just applies the fatigue multiplier. Later I'll add weather, chemistry, form, and other modifiers here. Nothing else in the engine should read raw card stats directly.
- **Seeded RNG** — all randomness goes through a single seedable PRNG. No `Math.random()` anywhere.
- **Single constants file** — every tunable number (probabilities, thresholds, drain rates) lives in one constants object so I can tweak the entire simulation from one place.

## Card Model

Each card has 8 stats (1-99): pace, shooting, passing, dribbling, defending, physicality, positioning, stamina. Plus metadata: position, country, age, name, and a hidden injury proneness trait (0.0-1.0).

**Goalkeepers are a special case.** There's no dedicated GK stat — their saving ability comes from their defending, positioning, and physicality stats. When generating sample GK cards, give them high values in those three stats (70-90 range) and low values for shooting, dribbling, and pace (10-30 range). Passing can vary (some GKs are good distributors). Stamina should be moderate (50-70) since GKs don't fatigue much but the system still tracks it.

**Outfield card stat guidelines for generating test data:**

| Position | High Stats (70-90) | Medium Stats (45-70) | Low Stats (20-45) |
|----------|--------------------|-----------------------|--------------------|
| CB | Defending, Physicality, Positioning | Pace, Passing, Stamina | Shooting, Dribbling |
| LB/RB | Pace, Defending, Stamina | Positioning, Physicality, Passing | Shooting, Dribbling |
| CDM | Defending, Positioning, Physicality | Passing, Stamina | Pace, Shooting, Dribbling |
| CM | Passing, Positioning, Stamina | Dribbling, Defending, Physicality | Shooting, Pace |
| CAM | Passing, Dribbling, Positioning | Shooting, Pace | Defending, Physicality, Stamina |
| LW/RW | Pace, Dribbling | Shooting, Passing, Positioning | Defending, Physicality, Stamina |
| ST | Shooting, Positioning | Pace, Dribbling, Physicality | Passing, Defending, Stamina |

These are guidelines, not rules — there should be variety. A pacey CB or a physical winger is fine. The ranges should produce realistic feeling cards, not identical archetypes.

Generate two full squads of 15 (11 starters + 4 subs each) with varied stat profiles. Give them realistic-sounding fictional names from a mix of countries.

## Zone-to-Player Mapping

When a phase resolves, the engine picks a zone and pulls in specific players from each side's lineup based on their formation slot. Here are the exact mappings for the three starting formations.

### 4-3-3 Slots
```
0: GK
1: LB    2: CB    3: CB    4: RB
5: CM    6: CM    7: CM
8: LW    9: ST    10: RW
```

### 4-4-2 Slots
```
0: GK
1: LB    2: CB    3: CB    4: RB
5: LM    6: CM    7: CM    8: RM
9: ST    10: ST
```

### 4-2-3-1 Slots
```
0: GK
1: LB    2: CB    3: CB    4: RB
5: CDM   6: CDM
7: LW    8: CAM   9: RW
10: ST
```

### Zone Matchups (attacking team slots → defending team slots)

**Left Wing Attack:**
| Formation (ATK) | Attackers | Formation (DEF) | Defenders |
|-----------------|-----------|-----------------|-----------|
| 4-3-3 | 8 (LW), 1 (LB), 5 (CM) | 4-3-3 | 4 (RB), 7 (CM) |
| 4-3-3 | 8 (LW), 1 (LB), 5 (CM) | 4-4-2 | 4 (RB), 8 (RM) |
| 4-3-3 | 8 (LW), 1 (LB), 5 (CM) | 4-2-3-1 | 4 (RB), 9 (RW) |
| 4-4-2 | 5 (LM), 1 (LB), 6 (CM) | 4-3-3 | 4 (RB), 7 (CM) |
| 4-4-2 | 5 (LM), 1 (LB), 6 (CM) | 4-4-2 | 4 (RB), 8 (RM) |
| 4-4-2 | 5 (LM), 1 (LB), 6 (CM) | 4-2-3-1 | 4 (RB), 9 (RW) |
| 4-2-3-1 | 7 (LW), 1 (LB), 5 (CDM) | 4-3-3 | 4 (RB), 7 (CM) |
| 4-2-3-1 | 7 (LW), 1 (LB), 5 (CDM) | 4-4-2 | 4 (RB), 8 (RM) |
| 4-2-3-1 | 7 (LW), 1 (LB), 5 (CDM) | 4-2-3-1 | 4 (RB), 9 (RW) |

**Right Wing Attack:**
Mirror of left wing — swap LW↔RW, LB↔RB, LM↔RM.

**Centre Attack:**
| Formation (ATK) | Attackers | Formation (DEF) | Defenders |
|-----------------|-----------|-----------------|-----------|
| 4-3-3 | 9 (ST), 6 (CM), 7 (CM) | 4-3-3 | 2 (CB), 3 (CB), 6 (CM) |
| 4-3-3 | 9 (ST), 6 (CM), 7 (CM) | 4-4-2 | 2 (CB), 3 (CB), 6 (CM) |
| 4-3-3 | 9 (ST), 6 (CM), 7 (CM) | 4-2-3-1 | 2 (CB), 3 (CB), 5 (CDM), 6 (CDM) |
| 4-4-2 | 9 (ST), 10 (ST), 6 (CM) | 4-3-3 | 2 (CB), 3 (CB), 6 (CM) |
| 4-4-2 | 9 (ST), 10 (ST), 6 (CM) | 4-4-2 | 2 (CB), 3 (CB), 6 (CM) |
| 4-4-2 | 9 (ST), 10 (ST), 6 (CM) | 4-2-3-1 | 2 (CB), 3 (CB), 5 (CDM), 6 (CDM) |
| 4-2-3-1 | 10 (ST), 8 (CAM), 6 (CDM) | 4-3-3 | 2 (CB), 3 (CB), 6 (CM) |
| 4-2-3-1 | 10 (ST), 8 (CAM), 6 (CDM) | 4-4-2 | 2 (CB), 3 (CB), 6 (CM) |
| 4-2-3-1 | 10 (ST), 8 (CAM), 6 (CDM) | 4-2-3-1 | 2 (CB), 3 (CB), 5 (CDM), 6 (CDM) |

**Long Ball:**
| Formation (ATK) | Attackers | Formation (DEF) | Defenders |
|-----------------|-----------|-----------------|-----------|
| 4-3-3 | 9 (ST), 6 (CM) | Any | 2 (CB), 3 (CB) |
| 4-4-2 | 9 (ST), 10 (ST) | Any | 2 (CB), 3 (CB) |
| 4-2-3-1 | 10 (ST), 8 (CAM) | Any | 2 (CB), 3 (CB) |

**Counter-Attack:**
Same as long ball attackers, but defenders have a **positioning penalty of -15** if the defending team's mentality was "attacking" (they were caught pushing forward).

## Assists

When a goal is scored, the **assist** goes to the highest-passing player among the other attackers involved in the zone (not the shooter). If no other attacker was involved (e.g., solo counter-attack), there is no assist.

## How to Run It

Two entry points:

**Single match:**
```bash
npx ts-node src/test/run-single.ts --seed 12345
```
Should print the full phase-by-phase event log in readable format (not raw JSON — format it with clear labels, one phase per block), followed by the final score and player summaries.

**Batch run:**
```bash
npx ts-node src/test/run-batch.ts --count 1000
```
Should print aggregate statistics: average goals per match, clean sheet %, win/draw/loss distribution, average fouls, yellows, reds per match, injury frequency, corners per match, penalty frequency. Compare these against the target distributions in the spec.

## What Comes Next (not now)

The full spec is attached separately. It describes all the features this engine will eventually support: weather, chemistry, form, interactive pause system, AI opponents with personalities, commentary, a top-down pitch UI, pack shop, XP progression, and PvP multiplayer. The engine architecture is designed so all of these can be added without restructuring — the integration points are documented in the spec.

**Do not build any of these yet.** Focus only on the core simulation testbed described above.

// 20-team league pool used by run-season.ts. The user's team + 19
// procedurally-generated AI teams. Each AI team keeps a distinct identity
// through its (name, formation, mentality, tier, seed) signature; player
// names are pulled from random country pools so squads feel like modern
// internationally-mixed clubs.
//
// Tier distribution: 4 pro / 8 semipro / 7 rookie — gives a competitive
// curve where pro teams contend for the title and rookie teams can be
// caught at the bottom.
//
// Formation coverage: all 7 supported formations represented at least
// once across the 19 AI teams, so run-season exercises the full engine.

import { generateSquad, type GenerateSquadOpts } from '~/generators/squad-generator'
import { userSquad, userTactics } from '~/test/fixtures/user-team'
import type { Squad, Tactics } from '~/types'

export type LeagueTeam = {
  squad: Squad
  tactics: Tactics
}

const AI_SPECS: GenerateSquadOpts[] = [
  // Pro tier (4) — title contenders
  { name: 'FC Königsberg',      idPrefix: 'kbg', tier: 'pro',     formation: '4-2-3-1', mentality: 'balanced',  seed: 1001 },
  { name: 'Estrela do Mar',     idPrefix: 'edm', tier: 'pro',     formation: '4-3-3',   mentality: 'attacking', seed: 1002 },
  { name: 'Hammerheads FC',     idPrefix: 'hmf', tier: 'pro',     formation: '3-4-3',   mentality: 'attacking', seed: 1009 },
  { name: 'Riviera United',     idPrefix: 'riv', tier: 'pro',     formation: '4-3-3',   mentality: 'balanced',  seed: 1010 },

  // Semipro tier (8) — the meat of the table
  { name: 'AC Verona',          idPrefix: 'acv', tier: 'semipro', formation: '4-4-2',   mentality: 'balanced',  seed: 1003 },
  { name: 'Olympique Côte',     idPrefix: 'oc',  tier: 'semipro', formation: '4-3-3',   mentality: 'balanced',  seed: 1004 },
  { name: 'Ajax Stadt',         idPrefix: 'ajx', tier: 'semipro', formation: '4-3-3',   mentality: 'attacking', seed: 1005 },
  { name: 'Norrland FK',        idPrefix: 'nor', tier: 'semipro', formation: '4-4-2',   mentality: 'defensive', seed: 1006 },
  { name: 'Atletico San Marco', idPrefix: 'asm', tier: 'semipro', formation: '3-5-2',   mentality: 'attacking', seed: 1011 },
  { name: 'Vienna Sturm',       idPrefix: 'vie', tier: 'semipro', formation: '4-4-2',   mentality: 'attacking', seed: 1012 },
  { name: 'Belgrade Star',      idPrefix: 'bel', tier: 'semipro', formation: '3-5-2',   mentality: 'balanced',  seed: 1013 },
  { name: 'Cádiz Marina',       idPrefix: 'cdz', tier: 'semipro', formation: '4-3-3',   mentality: 'attacking', seed: 1014 },

  // Rookie tier (7) — relegation candidates
  { name: 'Lagos Eagles',       idPrefix: 'lag', tier: 'rookie',  formation: '4-3-3',   mentality: 'balanced',  seed: 1007 },
  { name: 'Krakow Polonia',     idPrefix: 'kpo', tier: 'rookie',  formation: '4-4-2',   mentality: 'defensive', seed: 1008 },
  { name: 'Bergen Ulver',       idPrefix: 'ber', tier: 'rookie',  formation: '5-4-1',   mentality: 'defensive', seed: 1015 },
  { name: 'Halmstad BK',        idPrefix: 'hbk', tier: 'rookie',  formation: '4-2-3-1', mentality: 'balanced',  seed: 1016 },
  { name: 'Drumheller FC',      idPrefix: 'drm', tier: 'rookie',  formation: '5-3-2',   mentality: 'defensive', seed: 1017 },
  { name: 'Rosario Central',    idPrefix: 'ros', tier: 'rookie',  formation: '5-3-2',   mentality: 'defensive', seed: 1018 },
  { name: 'Dynamo Sokolov',     idPrefix: 'dyn', tier: 'rookie',  formation: '5-4-1',   mentality: 'balanced',  seed: 1019 }
]

const aiTeams: LeagueTeam[] = AI_SPECS.map((s) => {
  const { squad, tactics } = generateSquad(s)
  return { squad, tactics }
})

const userEntry: LeagueTeam = { squad: userSquad, tactics: userTactics }

// User team listed first; order doesn't affect the round-robin, just makes
// it easy to scan output (your team always at the top of references).
export const LEAGUE_TEAMS: LeagueTeam[] = [userEntry, ...aiTeams]

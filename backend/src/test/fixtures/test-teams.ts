// Two procedurally-generated test teams shared by the CLI runners that
// need a fixed home/away matchup (run-single, run-batch, run-progression).
//
// Both teams use stable seeds so output is reproducible across runs. They
// run procedural-team mode (formation supplied) with mixed nationalities
// — this is the same shape AI teams will take in career mode, so the
// runners exercise the realistic case.

import { generateSquad } from '~/generators/squad-generator'

const home = generateSquad({
  name: 'Manchester United',
  idPrefix: 'MAN',
  tier: 'legend',
  formation: '4-3-3',
  mentality: 'balanced',
  seed: 9001
})

const away = generateSquad({
  name: 'Arsenal',
  idPrefix: 'ARS',
  tier: 'legend',
  formation: '4-3-3',
  mentality: 'balanced',
  seed: 9002
})

export const testHome = home.squad
export const testAway = away.squad
export const testHomeTactics = home.tactics
export const testAwayTactics = away.tactics

// The user's starting team. Generated via pack-pull mode — mixed
// nationalities, formation auto-detected from what rolls. Stable seed so
// the same squad shows up every test run; in real career mode this is
// rolled fresh per profile during onboarding.
//
// Used by run-season alongside the AI league pool. Long-term this will
// move to the DB once the persistence layer ships.

import { generateSquad } from '@/generators/squad-generator'

const result = generateSquad({
  name: 'Avark FC',
  idPrefix: 'avk',
  tier: 'semipro',
  seed: 5000
})

export const userSquad = result.squad
export const userTactics = result.tactics
export const userFormationScores = result.formationScores!

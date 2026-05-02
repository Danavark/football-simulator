// Club legend logic. Retired players become legends in their role group;
// each legend grants a small permanent buff to all current players in the
// same role. Stacks with diminishing returns so a long career doesn't
// produce absurd buffs.
//
// Spec: docs/06_progression-and-balance.md §7.

import { PROGRESSION_CONSTANTS, ROLE_BY_POSITION } from '@/consts/career'
import type { Card, Legend, Profile, RoleBuffs, RoleGroup } from '@/types'

// Read the buff for a legend at a given stack position (0-indexed). Beyond
// the explicit array, all further entries reuse the last value.
function buffForStackPos(stackPos: number): number {
  const arr = PROGRESSION_CONSTANTS.legendBuffsByStackPos
  return arr[Math.min(stackPos, arr.length - 1)]
}

// Promote a retired card into a legend on the profile. The buffPct is
// frozen at retirement time so future legends don't retroactively shrink
// existing buffs as the diminishing-returns ladder is consumed.
export function recordLegend(profile: Profile, card: Card, retiredInSeason: number): Legend {
  const role = ROLE_BY_POSITION[card.position]
  const stackPos = profile.legends.filter((l) => l.role === role).length
  const legend: Legend = {
    retiredCardId: card.id,
    role,
    retiredInSeason,
    buffPct: buffForStackPos(stackPos)
  }
  profile.legends.push(legend)
  return legend
}

// Flatten a profile's legends into per-role multipliers. Buffs sum
// additively within a role; the multiplier is `1 + sum(buffPct)`. AI teams
// pass NO_LEGEND_BUFFS (see engine/match.ts) since they don't track legends.
export function computeRoleBuffs(profile: Profile): RoleBuffs {
  const totals: Record<RoleGroup, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 }
  for (const l of profile.legends) totals[l.role] += l.buffPct
  return {
    GK: 1 + totals.GK,
    DEF: 1 + totals.DEF,
    MID: 1 + totals.MID,
    ATT: 1 + totals.ATT
  }
}

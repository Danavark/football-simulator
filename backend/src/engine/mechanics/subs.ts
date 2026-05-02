// Auto-substitute the best available bench card when a player goes off
// injured. Red-carded teams are NOT replaced — they play a man down (real
// football rule). When the bench is exhausted of suitable cover, the slot
// stays empty and the team plays short for the rest of the match.

import { FORMATION_SLOTS, POSITION_AFFINITY } from '@/consts/engine'
import { computePositionFit } from '@/engine/stats'
import type { Card, MatchState, Side } from '@/types'

// Bring on a bench player to fill the slot a card just vacated. The
// candidate is picked using the position-affinity ladder (exact match
// first, then ranked neighbours). Returns the card that came on, or
// null if no eligible bench player exists. Mutates state.{home,away}Squad
// .lineup and the bench player's PlayerMatchState.
export function tryAutoSub(state: MatchState, side: Side, vacatedCardId: string): Card | null {
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const players = side === 'home' ? state.players.home : state.players.away
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics

  const slotInfo = squad.lineup.find((l) => l.cardId === vacatedCardId)
  if (!slotInfo) return null

  const wantedPosition = FORMATION_SLOTS[tactics.formation][slotInfo.slot]
  const ladder = POSITION_AFFINITY[wantedPosition]

  for (const tier of ladder) {
    const candidate = squad.subs.find((c) => {
      if (c.position !== tier) return false
      const ps = players.find((p) => p.cardId === c.id)
      return Boolean(ps && !ps.isOnPitch && !ps.isInjured && !ps.redCard)
    })
    if (!candidate) continue
    slotInfo.cardId = candidate.id
    const ps = players.find((p) => p.cardId === candidate.id)!
    ps.isOnPitch = true
    // Refresh position fit for the slot they're filling. Defaults to 1.0
    // for all bench cards at init time; this is when they pick up a real
    // value based on the slot they actually take over.
    ps.positionFit = computePositionFit(candidate.position, wantedPosition)
    return candidate
  }

  return null
}

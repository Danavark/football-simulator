// Squad and tactics — how a set of cards is fielded for a match.

import type { Card } from '@/types/card'

// Supported formations: three 4-back, two 5-back, two 3-back.
export type Formation = '4-3-3' | '4-4-2' | '4-2-3-1' | '5-3-2' | '5-4-1' | '3-5-2' | '3-4-3'

// Tactical mentality picked pre-match by each side.
export type Mentality = 'defensive' | 'balanced' | 'attacking'

// Mapping from a formation slot index (0–10) to the card filling it.
export type LineupSlot = {
  slot: number // 0–10
  cardId: string
}

// 18-card pool: 11 starters in lineup + 7 subs.
export type Squad = {
  name: string
  cards: Card[]
  lineup: LineupSlot[] // 11 starters
  subs: Card[] // 4 bench
}

// Tactical setup chosen for a match.
export type Tactics = {
  formation: Formation
  mentality: Mentality
}

// Zone phrasing helpers — turn a Zone enum into the natural-language
// fragments commentary lines splice in ("down the left", "left-wing move").
// Originally lived inline in run-single.ts; lifted into the commentary
// module so all line pools can share it.

import type { Zone } from '~/types'

export type ZonePhrase = {
  push: string // verb phrase: "push down the left"
  through: string // preposition: "down the left", "through the middle"
  noun: string // bare noun: "left-wing move", "long ball"
}

export function zonePhrase(z: Zone): ZonePhrase {
  switch (z) {
    case 'left_wing':
      return { push: 'push down the left', through: 'down the left', noun: 'left-wing move' }
    case 'right_wing':
      return { push: 'push down the right', through: 'down the right', noun: 'right-wing move' }
    case 'centre':
      return { push: 'push through the middle', through: 'through the middle', noun: 'central move' }
    case 'long_ball':
      return { push: 'go long', through: 'with the long ball', noun: 'long ball' }
    case 'counter':
      return { push: 'break on the counter', through: 'on the counter', noun: 'counter' }
  }
}

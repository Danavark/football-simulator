// Modifier prefixes — short contextual sentences prepended to base lines
// to colour the prose by match state. Keyed on (time bucket × score state)
// per Q14 and applied probabilistically (Q21) only on nothing/buildup
// outcomes so the bigger moments stay clean.
//
// Time buckets (Q19): early ≤30', mid 31-70', late 71-90', stoppage 90+'.
// Score state (Q20): from the attacking team's perspective.

export type TimeBucket = 'early' | 'mid' | 'late' | 'stoppage'
export type ScoreState = 'level' | 'leading' | 'trailing'

export const MODIFIERS: Record<TimeBucket, Record<ScoreState, readonly string[]>> = {
  early: {
    level: ['Settling into a rhythm', 'Even contest in the early stages', 'Both sides feeling each other out'],
    leading: ['Already a goal up', 'On top early', 'Bright start paying off'],
    trailing: ['Already chasing', 'Behind early on', 'Needing a response']
  },
  mid: {
    level: ['Still all to play for', 'Tight contest', 'Neither side budging'],
    leading: ['Holding the lead', 'In control', 'Playing within themselves'],
    trailing: ['Looking for a way back', 'Need to find something', 'Pressing for the equaliser']
  },
  late: {
    level: ['Tense final stages', 'Could be either way', 'Game on a knife-edge'],
    leading: ['Sensing the win', 'Ready to close it out', 'Game management mode'],
    trailing: ['Time running short', 'Late and chasing', 'Pressure mounting']
  },
  stoppage: {
    level: ['Final moments — could be either way', 'Stoppage time and tied', 'Last few seconds level'],
    leading: ['Almost over', 'Closing the book', 'Job nearly done'],
    trailing: ['Last throw of the dice', 'Out of time', 'Now or never']
  }
}

// Persistent flavour for a team that's been reduced to ten men. Used as
// a modifier prefix on the man-down team's nothing/buildup lines, in
// place of the time/scoreline modifier.
export const DOWN_TO_TEN_FLAVOUR: readonly string[] = [
  'Down to ten and battling',
  'Short-handed but still trying',
  'A man light',
  'Despite being down to ten',
  'With ten men on the pitch',
  'Numerical disadvantage showing',
  'Stretched thin defensively',
  'Ten men standing firm'
]

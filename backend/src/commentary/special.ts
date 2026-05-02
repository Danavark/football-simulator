// Special-moment prose — kickoff, half-time, full-time, stoppage,
// post-goal reactions (late drama, equaliser, comeback), and the
// one-off red-card reaction. Per Q16 / Q17 / Q23 / Q24 / Q25.

import type { WeatherCondition } from '~/types'

// Kickoff lines — match opener.
export const KICKOFF_LINES: ((home: string, away: string) => string)[] = [
  (h, a) => `We're underway. ${h} host ${a} today.`,
  (h, a) => `Kickoff. ${h} versus ${a}.`,
  (h, a) => `${h} get us started against ${a}.`,
  (h, a) => `And we're off — ${h} versus ${a}.`,
  (h, a) => `Match underway. ${h} hosting ${a}.`,
  (h, a) => `Whistle goes — ${a} the visitors here at ${h}.`,
  (h, a) => `Game on. ${h} take to the field against ${a}.`,
  (h, a) => `${h} start brightly against ${a}.`
]

// Optional weather flavour at kickoff. Returns null for clear conditions
// (no extra line needed). Caller appends to the kickoff line if non-null.
export const WEATHER_KICKOFF: Record<WeatherCondition, string | null> = {
  clear: null,
  rain: 'Heavy rain falling here — going to be a tough one underfoot.',
  snow: 'Snow underfoot — pitch is going to play heavy today.',
  wind: 'Strong wind blowing through the stadium — could affect the long passing.'
}

// Half-time — three sub-pools by who leads (from home's perspective).
export const HALF_TIME_LEVEL: ((h: string, a: string, hs: number, as: number) => string)[] = [
  (_h, _a, hs, as) => `And that's the half. Honours even at ${hs}-${as}.`,
  (h, a, hs, as) => `Half-time — ${h} ${hs} ${a} ${as}. Plenty still to play for.`,
  (_h, _a, hs, as) => `Whistle for the break. Level pegging at ${hs}-${as}.`
]

export const HALF_TIME_HOME_LEADING: ((h: string, a: string, hs: number, as: number) => string)[] = [
  (h, a, hs, as) => `Half-time. ${h} lead ${a} ${hs}-${as}.`,
  (h, _a, hs, as) => `And that's the half — ${h} ahead by ${hs - as}.`,
  (h, a, hs, as) => `Break called. ${h} ${hs}, ${a} ${as} — they'll be the happier side.`
]

export const HALF_TIME_HOME_TRAILING: ((h: string, a: string, hs: number, as: number) => string)[] = [
  (h, a, hs, as) => `Half-time. ${a} lead it ${as}-${hs}.`,
  (h, _a, hs, as) => `And that's the break — ${h} have work to do, trailing ${hs}-${as}.`,
  (h, _a, hs, as) => `${h} need to find something — ${as}-${hs} down at the half.`
]

// Full-time — three sub-pools by result.
export const FULL_TIME_HOME_WIN: ((h: string, a: string, hs: number, as: number) => string)[] = [
  (h, _a, hs, as) => `Full time! ${h} take it ${hs}-${as}.`,
  (h, _a, _hs, _as) => `Full time. ${h} with the win at home.`,
  (h, a, hs, as) => `And that's it — ${h} beat ${a} ${hs}-${as}.`
]

export const FULL_TIME_AWAY_WIN: ((h: string, a: string, hs: number, as: number) => string)[] = [
  (_h, a, hs, as) => `Full time! ${a} win it ${as}-${hs} on the road.`,
  (h, a, _hs, _as) => `And that's all — ${a} take it from ${h}.`,
  (_h, a, hs, as) => `Full time. ${a} get the points, ${as}-${hs}.`
]

export const FULL_TIME_DRAW: ((h: string, a: string, hs: number, as: number) => string)[] = [
  (_h, _a, hs, as) => `Full time. Honours even, ${hs}-${as}.`,
  (_h, _a, hs, as) => `Whistle goes — they share the points, ${hs}-${as}.`,
  (_h, _a, hs, as) => `Full time. ${hs}-${as} the final score.`
]

// Stoppage announcement — fires once on the first beat with minute > 90.
export const STOPPAGE_ANNOUNCEMENT: (() => string)[] = [
  () => 'Into stoppage time.',
  () => 'We\'re into added time.',
  () => 'Stoppage time now — and a chance for late drama.',
  () => 'Final moments — into the stoppage period.'
]

// Late goal reactions — appended after a goal at minute 86+. Generic;
// the GOAL line already names the scorer.
export const LATE_GOAL_REACTIONS: (() => string)[] = [
  () => 'What a time to score!',
  () => 'Crucial moment in this match.',
  () => 'Massive goal at this stage.',
  () => 'Late drama — and how!',
  () => 'Couldn\'t have come at a better time for them.',
  () => 'Game-changer this late on.',
  () => 'Big, big goal.',
  () => 'And in the dying minutes — what a moment.'
]

// Equaliser reactions — was trailing → now level.
export const EQUALISER_REACTIONS: ((atk: string) => string)[] = [
  (atk) => `${atk} are level — they've found one back.`,
  (atk) => `${atk} draw level — game on.`,
  (atk) => `Out of the blue — ${atk} have equalised.`,
  (atk) => `${atk} won't go away — back on level terms.`,
  (atk) => `Level pegging — ${atk} earn their equaliser.`,
  (atk) => `${atk} respond — and we're tied.`
]

// Comeback complete — was trailing → now leading. The iconic moment.
export const COMEBACK_LEAD_REACTIONS: ((atk: string) => string)[] = [
  (atk) => `${atk} have turned this around — they lead!`,
  (atk) => `What a comeback — ${atk} are in front!`,
  (atk) => `From behind to in front — ${atk} have flipped this on its head!`,
  (atk) => `${atk} were chasing the game — now they lead it!`,
  (atk) => `Remarkable — ${atk} have completed the turnaround!`,
  (atk) => `${atk} ahead now — what a story this is!`
]

// One-off reaction line right after a red card is shown. Q25 (c).
export const RED_CARD_REACTIONS: ((team: string) => string)[] = [
  (team) => `${team} will have to see this out with ten men.`,
  (team) => `Big call — ${team} reduced to ten.`,
  (team) => `That changes things — ${team} a man light.`,
  (team) => `${team} down to ten — the manager won't be happy.`,
  (team) => `Numerical disadvantage now for ${team}.`,
  (team) => `${team} face the rest of this with ten men.`
]

// Apply user decisions made during a pause. Mutates state.{home,away}Squad
// and Tactics in place; throws on invalid input (Q10) so the UI's
// validation has to be tight before sending. Returns the same MatchState
// reference for convenience.
//
// Scope (Q8): subs + mentality + formation. Formation changes require the
// caller to also send a complete `lineup` — the engine doesn't auto-
// reshuffle (slot indices differ between formations and the right
// reshuffle is a UX call). Use suggestLineup as a default UI helper.

import { FORMATION_SLOTS } from '~/consts/engine'
import { computePositionFit } from '~/engine/stats'
import type {
  Card,
  Formation,
  LineupSlot,
  MatchDecisions,
  MatchInput,
  MatchState,
  Mentality,
  Side,
  Squad,
  Tactics
} from '~/types'

const DEFAULT_SUBS_ALLOWED = 5

export function applyDecisions(
  state: MatchState,
  decisions: MatchDecisions,
  input: MatchInput
): MatchState {
  const side = input.userSide
  if (!side) {
    // No user-side configured but decisions arrived — can't disambiguate
    // which squad to mutate. Reject loudly rather than guess.
    throw new Error('applyDecisions: MatchInput.userSide is required when sending decisions')
  }

  if (decisions.subs && decisions.subs.length > 0) {
    applySubs(state, side, decisions.subs, input.subsAllowed ?? DEFAULT_SUBS_ALLOWED)
  }

  if (decisions.mentality) {
    applyMentality(state, side, decisions.mentality)
  }

  if (decisions.formation || decisions.lineup) {
    applyFormation(state, side, decisions.formation, decisions.lineup)
  }

  return state
}

// Process a list of {off, on} subs in order. Each one must:
//   • not exceed MatchInput.subsAllowed for this side
//   • have `off` currently on the pitch (and on this side)
//   • have `on` currently on the bench (and on this side)
//   • have `on` not be already injured / red-carded
function applySubs(
  state: MatchState,
  side: Side,
  subs: Array<{ off: string; on: string }>,
  cap: number
): void {
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const players = side === 'home' ? state.players.home : state.players.away
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics

  for (const { off, on } of subs) {
    if (state.subsUsed[side] >= cap) {
      throw new Error(`applySubs: ${side} side has used all ${cap} subs`)
    }

    const slotInfo = squad.lineup.find((l) => l.cardId === off)
    if (!slotInfo) {
      throw new Error(`applySubs: cardId ${off} is not on the pitch for ${side}`)
    }

    const onCard = squad.cards.find((c) => c.id === on)
    if (!onCard) {
      throw new Error(`applySubs: cardId ${on} is not in the ${side} squad`)
    }

    const onState = players.find((p) => p.cardId === on)
    if (!onState) {
      throw new Error(`applySubs: no player state for ${on}`)
    }
    if (onState.isOnPitch) {
      throw new Error(`applySubs: cardId ${on} is already on the pitch`)
    }
    if (onState.isInjured || onState.redCard) {
      throw new Error(`applySubs: cardId ${on} is injured or sent off — cannot bring on`)
    }
    if (onState.hasBeenSubbedOff) {
      throw new Error(`applySubs: cardId ${on} has already been substituted off — football rule, no return`)
    }

    const offState = players.find((p) => p.cardId === off)!
    offState.isOnPitch = false
    offState.hasBeenSubbedOff = true

    slotInfo.cardId = on
    onState.isOnPitch = true
    // Refresh position fit for the slot they're filling — the bench
    // default of 1.0 only holds while they're warming up.
    const wantedPosition = FORMATION_SLOTS[tactics.formation][slotInfo.slot]
    onState.positionFit = computePositionFit(onCard.position, wantedPosition)

    state.subsUsed[side] += 1
  }
}

function applyMentality(state: MatchState, side: Side, mentality: Mentality): void {
  if (mentality !== 'attacking' && mentality !== 'balanced' && mentality !== 'defensive') {
    throw new Error(`applyMentality: unknown mentality ${mentality}`)
  }
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics
  tactics.mentality = mentality
  // Update the base too so adaptTactics doesn't snap us back to the
  // pre-pause mentality on the next beat.
  if (side === 'home') state.homeBaseMentality = mentality
  else state.awayBaseMentality = mentality
}

// Formation / lineup change. Two valid call shapes:
//   • formation + lineup — switch shape and place all 11. Caller supplies
//     the lineup explicitly because slot indices differ between formations
//     and the right reshuffle is a UX call (use suggestLineup as default).
//   • lineup alone — same formation, just rearrange on-pitch positions
//     (e.g. swap LW/RW, drop a CB into CDM). Treated as the current
//     formation so the UI doesn't have to repeat it.
//
// Every cardId in the new lineup must currently be on the pitch — including
// any player just brought on by `subs` in this same decision payload, since
// applySubs runs first and flips isOnPitch before this validates. This
// blocks the "subbed-off player returns" loophole (football rule).
function applyFormation(
  state: MatchState,
  side: Side,
  formation: Formation | undefined,
  lineup: LineupSlot[] | undefined
): void {
  if (formation && !lineup) {
    throw new Error('applyFormation: formation change requires an explicit lineup; use suggestLineup() to compute one')
  }
  if (!lineup) return

  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const players = side === 'home' ? state.players.home : state.players.away
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics

  // Formation defaults to current when only a lineup is sent.
  const targetFormation = formation ?? tactics.formation
  const formationSlots = FORMATION_SLOTS[targetFormation]
  if (!formationSlots) throw new Error(`applyFormation: unknown formation ${targetFormation}`)

  if (lineup.length !== 11) {
    throw new Error(`applyFormation: lineup must have 11 entries, got ${lineup.length}`)
  }

  // Every cardId must be in the squad, currently on-pitch, not injured /
  // sent off. Slot indices must be unique and 0-10.
  const seenSlots = new Set<number>()
  const seenCards = new Set<string>()
  for (const ls of lineup) {
    if (ls.slot < 0 || ls.slot > 10) throw new Error(`applyFormation: invalid slot ${ls.slot}`)
    if (seenSlots.has(ls.slot)) throw new Error(`applyFormation: duplicate slot ${ls.slot}`)
    if (seenCards.has(ls.cardId)) throw new Error(`applyFormation: duplicate cardId ${ls.cardId}`)
    seenSlots.add(ls.slot)
    seenCards.add(ls.cardId)
    const card = squad.cards.find((c) => c.id === ls.cardId)
    if (!card) throw new Error(`applyFormation: cardId ${ls.cardId} not in ${side} squad`)
    const ps = players.find((p) => p.cardId === ls.cardId)
    if (!ps) throw new Error(`applyFormation: no state for cardId ${ls.cardId}`)
    if (ps.isInjured) throw new Error(`applyFormation: cardId ${ls.cardId} is injured`)
    if (ps.redCard) throw new Error(`applyFormation: cardId ${ls.cardId} is sent off`)
    // Must currently be on-pitch (subs in the same payload run first, so
    // freshly subbed-on players pass and freshly subbed-off players fail).
    if (!ps.isOnPitch) {
      throw new Error(`applyFormation: cardId ${ls.cardId} is not on the pitch — only on-pitch (or freshly subbed-on) players may be placed`)
    }
  }

  tactics.formation = targetFormation
  squad.lineup.length = 0
  squad.lineup.push(...lineup.map((l) => ({ ...l })))

  // Refresh position fit for everyone in the new XI. isOnPitch is already
  // true for all of them by the on-pitch validation above; no need to
  // reset/re-flip the flags.
  for (const ls of lineup) {
    const ps = players.find((p) => p.cardId === ls.cardId)!
    const card = squad.cards.find((c) => c.id === ls.cardId)!
    ps.positionFit = computePositionFit(card.position, formationSlots[ls.slot])
  }
}

// Best-fit lineup helper — returns a lineup that covers the given
// formation's 11 slots using the on-pitch cards from the squad. Picks the
// closest natural-position match for each slot via POSITION_AFFINITY.
// UI/CLI callers can use this as a default formation-change reshuffle and
// let the user tweak from there.
export function suggestLineup(squad: Squad, formation: Formation, players: { cardId: string; isOnPitch: boolean; isInjured: boolean; redCard: boolean }[]): LineupSlot[] {
  const formationSlots = FORMATION_SLOTS[formation]
  const available = squad.cards.filter((c) => {
    const ps = players.find((p) => p.cardId === c.id)
    return Boolean(ps && ps.isOnPitch && !ps.isInjured && !ps.redCard)
  })
  if (available.length !== 11) {
    throw new Error(`suggestLineup: need 11 on-pitch cards, got ${available.length}`)
  }

  const used = new Set<string>()
  const lineup: LineupSlot[] = []
  // For each slot, pick the closest unused on-pitch card by position fit.
  for (let slot = 0; slot < 11; slot++) {
    const wanted = formationSlots[slot]
    let best: Card | null = null
    let bestFit = -Infinity
    for (const c of available) {
      if (used.has(c.id)) continue
      const fit = computePositionFit(c.position, wanted)
      if (fit > bestFit) {
        bestFit = fit
        best = c
      }
    }
    if (!best) throw new Error(`suggestLineup: ran out of cards at slot ${slot}`)
    used.add(best.id)
    lineup.push({ slot, cardId: best.id })
  }
  return lineup
}

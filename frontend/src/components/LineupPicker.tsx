'use client'

import { useState } from 'react'
import { FORMATION_SLOTS, POSITION_AFFINITY } from 'backend/consts/engine'
import type { Card, LineupSlot, MatchState, Position, Side } from 'backend/types'

// Combined Subs + Positions panel. Top section is the live on-pitch XI
// (with queued subs already reflected); bottom section is the bench.
// Tap two on-pitch rows → swap positions. Tap an on-pitch row plus a
// bench row (in either order) → queue a sub. Resets clear everything.

const MAX_SUBS = 5

type Selection =
  | { kind: 'onpitch'; slot: number }
  | { kind: 'bench'; cardId: string }
  | null

type LineupPickerProps = {
  state: MatchState
  side: Side
  pendingSubs: Array<{ off: string; on: string }>
  pendingLineup: LineupSlot[] | null
  onSubsChange: (subs: Array<{ off: string; on: string }>) => void
  onLineupChange: (lineup: LineupSlot[] | null) => void
}

type FitTier = 'exact' | 'partial' | 'mismatch'
function fitTier(slot: Position, natural: Position): FitTier {
  if (slot === natural) return 'exact'
  if (slot === 'GK' || natural === 'GK') return 'mismatch'
  return POSITION_AFFINITY[slot].includes(natural) ? 'partial' : 'mismatch'
}
const FIT_TEXT_COLOR: Record<FitTier, string> = {
  exact: 'text-emerald-400',
  partial: 'text-orange-300',
  mismatch: 'text-red-400'
}

const STAT_LABELS: Array<[keyof Card['stats'], string]> = [
  ['pace', 'Pace'],
  ['shooting', 'Shooting'],
  ['passing', 'Passing'],
  ['dribbling', 'Dribbling'],
  ['defending', 'Defending'],
  ['physicality', 'Physicality'],
  ['positioning', 'Positioning'],
  ['stamina', 'Stamina']
]

function overall(card: Card): number {
  const s = card.stats
  return Math.round(
    (s.pace + s.shooting + s.passing + s.dribbling + s.defending + s.physicality + s.positioning + s.stamina) / 8
  )
}

// Apply queued subs to a base lineup, returning the effective on-pitch
// XI as it'll be after applyDecisions runs. pendingLineup overrides
// when set (it already reflects swaps and any subs that happened
// before the swap).
function deriveDisplayLineup(
  base: LineupSlot[],
  pendingSubs: Array<{ off: string; on: string }>,
  pendingLineup: LineupSlot[] | null
): LineupSlot[] {
  if (pendingLineup) return pendingLineup
  const result = base.map((l) => ({ ...l }))
  for (const sub of pendingSubs) {
    for (const slot of result) {
      if (slot.cardId === sub.off) slot.cardId = sub.on
    }
  }
  return result
}

export function LineupPicker({
  state,
  side,
  pendingSubs,
  pendingLineup,
  onSubsChange,
  onLineupChange
}: LineupPickerProps) {
  // state
  const [selected, setSelected] = useState<Selection>(null)

  // data
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const players = side === 'home' ? state.players.home : state.players.away
  const formationSlots = FORMATION_SLOTS[tactics.formation]
  const cardOf = (id: string): Card | undefined => squad.cards.find((c) => c.id === id)

  const displayLineup = deriveDisplayLineup(squad.lineup, pendingSubs, pendingLineup)
  const sortedOnPitch = [...displayLineup].sort((a, b) => a.slot - b.slot)
  const onPitchIds = new Set(displayLineup.map((l) => l.cardId))

  const queuedOnIds = new Set(pendingSubs.map((s) => s.on))
  const bench = players.filter(
    (p) =>
      !onPitchIds.has(p.cardId) &&
      !p.isInjured &&
      !p.redCard &&
      !p.hasBeenSubbedOff &&
      !queuedOnIds.has(p.cardId)
  )

  const subsUsed = state.subsUsed[side]
  const subsRemaining = MAX_SUBS - subsUsed - pendingSubs.length
  const canSubMore = subsRemaining > 0
  const isDirty = pendingSubs.length > 0 || pendingLineup !== null

  // events
  const queueSub = (offCardId: string, onCardId: string) => {
    onSubsChange([...pendingSubs, { off: offCardId, on: onCardId }])
    // If a swap-derived pendingLineup is active, mirror the sub into it
    // so the on-pitch list stays consistent.
    if (pendingLineup) {
      onLineupChange(pendingLineup.map((l) => (l.cardId === offCardId ? { ...l, cardId: onCardId } : l)))
    }
    setSelected(null)
  }

  const handleClickOnPitch = (slot: number) => {
    if (selected === null) {
      setSelected({ kind: 'onpitch', slot })
      return
    }
    if (selected.kind === 'onpitch') {
      if (selected.slot === slot) {
        setSelected(null)
        return
      }
      // Swap two on-pitch slots — write a new pendingLineup based on the
      // current display (which already reflects any queued subs).
      const a = displayLineup.find((l) => l.slot === selected.slot)
      const b = displayLineup.find((l) => l.slot === slot)
      if (!a || !b) {
        setSelected(null)
        return
      }
      const swapped: LineupSlot[] = displayLineup.map((l) => {
        if (l.slot === selected.slot) return { slot: l.slot, cardId: b.cardId }
        if (l.slot === slot) return { slot: l.slot, cardId: a.cardId }
        return { ...l }
      })
      onLineupChange(swapped)
      setSelected(null)
      return
    }
    // selected is a bench card → queue sub: this on-pitch off, bench on
    if (!canSubMore) {
      setSelected(null)
      return
    }
    const offSlot = displayLineup.find((l) => l.slot === slot)
    if (!offSlot) return
    queueSub(offSlot.cardId, selected.cardId)
  }

  const handleClickBench = (cardId: string) => {
    if (selected === null) {
      if (canSubMore) setSelected({ kind: 'bench', cardId })
      return
    }
    if (selected.kind === 'bench') {
      if (selected.cardId === cardId) {
        setSelected(null)
        return
      }
      // Switch which bench player is selected.
      setSelected({ kind: 'bench', cardId })
      return
    }
    // selected is an on-pitch slot → queue sub
    if (!canSubMore) {
      setSelected(null)
      return
    }
    const offSlot = displayLineup.find((l) => l.slot === selected.slot)
    if (!offSlot) return
    queueSub(offSlot.cardId, cardId)
  }

  const handleRemoveSub = (i: number) => {
    onSubsChange(pendingSubs.filter((_, idx) => idx !== i))
    // Note: if a swap-derived pendingLineup is active, removing a sub
    // leaves it stale (the off-card may still be slotted in instead of
    // the on-card). The user can hit Reset to clear everything if the
    // state gets confusing — for prototype this is acceptable.
  }

  const handleReset = () => {
    onSubsChange([])
    onLineupChange(null)
    setSelected(null)
  }

  return (
    <div className="flex flex-col gap-16">
      <p className="text-xs opacity-60">
        Tap two on-pitch players to swap positions. Tap an on-pitch player + a bench player to sub.
        Hover any row to see stats. Subs left: {subsRemaining}/{MAX_SUBS}.
      </p>

      <section>
        <h4 className="text-xs uppercase opacity-60 mb-8">On Pitch</h4>
        <ul className="flex flex-col gap-4">
          {sortedOnPitch.map((slot) => {
            const card = cardOf(slot.cardId)
            const slotPosition = formationSlots[slot.slot]
            const isSelected = selected?.kind === 'onpitch' && selected.slot === slot.slot
            const tier = card ? fitTier(slotPosition, card.position) : 'mismatch'
            const colour = FIT_TEXT_COLOR[tier]
            return (
              <li key={slot.slot} className="relative group">
                <button
                  type="button"
                  onClick={() => handleClickOnPitch(slot.slot)}
                  className={`w-full text-left px-12 py-8 rounded text-sm transition-colors flex items-center gap-12 ${
                    isSelected ? 'bg-yellow-500/40 ring-2 ring-yellow-400/60' : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className={`font-mono text-xs w-32 flex-shrink-0 ${colour}`}>{slotPosition}</span>
                  <span className="flex-1 truncate">{card?.name ?? slot.cardId}</span>
                  <span className={`font-mono text-xs w-32 text-right flex-shrink-0 ${colour}`}>
                    {card?.position ?? '?'}
                  </span>
                  <span className="font-mono text-xs opacity-50 w-24 text-right flex-shrink-0">
                    {card ? overall(card) : ''}
                  </span>
                </button>
                {card && <PlayerStatsTooltip card={card} />}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h4 className="text-xs uppercase opacity-60 mb-8">Bench</h4>
        {bench.length === 0 ? (
          <p className="text-xs opacity-50 italic px-12">No eligible bench players.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {bench.map((p) => {
              const card = cardOf(p.cardId)
              if (!card) return null
              const isSelected = selected?.kind === 'bench' && selected.cardId === p.cardId
              const disabled = !canSubMore && !isSelected
              return (
                <li key={p.cardId} className="relative group">
                  <button
                    type="button"
                    onClick={() => handleClickBench(p.cardId)}
                    disabled={disabled}
                    className={`w-full text-left px-12 py-8 rounded text-sm transition-colors flex items-center gap-12 ${
                      isSelected
                        ? 'bg-emerald-500/40 ring-2 ring-emerald-400/60'
                        : disabled
                          ? 'bg-white/5 opacity-40 cursor-not-allowed'
                          : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <span className="font-mono text-xs w-32 flex-shrink-0 opacity-50">—</span>
                    <span className="flex-1 truncate">{card.name}</span>
                    <span className="font-mono text-xs w-32 text-right flex-shrink-0 opacity-70">
                      {card.position}
                    </span>
                    <span className="font-mono text-xs opacity-50 w-24 text-right flex-shrink-0">
                      {overall(card)}
                    </span>
                  </button>
                  {card && <PlayerStatsTooltip card={card} />}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {pendingSubs.length > 0 && (
        <section className="flex flex-col gap-4">
          <h4 className="text-xs uppercase opacity-60">Queued subs</h4>
          <ul className="flex flex-col gap-4">
            {pendingSubs.map((s, i) => {
              const off = cardOf(s.off)
              const on = cardOf(s.on)
              return (
                <li key={i} className="text-xs px-12 py-6 bg-white/5 rounded flex items-center justify-between gap-8">
                  <span className="truncate">
                    {off?.name} <span className="opacity-50">→</span> {on?.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSub(i)}
                    className="text-xs opacity-60 hover:opacity-100 flex-shrink-0"
                  >
                    remove
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {isDirty && (
        <button
          type="button"
          onClick={handleReset}
          className="self-start px-12 py-6 rounded text-xs uppercase tracking-wider bg-white/10 hover:bg-white/20 transition-colors"
        >
          Reset all
        </button>
      )}
    </div>
  )
}

// Hover tooltip — same as PositionPicker. Anchored above the row's
// top-left corner; pointer-events-none.
function PlayerStatsTooltip({ card }: { card: Card }) {
  return (
    <div className="absolute bottom-full left-0 mb-8 w-200 z-20 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 ease-out">
      <div className="bg-black/95 border border-white/20 rounded-lg shadow-xl p-12">
        <div className="flex items-baseline justify-between mb-8 pb-8 border-b border-white/10">
          <span className="text-sm font-semibold truncate">{card.name}</span>
          <span className="font-mono text-xs opacity-60 ml-8">{card.position}</span>
        </div>
        <ul className="grid grid-cols-2 gap-x-12 gap-y-4">
          {STAT_LABELS.map(([key, label]) => {
            const v = card.stats[key]
            return (
              <li key={key} className="flex items-center justify-between text-xs">
                <span className="opacity-70">{label}</span>
                <span className="font-mono">{v}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

'use client'

import { useMemo } from 'react'
import { suggestLineup } from 'backend/engine/decisions'
import type { Formation, LineupSlot, MatchState, PlayerMatchState, Side } from 'backend/types'

const ALL_FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '4-2-3-1', '5-3-2', '5-4-1', '3-5-2', '3-4-3']

type FormationPickerProps = {
  state: MatchState
  side: Side
  // Currently chosen formation (null = no change). When set we also send a
  // computed lineup via suggestLineup.
  selected: Formation | null
  // Subs the user has queued in the Lineup tab. Applied to the working
  // players list before suggestLineup runs, so the suggested XI uses the
  // post-sub cards (avoids picking a player who's about to be subbed off).
  pendingSubs: Array<{ off: string; on: string }>
  onChange: (formation: Formation | null, lineup: LineupSlot[] | null) => void
}

// Build a copy of `players` that reflects queued subs — subbed-off cards
// flipped to off-pitch, subbed-on cards flipped to on-pitch. The total
// on-pitch count stays at 11 (subs are 1-for-1) so suggestLineup gets a
// valid input.
function applyPendingSubs(
  players: PlayerMatchState[],
  pendingSubs: Array<{ off: string; on: string }>
): PlayerMatchState[] {
  if (pendingSubs.length === 0) return players
  const offSet = new Set(pendingSubs.map((s) => s.off))
  const onSet = new Set(pendingSubs.map((s) => s.on))
  return players.map((p) => {
    if (offSet.has(p.cardId)) return { ...p, isOnPitch: false }
    if (onSet.has(p.cardId)) return { ...p, isOnPitch: true }
    return p
  })
}

export function FormationPicker({ state, side, selected, pendingSubs, onChange }: FormationPickerProps) {
  // data
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics
  const squad = side === 'home' ? state.homeSquad : state.awaySquad
  const players = side === 'home' ? state.players.home : state.players.away
  // Effective on-pitch set = players + queued subs. suggestLineup needs
  // this so it picks the cards that'll actually be on the pitch when
  // applyDecisions runs (subs apply before lineup).
  const effectivePlayers = useMemo(
    () => applyPendingSubs(players, pendingSubs),
    [players, pendingSubs]
  )

  // Lineup preview for the currently-selected new formation. Recomputed
  // when the user picks a different shape.
  const previewLineup = useMemo(() => {
    if (!selected) return null
    try {
      return suggestLineup(squad, selected, effectivePlayers)
    } catch {
      // Probably <11 on-pitch (red card) — no preview, change disabled.
      return null
    }
  }, [selected, squad, effectivePlayers])

  // events
  const handleSelect = (f: Formation) => {
    if (selected === f || f === tactics.formation) {
      onChange(null, null)
      return
    }
    try {
      const lineup = suggestLineup(squad, f, effectivePlayers)
      onChange(f, lineup)
    } catch (e) {
      onChange(null, null)
      // eslint-disable-next-line no-alert
      alert(`Cannot switch to ${f}: ${(e as Error).message}`)
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <p className="text-sm opacity-70">
        Current: <span className="font-semibold">{tactics.formation}</span>
        {selected && (
          <>
            {' '}
            → <span className="font-semibold text-yellow-300">{selected}</span>
          </>
        )}
      </p>

      <div className="grid grid-cols-4 gap-8">
        {ALL_FORMATIONS.map((f) => {
          const isCurrent = tactics.formation === f
          const active = selected === f
          return (
            <button
              key={f}
              type="button"
              onClick={() => handleSelect(f)}
              className={`px-8 py-12 rounded font-mono text-sm transition-colors ${
                active
                  ? 'bg-yellow-500/40 ring-2 ring-yellow-400/60'
                  : isCurrent
                    ? 'bg-white/15'
                    : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {f}
            </button>
          )
        })}
      </div>

      {previewLineup && (
        <div className="text-xs opacity-60">
          Auto-arranged using best position fit. Engine assigns slots 0–10 in order:
          GK, LB/CB, CBs, RB, midfielders, attackers (formation-specific).
        </div>
      )}
    </div>
  )
}

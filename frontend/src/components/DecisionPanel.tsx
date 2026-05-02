'use client'

import { useState } from 'react'
import type { Formation, LineupSlot, MatchDecisions, MatchState, Mentality, PauseReason, Side } from 'backend/types'
import { LineupPicker } from '@/components/LineupPicker'
import { MentalityPicker } from '@/components/MentalityPicker'
import { FormationPicker } from '@/components/FormationPicker'

type DecisionPanelProps = {
  state: MatchState
  side: Side
  reason: PauseReason
  onApply: (decisions: MatchDecisions) => void
  onSkip: () => void
}

type Tab = 'lineup' | 'mentality' | 'formation'

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'lineup', label: 'Lineup' },
  { key: 'mentality', label: 'Mentality' },
  { key: 'formation', label: 'Formation' }
]

export function DecisionPanel({ state, side, reason, onApply, onSkip }: DecisionPanelProps) {
  // state
  const [tab, setTab] = useState<Tab>('lineup')
  const [subs, setSubs] = useState<Array<{ off: string; on: string }>>([])
  const [mentality, setMentality] = useState<Mentality | null>(null)
  const [formation, setFormation] = useState<Formation | null>(null)
  // Lineup edits — written to by the LineupPicker (sub/swap on-pitch)
  // or FormationPicker (suggested lineup for a new formation).
  const [lineup, setLineup] = useState<LineupSlot[] | null>(null)

  // data
  const tactics = side === 'home' ? state.homeTactics : state.awayTactics
  const hasChanges = subs.length > 0 || mentality !== null || formation !== null || lineup !== null

  // events
  const handleApply = () => {
    const decisions: MatchDecisions = {}
    if (subs.length > 0) decisions.subs = subs
    if (mentality !== null) decisions.mentality = mentality
    if (formation !== null && lineup !== null) {
      decisions.formation = formation
      decisions.lineup = lineup
    } else if (lineup !== null) {
      // Lineup-only — engine treats as "same formation, just rearrange"
      // (and applies any subs first, so post-sub ids in the lineup are
      // accepted).
      decisions.lineup = lineup
    }
    onApply(decisions)
  }

  const handleFormationChange = (f: Formation | null, l: LineupSlot[] | null) => {
    setFormation(f)
    setLineup(l)
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="px-24 py-16 border-b border-white/10">
        <div className="text-xs uppercase opacity-60">Pause reason</div>
        <div className="text-lg font-semibold capitalize">{reason.replace('_', ' ')}</div>
      </div>

      <div className="flex border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 px-12 py-12 text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-white/10 border-b-2 border-yellow-400' : 'opacity-60 hover:opacity-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-24 py-16">
        {tab === 'lineup' && (
          <LineupPicker
            state={state}
            side={side}
            pendingSubs={subs}
            pendingLineup={lineup}
            onSubsChange={setSubs}
            onLineupChange={setLineup}
          />
        )}
        {tab === 'mentality' && (
          <MentalityPicker current={tactics.mentality} selected={mentality} onChange={setMentality} />
        )}
        {tab === 'formation' && (
          <FormationPicker
            state={state}
            side={side}
            selected={formation}
            pendingSubs={subs}
            onChange={handleFormationChange}
          />
        )}
      </div>

      <div className="px-24 py-16 border-t border-white/10 flex items-center gap-12">
        <button
          type="button"
          onClick={handleApply}
          disabled={!hasChanges}
          className="flex-1 px-16 py-12 rounded font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40 text-black transition-colors"
        >
          Apply &amp; Resume
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="px-16 py-12 rounded font-semibold bg-white/10 hover:bg-white/20 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

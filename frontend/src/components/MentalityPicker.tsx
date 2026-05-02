'use client'

import type { Mentality } from 'backend/types'

type MentalityPickerProps = {
  current: Mentality
  selected: Mentality | null
  onChange: (m: Mentality | null) => void
}

const OPTIONS: Array<{ value: Mentality; label: string; tone: string }> = [
  { value: 'attacking', label: 'Attacking', tone: 'bg-red-500/40 hover:bg-red-500/60' },
  { value: 'balanced', label: 'Balanced', tone: 'bg-blue-500/40 hover:bg-blue-500/60' },
  { value: 'defensive', label: 'Defensive', tone: 'bg-emerald-500/40 hover:bg-emerald-500/60' }
]

export function MentalityPicker({ current, selected, onChange }: MentalityPickerProps) {
  return (
    <div className="flex flex-col gap-16">
      <p className="text-sm opacity-70">
        Current: <span className="font-semibold">{current}</span>
        {selected && selected !== current && (
          <>
            {' '}
            → <span className="font-semibold text-yellow-300">{selected}</span>
          </>
        )}
      </p>
      <div className="grid grid-cols-3 gap-8">
        {OPTIONS.map((opt) => {
          const active = selected === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(active ? null : opt.value)}
              className={`px-12 py-12 rounded font-semibold text-sm transition-colors ${
                active ? `${opt.tone} ring-2 ring-white/40` : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

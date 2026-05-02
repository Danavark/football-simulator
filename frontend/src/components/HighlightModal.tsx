'use client'

import type { HighlightFrame } from '@/types/protocol'

type HighlightModalProps = {
  highlight: HighlightFrame | null
}

const COPY: Record<HighlightFrame['kind'], { title: string; tone: string; emoji: string }> = {
  goal: { title: 'GOAL', tone: 'bg-emerald-500/30 border-emerald-400', emoji: '⚽' },
  yellow: { title: 'Yellow Card', tone: 'bg-yellow-500/30 border-yellow-400', emoji: '🟨' },
  red: { title: 'RED CARD', tone: 'bg-red-500/30 border-red-400', emoji: '🟥' },
  second_yellow: { title: 'Second Yellow', tone: 'bg-red-500/30 border-red-400', emoji: '🟨🟥' },
  injury: { title: 'Injury', tone: 'bg-orange-500/30 border-orange-400', emoji: '🏥' }
}

// Center-screen flash modal. Auto-dismisses on the parent's timer — this
// component is purely presentational. When highlight is null nothing
// renders; when set, the modal appears.
export function HighlightModal({ highlight }: HighlightModalProps) {
  if (!highlight) return null
  const { title, tone, emoji } = COPY[highlight.kind]

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto rounded-2xl border-2 px-48 py-32 shadow-2xl backdrop-blur-md ${tone} text-center min-w-320`}
      >
        <div className="text-6xl mb-12">{emoji}</div>
        <div className="text-3xl font-bold tracking-wider mb-8">{title}</div>
        <div className="text-xl mb-4">{highlight.player}</div>
        <div className="text-sm opacity-70">
          {highlight.team} · {highlight.minute}'
        </div>
        {highlight.score && (
          <div className="text-3xl font-bold tabular-nums mt-16 pt-12 border-t border-white/20">
            {highlight.score.home} – {highlight.score.away}
          </div>
        )}
      </div>
    </div>
  )
}

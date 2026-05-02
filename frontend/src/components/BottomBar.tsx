'use client'

export type Speed = 'slow' | 'default' | 'fast'

type BottomBarProps = {
  // Latest beat's commentary lines, joined into a single string by the
  // caller. Empty string before kickoff.
  latest: string
  paused: boolean
  ended: boolean
  speed: Speed
  onPause: () => void
  onViewMore: () => void
  onNewMatch: () => void
  onSpeedChange: (speed: Speed) => void
}

const SPEEDS: Array<{ key: Speed; label: string }> = [
  { key: 'slow', label: '0.5×' },
  { key: 'default', label: '1×' },
  { key: 'fast', label: '2×' }
]

export function BottomBar({ latest, paused, ended, speed, onPause, onViewMore, onNewMatch, onSpeedChange }: BottomBarProps) {
  return (
    <footer className="bg-black/40 border-t border-white/10 px-24 py-12 flex items-center gap-16">
      <div className="flex-1 min-w-0 text-sm opacity-90 truncate">{latest || 'Waiting for kick-off…'}</div>

      {!ended && (
        <div className="flex items-center gap-4 bg-white/5 rounded p-2 flex-shrink-0">
          {SPEEDS.map((s) => {
            const active = s.key === speed
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onSpeedChange(s.key)}
                className={`px-12 py-6 rounded text-xs font-mono transition-colors ${
                  active ? 'bg-white/20 text-white' : 'opacity-50 hover:opacity-100'
                }`}
                title={`Speed: ${s.key}`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onViewMore}
        className="px-12 py-8 text-xs uppercase tracking-wider rounded bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0"
      >
        View more
      </button>

      {ended ? (
        <button
          type="button"
          onClick={onNewMatch}
          className="px-16 py-8 bg-emerald-500 hover:bg-emerald-400 text-black rounded font-semibold flex-shrink-0"
        >
          New match
        </button>
      ) : paused ? (
        <span className="px-16 py-8 bg-orange-500/30 text-orange-200 rounded text-sm flex-shrink-0">PAUSED</span>
      ) : (
        <button
          type="button"
          onClick={onPause}
          className="px-16 py-8 bg-yellow-500/80 hover:bg-yellow-400 text-black rounded font-semibold flex-shrink-0"
        >
          Pause
        </button>
      )}
    </footer>
  )
}

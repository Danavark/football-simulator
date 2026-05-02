'use client'

type ScoreboardProps = {
  homeName: string
  awayName: string
  score: { home: number; away: number }
  minute: number
  paused: boolean
  ended: boolean
}

// Pure status header — team names, score, clock, and a paused/FT badge.
// The Pause / New-match controls live in the BottomBar so the scoreboard
// stays focused on "what's happening on the pitch right now".
export function Scoreboard({ homeName, awayName, score, minute, paused, ended }: ScoreboardProps) {
  return (
    <header className="bg-black/40 border-b border-white/10 px-24 py-16 flex items-center justify-between gap-24">
      <div className="flex items-center gap-16">
        <span className="text-xl font-semibold">{homeName}</span>
        <span className="text-3xl font-bold tabular-nums">
          {score.home} – {score.away}
        </span>
        <span className="text-xl font-semibold">{awayName}</span>
      </div>
      <div className="flex items-center gap-16">
        <span className="text-lg font-mono opacity-70">{minute}'</span>
        {paused && !ended && (
          <span className="px-12 py-4 bg-orange-500/30 text-orange-200 rounded text-xs uppercase tracking-wider">Paused</span>
        )}
        {ended && (
          <span className="px-12 py-4 bg-emerald-500/20 text-emerald-200 rounded text-xs uppercase tracking-wider">Full Time</span>
        )}
      </div>
    </header>
  )
}

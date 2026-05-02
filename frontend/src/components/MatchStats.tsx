'use client'

import type { TeamTotals } from 'backend/types'

type MatchStatsProps = {
  homeName: string
  awayName: string
  totals: { home: TeamTotals; away: TeamTotals } | null
}

// Mirrors the CLI's printMatchStats panel: a column per team with the
// label between, plus a horizontal split bar showing the home/away ratio.
// All numbers update live as the BeatFrame totals roll in.
export function MatchStats({ homeName, awayName, totals }: MatchStatsProps) {
  // data
  const h = totals?.home
  const a = totals?.away
  const noData = !totals

  return (
    <div className="h-full overflow-y-auto px-24 py-16 flex flex-col gap-16">
      <header className="flex items-center justify-between text-xs uppercase tracking-wider opacity-50">
        <span>{homeName}</span>
        <span>Match Stats</span>
        <span>{awayName}</span>
      </header>

      {noData ? (
        <div className="flex-1 flex items-center justify-center opacity-50 text-sm">
          Stats will appear once the match is underway.
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          <StatRow label="Possession" left={`${h!.possessionPct}%`} right={`${a!.possessionPct}%`} bar={[h!.possessionPct, a!.possessionPct]} />
          <StatRow label="Shots" left={h!.shots} right={a!.shots} bar={[h!.shots, a!.shots]} />
          <StatRow label="On Target" left={h!.shotsOnTarget} right={a!.shotsOnTarget} bar={[h!.shotsOnTarget, a!.shotsOnTarget]} />
          <StatRow label="Off Target" left={h!.shotsOffTarget} right={a!.shotsOffTarget} bar={[h!.shotsOffTarget, a!.shotsOffTarget]} />
          <StatRow label="Corners" left={h!.corners} right={a!.corners} bar={[h!.corners, a!.corners]} />
          <StatRow label="Free Kicks" left={h!.freeKicks} right={a!.freeKicks} bar={[h!.freeKicks, a!.freeKicks]} />
          <StatRow label="Penalties" left={h!.penalties} right={a!.penalties} bar={[h!.penalties, a!.penalties]} />
          <StatRow label="Fouls" left={h!.fouls} right={a!.fouls} bar={[h!.fouls, a!.fouls]} />
          <StatRow label="Yellow Cards" left={h!.yellowCards} right={a!.yellowCards} bar={[h!.yellowCards, a!.yellowCards]} accentLeft="bg-yellow-500/70" accentRight="bg-yellow-500/70" />
          <StatRow label="Red Cards" left={h!.redCards} right={a!.redCards} bar={[h!.redCards, a!.redCards]} accentLeft="bg-red-500/70" accentRight="bg-red-500/70" />
        </div>
      )}
    </div>
  )
}

type StatRowProps = {
  label: string
  left: string | number
  right: string | number
  bar: [number, number]
  accentLeft?: string
  accentRight?: string
}

function StatRow({ label, left, right, bar, accentLeft = 'bg-white/60', accentRight = 'bg-white/30' }: StatRowProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[64px_1fr_64px] items-baseline">
        <span className="font-mono tabular-nums">{left}</span>
        <span className="text-xs uppercase opacity-60 text-center">{label}</span>
        <span className="font-mono tabular-nums text-right">{right}</span>
      </div>
      <Bar leftValue={bar[0]} rightValue={bar[1]} leftClass={accentLeft} rightClass={accentRight} />
    </div>
  )
}

function Bar({ leftValue, rightValue, leftClass, rightClass }: { leftValue: number; rightValue: number; leftClass: string; rightClass: string }) {
  const total = leftValue + rightValue
  // Both zero → no fill visible; render a faint outline so the row still
  // reads as present in the table.
  if (total === 0) {
    return <div className="h-4 rounded-full bg-white/5" />
  }
  const leftPct = (leftValue / total) * 100
  return (
    <div className="h-4 rounded-full overflow-hidden flex bg-white/5">
      <div className={`h-full ${leftClass}`} style={{ width: `${leftPct}%` }} />
      <div className={`h-full ${rightClass}`} style={{ width: `${100 - leftPct}%` }} />
    </div>
  )
}

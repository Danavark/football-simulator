'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { MatchDecisions, MatchResult, MatchState, PauseReason, Side, TeamTotals } from 'backend/types'
import type { BeatFrame, EndFrame, ErrorFrame, HighlightFrame, PauseFrame } from '@/types/protocol'
import { Scoreboard } from '@/components/Scoreboard'
import { type CommentaryLine } from '@/components/CommentaryFeed'
import { CommentaryDrawer } from '@/components/CommentaryDrawer'
import { DecisionPanel } from '@/components/DecisionPanel'
import { MatchStats } from '@/components/MatchStats'
import { BottomBar, type Speed } from '@/components/BottomBar'
import { HighlightModal } from '@/components/HighlightModal'

const SPEED_KEY = 'football:speed'
const HIGHLIGHT_DISPLAY_MS = 2000

type PauseInfo = {
  state: MatchState
  reason: PauseReason
  side: Side | null
}

export default function MatchPage() {
  // refs
  const sourceRef = useRef<EventSource | null>(null)
  const resultRef = useRef<MatchResult | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // state
  const [score, setScore] = useState({ home: 0, away: 0 })
  const [minute, setMinute] = useState(0)
  const [commentary, setCommentary] = useState<CommentaryLine[]>([])
  // Latest beat's combined commentary line — what the bottom bar shows.
  const [latestLine, setLatestLine] = useState('')
  const [totals, setTotals] = useState<{ home: TeamTotals; away: TeamTotals } | null>(null)
  const [pauseInfo, setPauseInfo] = useState<PauseInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [teamNames, setTeamNames] = useState<{ home: string; away: string }>({ home: '', away: '' })
  const [connected, setConnected] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [speed, setSpeed] = useState<Speed>('default')
  const [highlight, setHighlight] = useState<HighlightFrame | null>(null)

  // hooks
  const params = useParams<{ id: string }>()
  const router = useRouter()

  // data
  const matchId = params.id
  const paused = pauseInfo !== null
  const ended = result !== null
  // Memoised so the BottomBar doesn't re-render every state change.
  const homeName = teamNames.home || (result?.homeName ?? 'Home')
  const awayName = teamNames.away || (result?.awayName ?? 'Away')

  // events
  const handlePauseClick = async () => {
    await fetch(`/api/match/${matchId}/pause`, { method: 'POST' })
  }

  const handleApply = async (decisions: MatchDecisions) => {
    const res = await fetch(`/api/match/${matchId}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decisions)
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string }
      setError(`Decision rejected: ${body.reason ?? res.statusText}`)
      return
    }
    setPauseInfo(null)
  }

  const handleSkip = () => handleApply({})

  const handleViewMore = () => setDrawerOpen(true)
  const handleNewMatch = () => router.push('/')

  const handleSpeedChange = async (next: Speed) => {
    setSpeed(next)
    window.localStorage.setItem(SPEED_KEY, next)
    // Fire-and-forget — server applies on the next beat boundary; no
    // need to block the UI.
    fetch(`/api/match/${matchId}/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: next })
    }).catch(() => {
      // ignore — match might have ended just as user clicked
    })
  }

  // effects
  // Load persisted speed preference on mount. Match was already created
  // with the home page's choice; we sync local state so the bottom bar
  // highlights the right button.
  useEffect(() => {
    const stored = window.localStorage.getItem(SPEED_KEY) as Speed | null
    if (stored && ['slow', 'default', 'fast'].includes(stored)) {
      setSpeed(stored)
    }
  }, [])

  useEffect(() => {
    if (!matchId) return
    const source = new EventSource(`/api/match/${matchId}/stream`)
    sourceRef.current = source

    source.addEventListener('open', () => setConnected(true))

    source.addEventListener('highlight', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as HighlightFrame
      setHighlight(data)
      // Auto-dismiss after 2s — same window the server is sleeping for,
      // so the modal disappears just as the next beat arrives.
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = setTimeout(() => setHighlight(null), HIGHLIGHT_DISPLAY_MS)
    })

    source.addEventListener('beat', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as BeatFrame
      setScore(data.score)
      setMinute(data.minute)
      setTotals(data.totals)
      if (data.commentary.length > 0) {
        setCommentary((prev) => [
          ...prev,
          ...data.commentary.map((text) => ({ beat: data.ev?.beat ?? 0, minute: data.minute, text }))
        ])
        // Combine multi-line beats into one ticker line for the bottom bar.
        // Trim per-line indent the engine adds (two spaces) so the joined
        // line reads as a single sentence.
        setLatestLine(data.commentary.map((l) => l.trim()).filter(Boolean).join(' '))
      }
    })

    source.addEventListener('pause', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as PauseFrame
      setPauseInfo({ state: data.state, reason: data.reason, side: data.side })
      setTeamNames({ home: data.state.homeSquad.name, away: data.state.awaySquad.name })
    })

    source.addEventListener('error', (e) => {
      const me = e as MessageEvent
      if (me.data) {
        const data = JSON.parse(me.data) as ErrorFrame
        setError(data.message)
        return
      }
      // Generic EventSource error — connection failed or server returned
      // non-200 (e.g. 404 unknown session, 410 ended session). The browser
      // closes the source automatically; surface the failure so the UI
      // doesn't sit in "Connecting…" forever.
      if (source.readyState === EventSource.CLOSED) {
        setConnected(false)
        if (!resultRef.current) {
          setError('Match unavailable. The session may have ended or been lost. Start a new match.')
        }
      }
    })

    source.addEventListener('end', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as EndFrame
      setResult(data.result)
      resultRef.current = data.result
      setTeamNames({ home: data.result.homeName, away: data.result.awayName })
      source.close()
    })

    return () => {
      source.close()
      sourceRef.current = null
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    }
  }, [matchId])

  // Pull team names from the first pause if we don't have them yet.
  useEffect(() => {
    if (teamNames.home || !pauseInfo) return
    setTeamNames({ home: pauseInfo.state.homeSquad.name, away: pauseInfo.state.awaySquad.name })
  }, [pauseInfo, teamNames.home])

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Scoreboard
        homeName={homeName}
        awayName={awayName}
        score={score}
        minute={minute}
        paused={paused}
        ended={ended}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <main className="flex-1 min-h-0 overflow-hidden">
          <MatchStats homeName={homeName} awayName={awayName} totals={totals} />
        </main>

        <aside className="bg-black/60 border-l border-white/10 w-480 flex-shrink-0 flex flex-col">
          {pauseInfo && pauseInfo.side ? (
            <DecisionPanel
              state={pauseInfo.state}
              side={pauseInfo.side}
              reason={pauseInfo.reason}
              onApply={handleApply}
              onSkip={handleSkip}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-32 text-center gap-12">
              <div className="text-3xl opacity-30">⚽</div>
              <p className="text-lg font-semibold">{ended ? 'Full time' : 'Match in play'}</p>
              <p className="text-sm opacity-60">
                {ended
                  ? 'Start a new match from the home page to play again.'
                  : 'Hit "Pause" below to make subs, change mentality, or swap formation. The panel reopens automatically on goals, half-time, red cards, and injuries.'}
              </p>
              {!connected && !ended && (
                <p className="text-xs opacity-40 mt-12">Connecting to live stream…</p>
              )}
            </div>
          )}
        </aside>
      </div>

      {error && (
        <div className="bg-red-500/30 border-t border-red-400/50 px-24 py-12 text-sm">
          {error} <button onClick={() => setError(null)} className="ml-16 underline">dismiss</button>
        </div>
      )}

      <BottomBar
        latest={latestLine}
        paused={paused}
        ended={ended}
        speed={speed}
        onPause={handlePauseClick}
        onViewMore={handleViewMore}
        onNewMatch={handleNewMatch}
        onSpeedChange={handleSpeedChange}
      />

      <CommentaryDrawer open={drawerOpen} lines={commentary} onClose={() => setDrawerOpen(false)} />
      <HighlightModal highlight={highlight} />
    </div>
  )
}

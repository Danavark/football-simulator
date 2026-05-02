'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const AUTO_PAUSE_KEY = 'football:autoPause'
const SPEED_KEY = 'football:speed'

export default function HomePage() {
  // state
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seedInput, setSeedInput] = useState('')
  const [autoPause, setAutoPause] = useState(false)

  // hooks
  const router = useRouter()

  // effects
  // Load persisted preference on mount. The toggle is treated as an
  // "account-level" setting — for now backed by localStorage, eventually
  // by a real user profile when auth lands.
  useEffect(() => {
    const stored = window.localStorage.getItem(AUTO_PAUSE_KEY)
    if (stored !== null) setAutoPause(stored === 'true')
  }, [])

  // events
  const handleAutoPauseChange = (next: boolean) => {
    setAutoPause(next)
    window.localStorage.setItem(AUTO_PAUSE_KEY, String(next))
  }

  const handleStart = async () => {
    setStarting(true)
    setError(null)
    try {
      const seed = seedInput.trim() ? parseInt(seedInput, 10) : undefined
      const speed = (window.localStorage.getItem(SPEED_KEY) as 'slow' | 'default' | 'fast' | null) ?? 'default'
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: Number.isFinite(seed) ? seed : undefined,
          autoPause,
          speed
        })
      })
      if (!res.ok) throw new Error(`server returned ${res.status}`)
      const { id } = (await res.json()) as { id: string }
      router.push(`/match/${id}`)
    } catch (e) {
      setError((e as Error).message)
      setStarting(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-32">
      <div className="max-w-480 w-full flex flex-col gap-24">
        <h1 className="text-4xl font-bold">Football Match Prototype</h1>
        <p className="text-lg opacity-80">
          Start a live match driven by the simulation engine. Beats stream in
          via SSE; you can pause any time to make subs, change mentality, or
          swap formation.
        </p>

        <label className="flex flex-col gap-8">
          <span className="text-sm uppercase opacity-60">Seed (optional)</span>
          <input
            type="text"
            inputMode="numeric"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            placeholder="random"
            className="bg-black/30 border border-white/20 rounded px-12 py-8 font-mono"
          />
        </label>

        <label className="flex items-start gap-12 cursor-pointer">
          <input
            type="checkbox"
            checked={autoPause}
            onChange={(e) => handleAutoPauseChange(e.target.checked)}
            className="mt-4 h-16 w-16 cursor-pointer accent-emerald-500"
          />
          <span className="flex flex-col gap-4">
            <span className="text-sm font-semibold">Auto-pause on key events</span>
            <span className="text-xs opacity-60">
              When on, the match pauses for decisions on goals, half-time,
              your red cards, and your injuries. When off, only the
              <span className="font-semibold"> Pause</span> button stops the
              clock. Saved to this browser.
            </span>
          </span>
        </label>

        <button
          onClick={handleStart}
          disabled={starting}
          className={`px-24 py-12 rounded font-semibold transition-colors ${
            starting ? 'bg-white/20 text-white/60' : 'bg-emerald-500 hover:bg-emerald-400 text-black'
          }`}
        >
          {starting ? 'Starting…' : 'Start match'}
        </button>

        {error && <div className="text-red-400 text-sm">Error: {error}</div>}
      </div>
    </main>
  )
}

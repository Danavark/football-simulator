'use client'

import { useEffect, useRef } from 'react'

export type CommentaryLine = {
  beat: number
  minute: number
  text: string
}

type CommentaryFeedProps = {
  lines: CommentaryLine[]
}

export function CommentaryFeed({ lines }: CommentaryFeedProps) {
  // refs
  const scrollRef = useRef<HTMLDivElement>(null)

  // effects
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-24 py-16 flex flex-col gap-8">
      {lines.length === 0 && <div className="opacity-50 text-sm">Waiting for kick-off…</div>}
      {lines.map((line, i) => (
        <div key={i} className="flex gap-12 items-baseline">
          <span className="text-xs font-mono opacity-50 w-32 flex-shrink-0">{line.minute}'</span>
          <span className="text-sm leading-relaxed">{line.text}</span>
        </div>
      ))}
    </div>
  )
}

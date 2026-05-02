'use client'

import { CommentaryFeed, type CommentaryLine } from '@/components/CommentaryFeed'

type CommentaryDrawerProps = {
  open: boolean
  lines: CommentaryLine[]
  onClose: () => void
}

// Slide-in sidebar with the full commentary feed. Closed by default —
// only opens when the user clicks "View more" on the bottom bar. Click
// the dim backdrop or the × button to close.
export function CommentaryDrawer({ open, lines, onClose }: CommentaryDrawerProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        onClick={onClose}
        className="flex-1 bg-black/50"
        role="presentation"
      />
      <aside className="w-480 max-w-full bg-black/95 border-l border-white/20 flex flex-col">
        <header className="px-24 py-16 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Commentary</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl opacity-60 hover:opacity-100 leading-none"
            aria-label="Close commentary"
          >
            ×
          </button>
        </header>
        <div className="flex-1 min-h-0">
          <CommentaryFeed lines={lines} />
        </div>
      </aside>
    </div>
  )
}

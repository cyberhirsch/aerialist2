import { useEffect, useMemo, useRef } from 'react'
import type { Word } from '../model/document'
import { defaultPaneView, useApp } from './store'

interface FeedWord {
  text: string
  pageIndex: number
  ref: Word
}

/**
 * Optimal-recognition-point index — the character the eye should land
 * on, slightly left of center (classic RSVP heuristic).
 */
function orpIndex(len: number): number {
  if (len <= 1) return 0
  if (len <= 5) return 1
  if (len <= 9) return 2
  if (len <= 13) return 3
  return 4
}

/** Display duration multiplier: long words and clause ends linger. */
function dwell(text: string): number {
  let m = 1
  if (text.length > 8) m += 0.3
  if (/[.,;:!?]$/.test(text)) m += 0.6
  return m
}

export function RsvpPane({ paneId }: { paneId: string }) {
  const { model, revision, rsvpAnchor, updatePaneView, setPage, targetEditorPaneId } = useApp()
  const view = useApp((s) => s.paneViews[paneId]) ?? defaultPaneView()
  const { wpm, playing, wordPos } = view

  const feed: FeedWord[] = useMemo(() => {
    // `revision` invalidates the memo: page ops mutate `model` in
    // place, so the model reference alone would not.
    void revision
    if (!model) return []
    return model.pages.flatMap((page, pageIndex) =>
      page.blocks.flatMap((b) =>
        b.lines.flatMap((l) =>
          l.words.map((w) => ({ text: w.text, pageIndex, ref: w })),
        ),
      ),
    )
  }, [model, revision])

  const pos = Math.min(wordPos, Math.max(0, feed.length - 1))
  const current = feed[pos] ?? null

  // jump to the word last clicked in an editor
  useEffect(() => {
    if (!rsvpAnchor) return
    const idx = feed.findIndex((f) => f.ref === rsvpAnchor.word)
    if (idx >= 0) updatePaneView(paneId, { wordPos: idx })
  }, [rsvpAnchor, feed, paneId, updatePaneView])

  // the word clock
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!playing || feed.length === 0) return
    if (pos >= feed.length - 1) {
      updatePaneView(paneId, { playing: false })
      return
    }
    const delay = (60000 / wpm) * dwell(feed[pos].text)
    timer.current = window.setTimeout(() => {
      updatePaneView(paneId, { wordPos: pos + 1 })
    }, delay)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [playing, pos, wpm, feed, paneId, updatePaneView])

  if (!model || feed.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-ink-4 select-none">
        no text to read
      </div>
    )
  }

  const pivot = current ? orpIndex(current.text.length) : 0
  const pre = current?.text.slice(0, pivot) ?? ''
  const mid = current?.text.slice(pivot, pivot + 1) ?? ''
  const post = current?.text.slice(pivot + 1) ?? ''

  const btn = 'px-1.5 text-ink-5 hover:bg-ink-2 hover:text-ink-7'

  return (
    <div className="flex h-full select-none flex-col">
      {/* display */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-2">
        <div className="text-ink-3">──────┬──────</div>
        <div className="whitespace-pre text-2xl" style={{ fontVariantLigatures: 'none' }}>
          <span className="text-ink-5">{pre.padStart(12)}</span>
          <span className="font-bold text-ink-7 underline decoration-ink-4 underline-offset-4">
            {mid}
          </span>
          <span className="text-ink-5">{post.padEnd(12)}</span>
        </div>
        <div className="text-ink-3">──────┴──────</div>
        <button
          className="text-ink-4 hover:text-ink-6"
          title="show this word's page in the editor"
          onClick={() => {
            const id = targetEditorPaneId()
            if (id && current) setPage(id, current.pageIndex)
          }}
        >
          page {current ? current.pageIndex + 1 : '–'} · word {pos + 1}/{feed.length}
        </button>
      </div>

      {/* progress (click to seek) */}
      <div
        className="mx-3 mb-2 h-2 cursor-pointer border border-ink-3"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const frac = (e.clientX - rect.left) / rect.width
          updatePaneView(paneId, {
            wordPos: Math.round(frac * (feed.length - 1)),
            playing: false,
          })
        }}
      >
        <div
          className="h-full bg-ink-4"
          style={{ width: `${feed.length > 1 ? (pos / (feed.length - 1)) * 100 : 0}%` }}
        />
      </div>

      {/* controls */}
      <div className="flex h-7 shrink-0 items-center justify-center gap-2 border-t border-ink-3 bg-ink-1">
        <button
          className={btn}
          onClick={() => updatePaneView(paneId, { wordPos: 0, playing: false })}
          title="back to start"
        >
          |«
        </button>
        <button
          className={btn}
          onClick={() => updatePaneView(paneId, { wordPos: Math.max(0, pos - 10) })}
          title="back 10 words (←)"
        >
          «
        </button>
        <button
          className={`${btn} w-10 text-center`}
          onClick={() => updatePaneView(paneId, { playing: !playing })}
          title="play/pause (space)"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          className={btn}
          onClick={() => updatePaneView(paneId, { wordPos: Math.min(feed.length - 1, pos + 10) })}
          title="forward 10 words (→)"
        >
          »
        </button>
        <span className="mx-1 text-ink-3">│</span>
        <button
          className={btn}
          onClick={() => updatePaneView(paneId, { wpm: Math.max(60, wpm - 25) })}
          title="slower (-)"
        >
          −
        </button>
        <span className="w-16 text-center tabular-nums text-ink-5">{wpm} wpm</span>
        <button
          className={btn}
          onClick={() => updatePaneView(paneId, { wpm: Math.min(1200, wpm + 25) })}
          title="faster (+)"
        >
          +
        </button>
      </div>
    </div>
  )
}

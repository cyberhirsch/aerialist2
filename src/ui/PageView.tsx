import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rect, Word } from '../model/document'
import { rectContains } from '../model/document'
import { useApp } from './store'

/** CSS position of a PDF-user-space rect at the current zoom. */
function cssRect(bbox: Rect, pageHeight: number, zoom: number) {
  return {
    left: bbox.x * zoom,
    top: (pageHeight - bbox.y - bbox.h) * zoom,
    width: bbox.w * zoom,
    height: bbox.h * zoom,
  }
}

export function PageView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { model, renderer, pageIndex, zoom, revision, editing, busy, startEdit, cancelEdit, applyEdit } =
    useApp()
  const [hovered, setHovered] = useState<Word | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  const page = model?.pages[pageIndex] ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !model) return
    let cancelled = false
    void renderer.renderPage(pageIndex, canvas, zoom).then(({ cssWidth, cssHeight }) => {
      if (!cancelled) setSize({ w: cssWidth, h: cssHeight })
    })
    return () => {
      cancelled = true
    }
  }, [model, renderer, pageIndex, zoom, revision])

  const hitTest = useCallback(
    (e: React.MouseEvent): Word | null => {
      if (!page) return null
      const rect = e.currentTarget.getBoundingClientRect()
      const px = (e.clientX - rect.left) / zoom
      const py = page.height - (e.clientY - rect.top) / zoom
      for (const block of page.blocks) {
        if (!rectContains(block.bbox, px, py)) continue
        for (const line of block.lines) {
          for (const word of line.words) {
            if (rectContains(word.bbox, px, py)) return word
          }
        }
      }
      return null
    },
    [page, zoom],
  )

  if (!model || !page) {
    return (
      <div className="flex flex-1 items-center justify-center text-ink-4 select-none">
        <pre className="leading-6">{`┌──────────────────────────────┐
│                              │
│    drop a pdf here, or use   │
│    [ open ] in the toolbar   │
│                              │
│   all processing stays in    │
│       your browser.          │
│                              │
└──────────────────────────────┘`}</pre>
      </div>
    )
  }

  const hoverCss = hovered && !editing ? cssRect(hovered.bbox, page.height, zoom) : null
  const editCss = editing ? cssRect(editing.word.bbox, page.height, zoom) : null

  return (
    <div className="flex-1 overflow-auto p-6">
      <div
        className="relative mx-auto border border-ink-3"
        style={size ? { width: size.w, height: size.h } : undefined}
        onMouseMove={(e) => {
          if (!editing) setHovered(hitTest(e))
        }}
        onMouseLeave={() => setHovered(null)}
        onClick={(e) => {
          if (busy) return
          const word = hitTest(e)
          if (word) startEdit(word)
        }}
      >
        <canvas ref={canvasRef} className="block" />

        {hoverCss && (
          <div
            className="pointer-events-none absolute border border-dashed border-ink-4 bg-ink-7/10"
            style={hoverCss}
            title={hovered?.text}
          />
        )}

        {editing && editCss && (
          <WordEditor
            key={`${editing.word.baseline}:${editing.word.bbox.x}`}
            initial={editing.word.text}
            css={editCss}
            fontSize={editing.word.fontSize * zoom}
            onCancel={cancelEdit}
            onApply={(text) => void applyEdit(text)}
          />
        )}
      </div>
    </div>
  )
}

function WordEditor({ initial, css, fontSize, onApply, onCancel }: {
  initial: string
  css: { left: number; top: number; width: number; height: number }
  fontSize: number
  onApply: (text: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onApply(value)
        else if (e.key === 'Escape') onCancel()
      }}
      onBlur={onCancel}
      className="absolute z-10 border border-ink-6 bg-ink-0 px-0.5 text-ink-7 outline-none"
      style={{
        left: css.left - 3,
        top: css.top - 3,
        width: Math.max(css.width + 60, 120),
        height: css.height + 6,
        fontSize,
      }}
    />
  )
}

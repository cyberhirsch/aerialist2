import { useCallback, useEffect, useRef, useState } from 'react'
import { groupCells } from '../engine/detect'
import type { Block, Line, Rect, Word } from '../model/document'
import { rectContains, unionRect } from '../model/document'
import { useApp, type EditMode } from './store'

/** CSS position of a PDF-user-space rect at the current zoom. */
function cssRect(bbox: Rect, pageHeight: number, zoom: number) {
  return {
    left: bbox.x * zoom,
    top: (pageHeight - bbox.y - bbox.h) * zoom,
    width: bbox.w * zoom,
    height: bbox.h * zoom,
  }
}

interface Hit {
  block: Block
  line: Line
  word: Word
}

/** What a click would actually select, after auto-mode resolution. */
type Granularity = 'word' | 'cell' | 'line' | 'block'

function resolveGranularity(hit: Hit, mode: EditMode): Granularity {
  if (mode !== 'auto') return mode
  switch (hit.block.kind) {
    case 'table':
      return 'cell'
    case 'paragraph':
      return 'block'
    default:
      return 'line'
  }
}

/** The words a granularity covers; cell = the clicked word's column group. */
function selectionWords(hit: Hit, granularity: Granularity): Word[] {
  switch (granularity) {
    case 'word':
      return [hit.word]
    case 'cell':
      return groupCells(hit.line).find((c) => c.includes(hit.word)) ?? [hit.word]
    case 'line':
      return hit.line.words
    case 'block':
      return hit.block.lines.flatMap((l) => l.words)
  }
}

function wordsBBox(words: Word[]): Rect {
  let bbox = { ...words[0].bbox }
  for (const w of words.slice(1)) bbox = unionRect(bbox, w.bbox)
  return bbox
}

const lineText = (line: Line) => line.words.map((w) => w.text).join(' ')

export function PageView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    model, renderer, pageIndex, zoom, revision, editing, editMode, busy,
    startEdit, cancelEdit, applyEdit,
  } = useApp()
  const [hovered, setHovered] = useState<Hit | null>(null)
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
    (e: React.MouseEvent): Hit | null => {
      if (!page) return null
      const rect = e.currentTarget.getBoundingClientRect()
      const px = (e.clientX - rect.left) / zoom
      const py = page.height - (e.clientY - rect.top) / zoom
      for (const block of page.blocks) {
        if (!rectContains(block.bbox, px, py)) continue
        for (const line of block.lines) {
          for (const word of line.words) {
            if (rectContains(word.bbox, px, py)) return { block, line, word }
          }
        }
      }
      return null
    },
    [page, zoom],
  )

  const beginEdit = useCallback(
    (hit: Hit) => {
      const granularity = resolveGranularity(hit, editMode)
      const words = selectionWords(hit, granularity)
      const first = words[0]

      if (granularity === 'block') {
        const { block } = hit
        const leading =
          block.lines.length >= 2
            ? Math.abs(block.lines[0].baseline - block.lines[1].baseline)
            : first.fontSize * 1.25
        startEdit({
          target: {
            glyphs: words.flatMap((w) => w.glyphs),
            fontRes: first.fontRes,
            fontSize: first.fontSize,
          },
          initial: block.lines.map(lineText).join(' '),
          bbox: block.bbox,
          multiline: true,
          layout: { maxWidth: block.bbox.w + 2, leading },
        })
        return
      }

      startEdit({
        target: {
          glyphs: words.flatMap((w) => w.glyphs),
          fontRes: first.fontRes,
          fontSize: first.fontSize,
        },
        initial: words.map((w) => w.text).join(' '),
        bbox: granularity === 'line' ? hit.line.bbox : wordsBBox(words),
        multiline: false,
      })
    },
    [editMode, startEdit],
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

  let hoverCss: ReturnType<typeof cssRect> | null = null
  let hoverTag: string | null = null
  if (hovered && !editing) {
    const granularity = resolveGranularity(hovered, editMode)
    const bbox =
      granularity === 'block'
        ? hovered.block.bbox
        : granularity === 'line'
          ? hovered.line.bbox
          : wordsBBox(selectionWords(hovered, granularity))
    hoverCss = cssRect(bbox, page.height, zoom)
    hoverTag = editMode === 'auto' ? (granularity === 'block' ? 'para' : granularity) : null
  }
  const editCss = editing ? cssRect(editing.bbox, page.height, zoom) : null

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
          const hit = hitTest(e)
          if (hit) beginEdit(hit)
        }}
      >
        <canvas ref={canvasRef} className="block" />

        {hoverCss && (
          <div
            className="pointer-events-none absolute border border-dashed border-ink-4 bg-ink-7/10"
            style={hoverCss}
          >
            {hoverTag && (
              <span className="absolute -top-4 left-0 bg-ink-1 px-1 text-[10px] leading-4 text-ink-5">
                {hoverTag}
              </span>
            )}
          </div>
        )}

        {editing && editCss && (
          <SpanEditor
            key={`${editing.bbox.x}:${editing.bbox.y}:${editMode}`}
            initial={editing.initial}
            css={editCss}
            fontSize={Math.min(editing.target.fontSize * zoom, 24)}
            multiline={editing.multiline}
            onCancel={cancelEdit}
            onApply={(text) => void applyEdit(text)}
          />
        )}
      </div>
    </div>
  )
}

function SpanEditor({ initial, css, fontSize, multiline, onApply, onCancel }: {
  initial: string
  css: { left: number; top: number; width: number; height: number }
  fontSize: number
  multiline: boolean
  onApply: (text: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onApply(value)
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  const common = {
    ref,
    value,
    spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(e.target.value),
    onKeyDown,
    onBlur: onCancel,
    className:
      'absolute z-10 resize-none border border-ink-6 bg-ink-0 px-0.5 text-ink-7 outline-none',
  }

  if (multiline) {
    return (
      <textarea
        {...common}
        style={{
          left: css.left - 3,
          top: css.top - 3,
          width: Math.max(css.width + 8, 160),
          height: Math.max(css.height + 8, fontSize * 2.5),
          fontSize,
          lineHeight: 1.35,
        }}
      />
    )
  }
  return (
    <input
      {...common}
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

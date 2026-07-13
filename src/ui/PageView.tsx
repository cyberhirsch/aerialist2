import { useCallback, useEffect, useRef, useState } from 'react'
import type { Block, Line, Rect, Word } from '../model/document'
import { rectContains } from '../model/document'
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

function hitBBox(hit: Hit, mode: EditMode): Rect {
  return mode === 'word' ? hit.word.bbox : mode === 'line' ? hit.line.bbox : hit.block.bbox
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
      if (editMode === 'word') {
        const { word } = hit
        startEdit({
          target: { glyphs: word.glyphs, fontRes: word.fontRes, fontSize: word.fontSize },
          initial: word.text,
          bbox: word.bbox,
          multiline: false,
        })
        return
      }
      if (editMode === 'line') {
        const { line } = hit
        const first = line.words[0]
        startEdit({
          target: {
            glyphs: line.words.flatMap((w) => w.glyphs),
            fontRes: first.fontRes,
            fontSize: first.fontSize,
          },
          initial: lineText(line),
          bbox: line.bbox,
          multiline: false,
        })
        return
      }
      const { block } = hit
      const first = block.lines[0].words[0]
      const leading =
        block.lines.length >= 2
          ? Math.abs(block.lines[0].baseline - block.lines[1].baseline)
          : first.fontSize * 1.25
      startEdit({
        target: {
          glyphs: block.lines.flatMap((l) => l.words.flatMap((w) => w.glyphs)),
          fontRes: first.fontRes,
          fontSize: first.fontSize,
        },
        initial: block.lines.map(lineText).join(' '),
        bbox: block.bbox,
        multiline: true,
        layout: { maxWidth: block.bbox.w + 2, leading },
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

  const hoverCss =
    hovered && !editing ? cssRect(hitBBox(hovered, editMode), page.height, zoom) : null
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
          />
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

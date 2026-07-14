import { useCallback, useEffect, useRef, useState } from 'react'
import { groupCells } from '../engine/detect'
import { apply, invert, type Matrix } from '../engine/matrix'
import type { Block, Line, Rect, Word } from '../model/document'
import { rectContains, unionRect } from '../model/document'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { defaultPaneView, useApp, type EditMode } from './store'

/**
 * CSS position of a PDF-user-space rect under the page's render
 * transform (which accounts for zoom, y-flip, and page rotation).
 */
function cssRect(bbox: Rect, pdfToCss: Matrix) {
  const corners = [
    apply(pdfToCss, bbox.x, bbox.y),
    apply(pdfToCss, bbox.x + bbox.w, bbox.y),
    apply(pdfToCss, bbox.x, bbox.y + bbox.h),
    apply(pdfToCss, bbox.x + bbox.w, bbox.y + bbox.h),
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
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

export function EditorPane({ paneId }: { paneId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    model, renderer, revision, editing, editMode, busy,
    history, historyIndex,
    startEdit, cancelEdit, applyEdit, undo, redo, exportPdf, setStatus,
  } = useApp()
  const view = useApp((s) => s.paneViews[paneId]) ?? defaultPaneView()
  const { pageIndex, zoom } = view
  const [hovered, setHovered] = useState<Hit | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [pdfToCss, setPdfToCss] = useState<Matrix | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hit: Hit | null } | null>(null)

  const page = model?.pages[pageIndex] ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !model) return
    let cancelled = false
    renderer
      .renderPage(pageIndex, canvas, zoom)
      .then(({ cssWidth, cssHeight, pdfToCss }) => {
        if (cancelled) return
        setSize({ w: cssWidth, h: cssHeight })
        setPdfToCss(pdfToCss as Matrix)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [model, renderer, pageIndex, zoom, revision])

  const hitTest = useCallback(
    (e: React.MouseEvent): Hit | null => {
      if (!page || !pdfToCss) return null
      const rect = e.currentTarget.getBoundingClientRect()
      const [px, py] = apply(
        invert(pdfToCss),
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
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
    [page, pdfToCss],
  )

  const beginEdit = useCallback(
    (hit: Hit, override?: Granularity) => {
      const granularity = override ?? resolveGranularity(hit, editMode)
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
          pageIndex,
          paneId,
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
        pageIndex,
        paneId,
        multiline: false,
      })
    },
    [editMode, startEdit, pageIndex, paneId],
  )

  const copyText = useCallback(
    (text: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => setStatus(`copied "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`))
        .catch(() => setStatus('copy failed — clipboard unavailable'))
    },
    [setStatus],
  )

  const menuItems = useCallback(
    (hit: Hit | null): MenuItem[] => {
      const items: MenuItem[] = []
      if (hit && !busy) {
        const cellWords = selectionWords(hit, 'cell')
        const blockText = hit.block.lines.map(lineText).join(' ')
        items.push({ label: `edit word "${hit.word.text.slice(0, 16)}"`, action: () => beginEdit(hit, 'word') })
        if (hit.block.kind === 'table' && cellWords.length > 1) {
          items.push({ label: 'edit cell', action: () => beginEdit(hit, 'cell') })
        }
        items.push({ label: 'edit line', action: () => beginEdit(hit, 'line') })
        if (hit.block.kind === 'paragraph') {
          items.push({ label: 'edit paragraph (reflow)', action: () => beginEdit(hit, 'block') })
        }
        items.push({ separator: true, label: '' })
        items.push({ label: 'copy word', action: () => copyText(hit.word.text) })
        items.push({ label: 'copy line', action: () => copyText(lineText(hit.line)) })
        if (hit.block.lines.length > 1) {
          items.push({ label: 'copy block text', action: () => copyText(blockText) })
        }
        items.push({ separator: true, label: '' })
      }
      items.push({ label: 'undo    ctrl+z', action: () => void undo(), disabled: busy || historyIndex <= 0 })
      items.push({ label: 'redo    ctrl+y', action: () => void redo(), disabled: busy || historyIndex >= history.length - 1 })
      items.push({ separator: true, label: '' })
      items.push({ label: 'export pdf', action: () => void exportPdf(), disabled: busy })
      return items
    },
    [busy, beginEdit, copyText, undo, redo, exportPdf, history, historyIndex],
  )

  if (!model || !page) {
    return (
      <div className="flex h-full items-center justify-center text-ink-4 select-none">
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

  const paneEditing = editing && editing.paneId === paneId ? editing : null
  let hoverCss: ReturnType<typeof cssRect> | null = null
  let hoverTag: string | null = null
  if (hovered && !paneEditing && pdfToCss) {
    const granularity = resolveGranularity(hovered, editMode)
    const bbox =
      granularity === 'block'
        ? hovered.block.bbox
        : granularity === 'line'
          ? hovered.line.bbox
          : wordsBBox(selectionWords(hovered, granularity))
    hoverCss = cssRect(bbox, pdfToCss)
    hoverTag = editMode === 'auto' ? (granularity === 'block' ? 'para' : granularity) : null
  }
  const editCss = paneEditing && pdfToCss ? cssRect(paneEditing.bbox, pdfToCss) : null

  return (
    <div className="h-full overflow-auto p-6">
      <div
        className="relative mx-auto border border-ink-3"
        style={size ? { width: size.w, height: size.h } : undefined}
        onMouseMove={(e) => {
          if (!paneEditing) setHovered(hitTest(e))
        }}
        onMouseLeave={() => setHovered(null)}
        onClick={(e) => {
          if (busy) return
          const hit = hitTest(e)
          if (hit) beginEdit(hit)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, hit: hitTest(e) })
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

        {paneEditing && editCss && (
          <SpanEditor
            key={`${paneEditing.bbox.x}:${paneEditing.bbox.y}:${editMode}`}
            initial={paneEditing.initial}
            css={editCss}
            fontSize={Math.min(paneEditing.target.fontSize * zoom, 24)}
            multiline={paneEditing.multiline}
            onCancel={cancelEdit}
            onApply={(text) => void applyEdit(text)}
          />
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.hit)}
          onClose={() => setMenu(null)}
        />
      )}
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

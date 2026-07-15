import { useCallback, useEffect, useRef, useState } from 'react'
import { groupCells } from '../engine/detect'
import { apply, invert, pageViewportTransform, rectToCssBox as cssRect } from '../engine/matrix'
import type { Block, Line, Rect, Word } from '../model/document'
import { rectContains, unionRect } from '../model/document'
import { CommentOverlay } from './CommentOverlay'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FormFieldOverlay } from './FormFieldOverlay'
import { SignaturePlacer } from './SignaturePlacer'
import { defaultPaneView, useApp, type EditMode } from './store'

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

/** Must match the scroll container's `p-6` padding (1.5rem = 24px per side). */
const EDITOR_PAD = 24

export function EditorPane({ paneId }: { paneId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    model, renderer, revision, editing, busy, placement,
    history, historyIndex, searchMatches, searchIndex,
    commentPlacementActive, openCommentEditor,
    startEdit, cancelEdit, applyEdit, undo, redo, exportPdf, setStatus, setPage,
    updatePaneView,
  } = useApp()
  const view = useApp((s) => s.paneViews[paneId]) ?? defaultPaneView()
  const { pageIndex, zoom, fitMode, editMode } = view
  const [hovered, setHovered] = useState<Hit | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hit: Hit | null } | null>(null)
  const currentMatchRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastPageFlipRef = useRef(0)
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null)

  const page = model?.pages[pageIndex] ?? null

  // geometry is synchronous — hit-testing and overlays never wait on
  // the async canvas paint below
  const viewport = page
    ? pageViewportTransform(page.width, page.height, page.rotation, zoom)
    : null
  const pdfToCss = viewport?.transform ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !model) return
    renderer.renderPage(pageIndex, canvas, zoom).catch((err: unknown) => {
      // superseded renders (document reloaded mid-render) are expected;
      // anything else should be visible during development
      console.warn('renderPage failed:', err)
    })
  }, [model, renderer, pageIndex, zoom, revision])

  // keep the active search match visible when it lands on this page
  useEffect(() => {
    currentMatchRef.current?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [searchIndex, pageIndex])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // recompute zoom to satisfy the active fit mode whenever the pane
  // resizes or the page's (rotation-adjusted) dimensions change.
  // Reads live clientWidth/clientHeight off the ref (not the
  // ResizeObserver-derived containerSize state) so it applies
  // immediately on a fit-mode toggle rather than waiting on the
  // observer's next callback; containerSize is still a dependency so
  // an actual pane resize re-triggers this.
  useEffect(() => {
    const el = scrollRef.current
    if (!fitMode || !page || !el) return
    const base = pageViewportTransform(page.width, page.height, page.rotation, 1)
    const availW = Math.max(40, el.clientWidth - EDITOR_PAD * 2)
    const availH = Math.max(40, el.clientHeight - EDITOR_PAD * 2)
    const target =
      fitMode === 'actual'
        ? 1
        : fitMode === 'width'
          ? availW / base.cssWidth
          : Math.min(availW / base.cssWidth, availH / base.cssHeight)
    const clamped = Math.max(0.1, Math.min(8, target))
    if (Math.abs(clamped - zoom) > 0.005) updatePaneView(paneId, { zoom: clamped })
  }, [fitMode, containerSize, page, paneId, updatePaneView, zoom])

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

  /** PDF-space point under the cursor, for comment placement. */
  const hitPoint = useCallback(
    (e: React.MouseEvent): { x: number; y: number } | null => {
      if (!pdfToCss) return null
      const rect = e.currentTarget.getBoundingClientRect()
      const [x, y] = apply(invert(pdfToCss), e.clientX - rect.left, e.clientY - rect.top)
      return { x, y }
    },
    [pdfToCss],
  )

  /**
   * Scrolling past the bottom edge advances to the next page (and
   * resets scroll to the top); past the top edge goes to the previous
   * page. A cooldown prevents one continued scroll/trackpad gesture
   * from skipping multiple pages.
   */
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (busy || placement || commentPlacementActive) return
      if (editing && editing.paneId === paneId) return
      const el = scrollRef.current
      if (!el || !model) return
      if (Date.now() - lastPageFlipRef.current < 500) return

      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      const atTop = el.scrollTop <= 2

      if (e.deltaY > 10 && atBottom && pageIndex < model.pages.length - 1) {
        lastPageFlipRef.current = Date.now()
        setPage(paneId, pageIndex + 1)
        // 0 is always a valid scroll position, so this doesn't need to
        // wait for the next page's render to commit
        el.scrollTop = 0
      } else if (e.deltaY < -10 && atTop && pageIndex > 0) {
        lastPageFlipRef.current = Date.now()
        setPage(paneId, pageIndex - 1)
        // an oversized value clamps to the true max scroll position,
        // sidestepping the same not-yet-rendered timing issue
        el.scrollTop = Number.MAX_SAFE_INTEGER
      }
    },
    [busy, placement, commentPlacementActive, editing, paneId, model, pageIndex, setPage],
  )

  const setRsvpAnchor = useApp((s) => s.setRsvpAnchor)

  const beginEdit = useCallback(
    (hit: Hit, override?: Granularity) => {
      const granularity = override ?? resolveGranularity(hit, editMode)
      const words = selectionWords(hit, granularity)
      const first = words[0]
      setRsvpAnchor(hit.word)

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
    [editMode, startEdit, pageIndex, paneId, setRsvpAnchor],
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
  const pageMatches = pdfToCss
    ? searchMatches
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.pageIndex === pageIndex)
    : []

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto p-6"
      style={{ overflowAnchor: 'none' }}
      onWheel={onWheel}
    >
      <div
        className={
          'relative mx-auto border border-ink-3' +
          (commentPlacementActive ? ' cursor-crosshair' : '')
        }
        style={viewport ? { width: viewport.cssWidth, height: viewport.cssHeight } : undefined}
        onMouseMove={(e) => {
          if (!paneEditing && !commentPlacementActive) setHovered(hitTest(e))
        }}
        onMouseLeave={() => setHovered(null)}
        onClick={(e) => {
          if (busy) return
          if (commentPlacementActive) {
            const point = hitPoint(e)
            if (point) openCommentEditor(paneId, pageIndex, point)
            return
          }
          const hit = hitTest(e)
          if (hit) beginEdit(hit)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (commentPlacementActive) return
          setMenu({ x: e.clientX, y: e.clientY, hit: hitTest(e) })
        }}
      >
        <canvas ref={canvasRef} className="block" />

        {pdfToCss &&
          page.formFields.map((field) => (
            <FormFieldOverlay
              key={field.name + (field.optionValue ?? '')}
              field={field}
              css={cssRect(field.rect, pdfToCss)}
              fontSize={Math.min(field.rect.h * zoom * 0.7, 16)}
              pageIndex={pageIndex}
            />
          ))}

        {pdfToCss &&
          pageMatches.map(({ m, i }) => (
            <div
              key={i}
              ref={i === searchIndex ? currentMatchRef : undefined}
              className={
                i === searchIndex
                  ? 'pointer-events-none absolute border-2 border-ink-7 bg-ink-6/40'
                  : 'pointer-events-none absolute border border-ink-5 bg-ink-6/15'
              }
              style={cssRect(m.bbox, pdfToCss)}
            />
          ))}

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

        {pdfToCss && <SignaturePlacer paneId={paneId} pdfToCss={pdfToCss} />}
        {pdfToCss && <CommentOverlay paneId={paneId} pageIndex={pageIndex} pdfToCss={pdfToCss} />}
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

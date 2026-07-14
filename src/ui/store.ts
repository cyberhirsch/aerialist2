/**
 * App state, split in two:
 *  - document state (host, model, history) — one instance, shared
 *  - per-pane view state (page, zoom, rsvp position) — keyed by pane id
 * The workspace layout tree lives here too. `revision` bumps whenever
 * the document content changes.
 */

import { create } from 'zustand'
import type { Rect } from '../model/document'
import { loadDocumentModel } from '../model/buildModel'
import { replaceSpanText, type LayoutOpts, type SpanTarget } from '../model/editText'
import {
  deletePage,
  duplicatePage,
  insertDocumentAt,
  movePage,
  rotatePage,
} from '../model/pageOps'
import type { PdfHost } from '../pdf/pdflibHost'
import { Renderer } from '../pdf/pdfjsRender'
import {
  closePane,
  defaultLayout,
  firstPaneOfKind,
  findPane,
  listPanes,
  loadLayout,
  saveLayout,
  setPaneKind,
  setRatio,
  splitPane,
  type LayoutNode,
  type PaneKind,
} from './workspace'

export type EditMode = 'auto' | 'word' | 'line' | 'block'

export interface EditingState {
  target: SpanTarget
  /** Text prefilled in the editor. */
  initial: string
  bbox: Rect
  pageIndex: number
  /** Pane the edit began in — the overlay renders only there. */
  paneId: string
  /** Paragraph edits use a textarea and reflow on apply. */
  multiline: boolean
  layout?: LayoutOpts
}

export interface PaneView {
  pageIndex: number
  zoom: number
  /** rsvp */
  wpm: number
  playing: boolean
  wordPos: number
}

export const defaultPaneView = (): PaneView => ({
  pageIndex: 0,
  zoom: 1.25,
  wpm: 300,
  playing: false,
  wordPos: 0,
})

interface AppState {
  fileName: string | null
  host: PdfHost | null
  model: import('../model/document').DocumentModel | null
  renderer: Renderer
  revision: number
  status: string
  editing: EditingState | null
  editMode: EditMode
  busy: boolean
  helpOpen: boolean
  /** Saved document snapshots; historyIndex points at the current one. */
  history: Uint8Array[]
  historyIndex: number
  /** historyIndex at the last export — differing means unexported edits. */
  exportedIndex: number
  /** A file waiting on the export/discard/cancel decision. */
  pendingOpen: { name: string; bytes: Uint8Array } | null

  layout: LayoutNode
  focusedPaneId: string | null
  paneViews: Record<string, PaneView>

  paneView(id: string): PaneView
  updatePaneView(id: string, patch: Partial<PaneView>): void
  focusPane(id: string): void
  splitPaneAction(id: string, dir: 'row' | 'col'): void
  closePaneAction(id: string): void
  setPaneKindAction(id: string, kind: PaneKind): void
  setPaneRatio(id: string, ratio: number): void
  resetLayout(): void
  /** The editor pane keyboard/toolbar actions should target. */
  targetEditorPaneId(): string | null

  isDirty(): boolean
  requestOpen(name: string, bytes: Uint8Array): Promise<void>
  resolvePendingOpen(choice: 'export' | 'discard' | 'cancel'): Promise<void>

  movePageAction(from: number, to: number): Promise<void>
  deletePageAction(index: number): Promise<void>
  duplicatePageAction(index: number): Promise<void>
  rotatePageAction(index: number, deltaDegrees: number): Promise<void>
  mergeDocumentAt(name: string, bytes: Uint8Array, at: number): Promise<void>
  openFile(name: string, bytes: Uint8Array): Promise<void>
  setPage(paneId: string, index: number): void
  setZoom(paneId: string, zoom: number): void
  setEditMode(mode: EditMode): void
  startEdit(editing: Omit<EditingState, 'pageIndex'> & { pageIndex: number }): void
  cancelEdit(): void
  applyEdit(newText: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  exportPdf(): Promise<void>
  toggleHelp(): void
  setStatus(msg: string): void
}

/** Cap on kept snapshots — one full PDF per edit. */
const HISTORY_LIMIT = 30

export const useApp = create<AppState>((set, get) => {
  /** Move historyIndex by `dir` and restore that document snapshot. */
  const restoreSnapshot = async (dir: -1 | 1, verb: string) => {
    const { history, historyIndex, renderer, busy } = get()
    const nextIndex = historyIndex + dir
    if (busy || nextIndex < 0 || nextIndex >= history.length) return
    set({ busy: true, editing: null, status: `${verb} …` })
    try {
      const bytes = history[nextIndex]
      const { host, model } = await loadDocumentModel(bytes)
      await renderer.load(bytes)
      set((s) => ({
        host,
        model,
        busy: false,
        historyIndex: nextIndex,
        paneViews: clampViews(s.paneViews, model.pages.length),
        revision: s.revision + 1,
        status: `${verb} (${nextIndex + 1}/${history.length} states)`,
      }))
    } catch (err) {
      set({ busy: false, status: `error: ${(err as Error).message}` })
    }
  }

  const persistLayout = (layout: LayoutNode) => {
    saveLayout(layout)
    return layout
  }

  /** Run a structural page op, then snapshot + re-render + announce. */
  const commitStructural = async (mutate: () => Promise<string> | string) => {
    const { host, model, renderer, busy } = get()
    if (!host || !model || busy) return
    set({ busy: true, editing: null })
    try {
      const message = await mutate()
      const bytes = await host.save()
      await renderer.load(bytes)
      set((s) => {
        const history = [...s.history.slice(0, s.historyIndex + 1), bytes].slice(
          -HISTORY_LIMIT,
        )
        return {
          busy: false,
          revision: s.revision + 1,
          history,
          historyIndex: history.length - 1,
          paneViews: clampViews(s.paneViews, model.pages.length),
          status: message,
        }
      })
    } catch (err) {
      set({ busy: false, status: `error: ${(err as Error).message}` })
    }
  }

  return {
    fileName: null,
    host: null,
    model: null,
    renderer: new Renderer(),
    revision: 0,
    status: 'open a pdf to begin',
    editing: null,
    editMode: 'auto',
    busy: false,
    helpOpen: false,
    history: [],
    historyIndex: -1,
    exportedIndex: -1,
    pendingOpen: null,

    layout: loadLayout() ?? defaultLayout(),
    focusedPaneId: null,
    paneViews: {},

    paneView(id) {
      return get().paneViews[id] ?? defaultPaneView()
    },

    updatePaneView(id, patch) {
      set((s) => ({
        paneViews: { ...s.paneViews, [id]: { ...(s.paneViews[id] ?? defaultPaneView()), ...patch } },
      }))
    },

    focusPane(id) {
      if (get().focusedPaneId !== id) set({ focusedPaneId: id })
    },

    splitPaneAction(id, dir) {
      set((s) => ({ layout: persistLayout(splitPane(s.layout, id, dir)) }))
    },

    closePaneAction(id) {
      set((s) => {
        if (listPanes(s.layout).length <= 1) return s
        const layout = persistLayout(closePane(s.layout, id))
        return {
          layout,
          focusedPaneId: s.focusedPaneId === id ? null : s.focusedPaneId,
          editing: s.editing?.paneId === id ? null : s.editing,
        }
      })
    },

    setPaneKindAction(id, kind) {
      set((s) => ({
        layout: persistLayout(setPaneKind(s.layout, id, kind)),
        editing: s.editing?.paneId === id ? null : s.editing,
      }))
    },

    setPaneRatio(id, ratio) {
      set((s) => ({ layout: persistLayout(setRatio(s.layout, id, ratio)) }))
    },

    resetLayout() {
      set({ layout: persistLayout(defaultLayout()), focusedPaneId: null })
    },

    targetEditorPaneId() {
      const { layout, focusedPaneId } = get()
      if (focusedPaneId) {
        const focused = findPane(layout, focusedPaneId)
        if (focused?.kind === 'editor') return focused.id
      }
      return firstPaneOfKind(layout, 'editor')?.id ?? null
    },

    isDirty() {
      const { historyIndex, exportedIndex } = get()
      return historyIndex >= 0 && historyIndex !== exportedIndex
    },

    async requestOpen(name, bytes) {
      if (get().isDirty()) {
        set({ pendingOpen: { name, bytes } })
        return
      }
      await get().openFile(name, bytes)
    },

    async resolvePendingOpen(choice) {
      const pending = get().pendingOpen
      if (!pending) return
      if (choice === 'cancel') {
        set({ pendingOpen: null, status: 'open cancelled' })
        return
      }
      if (choice === 'export') {
        await get().exportPdf()
      }
      set({ pendingOpen: null })
      await get().openFile(pending.name, pending.bytes)
    },

    async movePageAction(from, to) {
      if (from === to) return
      await commitStructural(() => {
        movePage(get().host!, get().model!, from, to)
        return `page ${from + 1} moved to position ${to + 1}`
      })
    },

    async deletePageAction(index) {
      const { model } = get()
      if (!model || model.pages.length <= 1) {
        set({ status: 'cannot delete the only page' })
        return
      }
      await commitStructural(() => {
        deletePage(get().host!, get().model!, index)
        return `page ${index + 1} deleted`
      })
    },

    async duplicatePageAction(index) {
      await commitStructural(async () => {
        await duplicatePage(get().host!, get().model!, index)
        return `page ${index + 1} duplicated`
      })
    },

    async rotatePageAction(index, deltaDegrees) {
      await commitStructural(() => {
        rotatePage(get().host!, get().model!, index, deltaDegrees)
        return `page ${index + 1} rotated ${deltaDegrees > 0 ? '⟳' : '⟲'}`
      })
    },

    async mergeDocumentAt(name, bytes, at) {
      await commitStructural(async () => {
        const { count, hasForms } = await insertDocumentAt(
          get().host!,
          get().model!,
          bytes,
          at,
        )
        return `merged ${name}: ${count} page(s) inserted at position ${at + 1}${
          hasForms ? ' — note: its form fields may not survive the merge' : ''
        }`
      })
    },

    async openFile(name, bytes) {
      set({ busy: true, status: `parsing ${name} …` })
      try {
        const { host, model } = await loadDocumentModel(bytes)
        await get().renderer.load(bytes)
        const words = model.pages.reduce(
          (n, p) =>
            n + p.blocks.reduce(
              (m, b) => m + b.lines.reduce((k, l) => k + l.words.length, 0),
              0,
            ),
          0,
        )
        set((s) => ({
          fileName: name,
          host,
          model,
          editing: null,
          revision: s.revision + 1,
          busy: false,
          history: [bytes],
          historyIndex: 0,
          exportedIndex: 0,
          paneViews: resetViews(s.paneViews),
          status: `${name} — ${model.pages.length} page(s), ${words} words detected. click a word to edit; ? for shortcuts.`,
        }))
      } catch (err) {
        set({ busy: false, status: `error: ${(err as Error).message}` })
      }
    },

    setPage(paneId, index) {
      const { model } = get()
      if (!model) return
      const clamped = Math.max(0, Math.min(model.pages.length - 1, index))
      get().updatePaneView(paneId, { pageIndex: clamped })
      set((s) => ({ editing: s.editing?.paneId === paneId ? null : s.editing }))
    },

    setZoom(paneId, zoom) {
      get().updatePaneView(paneId, { zoom: Math.max(0.25, Math.min(4, zoom)) })
      set((s) => ({ editing: s.editing?.paneId === paneId ? null : s.editing }))
    },

    setEditMode(mode) {
      set({ editMode: mode, editing: null })
    },

    startEdit(editing) {
      set({ editing })
    },

    cancelEdit() {
      set({ editing: null })
    },

    async applyEdit(newText) {
      const { host, model, editing, renderer } = get()
      if (!host || !model || !editing) return
      const trimmed = newText.replace(/\s+/g, ' ').trim()
      if (trimmed === editing.initial || trimmed.length === 0) {
        set({ editing: null })
        return
      }
      set({ busy: true, status: 'rewriting content stream …' })
      try {
        const outcome = await replaceSpanText(
          host,
          model,
          editing.pageIndex,
          editing.target,
          trimmed,
          editing.layout,
        )
        if (!outcome.ok) {
          set({ busy: false, editing: null, status: `edit failed: ${outcome.reason}` })
          return
        }
        const bytes = await host.save()
        await renderer.load(bytes)
        const summary =
          editing.initial.length > 24
            ? `${editing.initial.slice(0, 24)}…`
            : editing.initial
        const notes = [
          outcome.lineCount > 1 ? `rewrapped to ${outcome.lineCount} lines` : null,
          outcome.usedFallbackFont ? 'replacement font embedded' : null,
        ].filter(Boolean)
        set((s) => {
          const history = [...s.history.slice(0, s.historyIndex + 1), bytes].slice(
            -HISTORY_LIMIT,
          )
          return {
            busy: false,
            editing: null,
            revision: s.revision + 1,
            history,
            historyIndex: history.length - 1,
            status: `"${summary}" replaced — content stream rewritten${notes.length ? ` (${notes.join(', ')})` : ''}`,
          }
        })
      } catch (err) {
        set({ busy: false, editing: null, status: `error: ${(err as Error).message}` })
      }
    },

    async undo() {
      await restoreSnapshot(-1, 'undone')
    },

    async redo() {
      await restoreSnapshot(1, 'redone')
    },

    toggleHelp() {
      set((s) => ({ helpOpen: !s.helpOpen }))
    },

    async exportPdf() {
      const { host, fileName } = get()
      if (!host) return
      set({ busy: true, status: 'exporting …' })
      try {
        const bytes = await host.save()
        const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = (fileName ?? 'document.pdf').replace(/\.pdf$/i, '') + '_edited.pdf'
        a.click()
        URL.revokeObjectURL(url)
        set((s) => ({ busy: false, exportedIndex: s.historyIndex, status: `exported ${a.download}` }))
      } catch (err) {
        set({ busy: false, status: `export error: ${(err as Error).message}` })
      }
    },

    setStatus(msg) {
      set({ status: msg })
    },
  }
})

function clampViews(
  views: Record<string, PaneView>,
  pageCount: number,
): Record<string, PaneView> {
  const out: Record<string, PaneView> = {}
  for (const [id, v] of Object.entries(views)) {
    out[id] = { ...v, pageIndex: Math.min(v.pageIndex, Math.max(0, pageCount - 1)) }
  }
  return out
}

function resetViews(views: Record<string, PaneView>): Record<string, PaneView> {
  const out: Record<string, PaneView> = {}
  for (const [id, v] of Object.entries(views)) {
    out[id] = { ...v, pageIndex: 0, wordPos: 0, playing: false }
  }
  return out
}

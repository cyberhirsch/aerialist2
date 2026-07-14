/**
 * App state. The document model + host live here as mutable refs;
 * `revision` bumps whenever the model or rendered bytes change.
 */

import { create } from 'zustand'
import type { DocumentModel, Rect } from '../model/document'
import { loadDocumentModel } from '../model/buildModel'
import { replaceSpanText, type LayoutOpts, type SpanTarget } from '../model/editText'
import type { PdfHost } from '../pdf/pdflibHost'
import { Renderer } from '../pdf/pdfjsRender'

export type EditMode = 'auto' | 'word' | 'line' | 'block'

export interface EditingState {
  target: SpanTarget
  /** Text prefilled in the editor. */
  initial: string
  bbox: Rect
  pageIndex: number
  /** Paragraph edits use a textarea and reflow on apply. */
  multiline: boolean
  layout?: LayoutOpts
}

interface AppState {
  fileName: string | null
  host: PdfHost | null
  model: DocumentModel | null
  renderer: Renderer
  pageIndex: number
  zoom: number
  revision: number
  status: string
  editing: EditingState | null
  editMode: EditMode
  busy: boolean
  helpOpen: boolean
  /** Saved document snapshots; historyIndex points at the current one. */
  history: Uint8Array[]
  historyIndex: number

  openFile(name: string, bytes: Uint8Array): Promise<void>
  setPage(index: number): void
  setZoom(zoom: number): void
  setEditMode(mode: EditMode): void
  startEdit(editing: Omit<EditingState, 'pageIndex'>): void
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
    const { history, historyIndex, renderer, busy, pageIndex } = get()
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
        pageIndex: Math.min(pageIndex, model.pages.length - 1),
        revision: s.revision + 1,
        status: `${verb} (${nextIndex + 1}/${history.length} states)`,
      }))
    } catch (err) {
      set({ busy: false, status: `error: ${(err as Error).message}` })
    }
  }

  return {
  fileName: null,
  host: null,
  model: null,
  renderer: new Renderer(),
  pageIndex: 0,
  zoom: 1.25,
  revision: 0,
  status: 'open a pdf to begin',
  editing: null,
  editMode: 'auto',
  busy: false,
  helpOpen: false,
  history: [],
  historyIndex: -1,

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
        pageIndex: 0,
        editing: null,
        revision: s.revision + 1,
        busy: false,
        history: [bytes],
        historyIndex: 0,
        status: `${name} — ${model.pages.length} page(s), ${words} words detected. click a word to edit; ? for shortcuts.`,
      }))
    } catch (err) {
      set({ busy: false, status: `error: ${(err as Error).message}` })
    }
  },

  setPage(index) {
    const { model } = get()
    if (!model) return
    const clamped = Math.max(0, Math.min(model.pages.length - 1, index))
    set({ pageIndex: clamped, editing: null })
  },

  setZoom(zoom) {
    set({ zoom: Math.max(0.25, Math.min(4, zoom)), editing: null })
  },

  setEditMode(mode) {
    set({ editMode: mode, editing: null })
  },

  startEdit(editing) {
    set({ editing: { ...editing, pageIndex: get().pageIndex } })
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
      set({ busy: false, status: `exported ${a.download}` })
    } catch (err) {
      set({ busy: false, status: `export error: ${(err as Error).message}` })
    }
  },

  setStatus(msg) {
    set({ status: msg })
  },
  }
})

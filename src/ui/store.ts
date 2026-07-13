/**
 * App state. The document model + host live here as mutable refs;
 * `revision` bumps whenever the model or rendered bytes change.
 */

import { create } from 'zustand'
import type { DocumentModel, Word } from '../model/document'
import { loadDocumentModel } from '../model/buildModel'
import { replaceWordText } from '../model/editText'
import type { PdfHost } from '../pdf/pdflibHost'
import { Renderer } from '../pdf/pdfjsRender'

export interface EditingState {
  word: Word
  pageIndex: number
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
  busy: boolean

  openFile(name: string, bytes: Uint8Array): Promise<void>
  setPage(index: number): void
  setZoom(zoom: number): void
  startEdit(word: Word): void
  cancelEdit(): void
  applyEdit(newText: string): Promise<void>
  exportPdf(): Promise<void>
  setStatus(msg: string): void
}

export const useApp = create<AppState>((set, get) => ({
  fileName: null,
  host: null,
  model: null,
  renderer: new Renderer(),
  pageIndex: 0,
  zoom: 1.25,
  revision: 0,
  status: 'open a pdf to begin',
  editing: null,
  busy: false,

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
        status: `${name} — ${model.pages.length} page(s), ${words} words detected. click a word to edit.`,
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

  startEdit(word) {
    set({ editing: { word, pageIndex: get().pageIndex } })
  },

  cancelEdit() {
    set({ editing: null })
  },

  async applyEdit(newText) {
    const { host, model, editing, renderer } = get()
    if (!host || !model || !editing) return
    if (newText === editing.word.text || newText.length === 0) {
      set({ editing: null })
      return
    }
    set({ busy: true, status: 'rewriting content stream …' })
    try {
      const outcome = await replaceWordText(
        host,
        model,
        editing.pageIndex,
        editing.word,
        newText,
      )
      if (!outcome.ok) {
        set({ busy: false, editing: null, status: `edit failed: ${outcome.reason}` })
        return
      }
      const bytes = await host.save()
      await renderer.load(bytes)
      set((s) => ({
        busy: false,
        editing: null,
        revision: s.revision + 1,
        status: outcome.usedFallbackFont
          ? `"${editing.word.text}" → "${newText}" (replacement font embedded — original font lacked the glyphs)`
          : `"${editing.word.text}" → "${newText}" — content stream rewritten`,
      }))
    } catch (err) {
      set({ busy: false, editing: null, status: `error: ${(err as Error).message}` })
    }
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
}))

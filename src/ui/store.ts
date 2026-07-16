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
import { formatBytes } from './format'
import { replaceSpanText, type LayoutOpts, type SpanTarget } from '../model/editText'
import {
  deletePage,
  duplicatePage,
  insertDocumentAt,
  movePage,
  rotatePage,
} from '../model/pageOps'
import { setFormFieldValue } from '../model/formOps'
import { findMatches, type SearchMatch } from '../model/search'
import { placeImage, placeVectorStrokes } from '../model/signatureOps'
import { placeText } from '../model/textOps'
import { highlightRegion, redactRegion } from '../model/redactOps'
import { traceImageToSvg } from './trace'
import {
  loadSvgSignatures,
  MAX_SIGNATURES,
  parseSignatureSvg,
  saveSvgSignatures,
  type SvgSignature,
} from './svgSignatures'
import type { PdfHost } from '../pdf/pdflibHost'
import { Renderer } from '../pdf/pdfjsRender'
import { transformJpegBytes } from './imageUtils'
import {
  loadSignatureLibrary,
  saveSignatureLibrary,
  type SavedSignature,
  type SignatureKind,
} from './signatureLibrary'
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

export type FitMode = 'page' | 'width' | 'actual' | null

export interface PaneView {
  pageIndex: number
  zoom: number
  /**
   * When set, EditorPane recomputes `zoom` on container resize/page
   * change to keep this fit satisfied. Manual +/- zoom clears it back
   * to null (see setZoom).
   */
  fitMode: FitMode
  /** Edit granularity for this pane's click-to-edit — independent per pane. */
  editMode: EditMode
  /** rsvp */
  wpm: number
  playing: boolean
  wordPos: number
}

/**
 * A signature/initials/date-stamp image being positioned before it's
 * embedded (drag to move, corner-drag to resize — see SignaturePlacer).
 */
export interface SignaturePlacement {
  paneId: string
  pageIndex: number
  rect: Rect
  dataUrl: string
  pngBytes: Uint8Array
  aspect: number
  /** Present for traced s1..s10 stamps — placed as vector strokes. */
  vector?: { svg: string }
}

/** An inline fill-text editor pinned to a spot on the page. */
export interface FillEditorState {
  paneId: string
  pageIndex: number
  /** Text baseline origin, PDF user space. */
  point: { x: number; y: number }
}

/** The comment editor popup — open for a new marker or an existing one. */
export interface CommentEditorState {
  paneId: string
  pageIndex: number
  point: { x: number; y: number }
  /** null while composing a brand-new comment. */
  id: string | null
  initial: string
}

export const defaultPaneView = (): PaneView => ({
  pageIndex: 0,
  zoom: 1.25,
  fitMode: null,
  editMode: 'auto',
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
  busy: boolean
  helpOpen: boolean
  /** Saved document snapshots; historyIndex points at the current one. */
  history: Uint8Array[]
  historyIndex: number
  /** historyIndex at the last export — differing means unexported edits. */
  exportedIndex: number
  /** A file waiting on the export/discard/cancel decision. */
  pendingOpen: { name: string; bytes: Uint8Array } | null
  /** Last word clicked in an editor — rsvp panes jump to it. */
  rsvpAnchor: { word: import('../model/document').Word; revision: number } | null
  setRsvpAnchor(word: import('../model/document').Word): void

  searchQuery: string
  searchCaseSensitive: boolean
  searchWholeWord: boolean
  searchMatches: SearchMatch[]
  /** Index into searchMatches of the current match; -1 if none. */
  searchIndex: number
  setSearchQuery(query: string): void
  setSearchCaseSensitive(v: boolean): void
  setSearchWholeWord(v: boolean): void
  searchNext(): void
  searchPrev(): void
  clearSearch(): void

  /** Multi-selected page indices in the pages pane. */
  selectedPages: Set<number>
  toggleSelectPage(index: number): void
  selectRangeTo(index: number): void
  clearSelection(): void
  extractPagesAction(indices: number[]): Promise<void>
  splitAtAction(index: number): Promise<void>
  deleteSelectedAction(): Promise<void>

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
  setFormFieldAction(pageIndex: number, fieldName: string, value: string | boolean): Promise<void>

  signatureLibrary: SavedSignature[]
  signatureDialogOpen: boolean
  /** The s1..s10 traced-SVG signature slots (sign pane). */
  svgSignatures: SvgSignature[]
  addSvgSignatureAction(dataUrl: string): Promise<void>
  deleteSvgSignatureAction(index: number): void
  /** Start placing slot `index`'s signature as a draggable ghost. */
  beginSignatureStamp(index: number): void
  placement: SignaturePlacement | null
  openSignatureDialog(): void
  closeSignatureDialog(): void
  beginPlacement(dataUrl: string, pngBytes: Uint8Array, aspect: number): void
  updatePlacementRect(rect: Rect): void
  cancelPlacement(): void
  confirmPlacement(): Promise<void>
  addSavedSignature(kind: SignatureKind, label: string, dataUrl: string, aspect: number): void
  deleteSavedSignature(id: string): void

  /**
   * Fill: click anywhere on the page and type — the text is committed
   * straight into the content stream on enter, no dialog.
   */
  fillPlacementActive: boolean
  fillEditor: FillEditorState | null
  startFillPlacement(): void
  cancelFillPlacement(): void
  openFillEditor(paneId: string, pageIndex: number, point: { x: number; y: number }): void
  closeFillEditor(): void
  placeFillTextAction(text: string): Promise<void>

  commentPlacementActive: boolean
  commentEditor: CommentEditorState | null
  startPlacingComment(): void
  cancelPlacingComment(): void

  /** Redaction: drag over text to remove it and bar the lines out. */
  redactPlacementActive: boolean
  startRedaction(): void
  cancelRedaction(): void
  redactRegionAction(pageIndex: number, rect: Rect): Promise<void>

  /** Highlight: drag over text to paint marker bars under it. */
  highlightPlacementActive: boolean
  startHighlight(): void
  cancelHighlight(): void
  highlightRegionAction(pageIndex: number, rect: Rect): Promise<void>
  openCommentEditor(
    paneId: string,
    pageIndex: number,
    point: { x: number; y: number },
    existing?: { id: string; contents: string },
  ): void
  closeCommentEditor(): void
  saveCommentAction(text: string): Promise<void>
  deleteCommentAction(): Promise<void>

  openFile(name: string, bytes: Uint8Array): Promise<void>
  setPage(paneId: string, index: number): void
  setZoom(paneId: string, zoom: number): void
  setFitMode(paneId: string, mode: FitMode): void
  setEditMode(paneId: string, mode: EditMode): void
  startEdit(editing: Omit<EditingState, 'pageIndex'> & { pageIndex: number }): void
  cancelEdit(): void
  applyEdit(newText: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  exportPdf(): Promise<void>
  compressAction(): Promise<void>
  /** Re-encode embedded JPEGs at lower quality to shrink the file. */
  recompressImagesAction(): Promise<void>
  /** Desaturate + boost contrast on embedded JPEGs (also shrinks them). */
  reduceImagesAction(): Promise<void>
  toggleHelp(): void
  setStatus(msg: string): void
}

/** Cap on kept snapshots — one full PDF per edit. */
const HISTORY_LIMIT = 30

/** Point size for text placed with the fill tool. */
const FILL_FONT_SIZE = 12

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const useApp = create<AppState>((set, get) => {
  /** Anchor for shift-click range selection in the pages pane. */
  let selectionAnchor: number | null = null

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
      refreshSearch()
      get().clearSelection()
    } catch (err) {
      set({ busy: false, status: `error: ${(err as Error).message}` })
    }
  }

  const persistLayout = (layout: LayoutNode) => {
    saveLayout(layout)
    return layout
  }

  const runSearch = (query: string, caseSensitive: boolean, wholeWord: boolean): SearchMatch[] => {
    const { model } = get()
    if (!model || !query.trim()) return []
    return findMatches(model, query, { caseSensitive, wholeWord })
  }

  /** Move the target editor pane to a match's page. */
  const jumpToMatch = (index: number) => {
    const match = get().searchMatches[index]
    if (!match) return
    const editorId = get().targetEditorPaneId()
    if (editorId) get().setPage(editorId, match.pageIndex)
  }

  /** Re-run the active search after the document changes underneath it. */
  const refreshSearch = () => {
    const { searchQuery, searchCaseSensitive, searchWholeWord, searchIndex } = get()
    if (!searchQuery) return
    const matches = runSearch(searchQuery, searchCaseSensitive, searchWholeWord)
    set({
      searchMatches: matches,
      searchIndex: matches.length ? Math.min(searchIndex, matches.length - 1) : -1,
    })
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
      refreshSearch()
      get().clearSelection()
    } catch (err) {
      set({ busy: false, status: `error: ${(err as Error).message}` })
    }
  }

  /**
   * Run a mutation that touches a page's own content stream (e.g.
   * embedding a signature image) and reload the whole document from
   * fresh save() bytes afterward, rather than patching the model in
   * place. Required whenever pdf-lib's page.draw* creates a new
   * in-memory content stream — reading it back through our own decoder
   * without a save/reload round-trip would see compressed bytes.
   */
  const commitViaReload = async (
    mutate: () => Promise<void>,
    verb: string,
  ): Promise<boolean> => {
    const { host, busy, renderer } = get()
    if (!host || busy) return false
    set({ busy: true, editing: null, status: `${verb} …` })
    try {
      await mutate()
      const bytes = await host.save()
      const { host: newHost, model: newModel } = await loadDocumentModel(bytes)
      await renderer.load(bytes)
      set((s) => {
        const history = [...s.history.slice(0, s.historyIndex + 1), bytes].slice(
          -HISTORY_LIMIT,
        )
        return {
          host: newHost,
          model: newModel,
          busy: false,
          revision: s.revision + 1,
          history,
          historyIndex: history.length - 1,
          paneViews: clampViews(s.paneViews, newModel.pages.length),
          status: `${verb} — done`,
        }
      })
      refreshSearch()
      get().clearSelection()
      return true
    } catch (err) {
      set({ busy: false, status: `error: ${(err as Error).message}` })
      return false
    }
  }

  /**
   * Re-encode every eligible embedded JPEG through a canvas transform,
   * swap in the new bytes, then snapshot via commitStructural. Image
   * XObjects aren't part of the text model, so reusing the existing
   * model (no reparse) is safe; only the rendered bitmap changes.
   */
  const processJpegImages = async (
    transform: Parameters<typeof transformJpegBytes>[1],
    opts: { onlyIfSmaller: boolean; verb: string },
  ) => {
    const { host, busy } = get()
    if (!host || busy) return
    const images = host.listJpegImages()
    if (images.length === 0) {
      set({ status: 'no recompressible JPEG images found in this document' })
      return
    }
    await commitStructural(async () => {
      let processed = 0
      let before = 0
      let after = 0
      for (const img of images) {
        const out = await transformJpegBytes(img.bytes, transform)
        if (!out) continue
        if (opts.onlyIfSmaller && out.bytes.length >= img.bytes.length) continue
        host.replaceJpegImage(img.id, out.bytes, out.width, out.height)
        processed++
        before += img.bytes.length
        after += out.bytes.length
      }
      if (processed === 0) return `${opts.verb}: nothing to reduce`
      const saved = before - after
      const pct = before > 0 ? Math.round((saved / before) * 100) : 0
      return `${opts.verb}: ${processed} image(s), ${formatBytes(before)} → ${formatBytes(after)}${
        saved > 0 ? ` (${pct}% smaller)` : ''
      }`
    })
  }

  return {
    fileName: null,
    host: null,
    model: null,
    renderer: new Renderer(),
    revision: 0,
    status: 'open a pdf to begin',
    editing: null,
    busy: false,
    helpOpen: false,
    history: [],
    historyIndex: -1,
    exportedIndex: -1,
    pendingOpen: null,
    rsvpAnchor: null,

    signatureLibrary: loadSignatureLibrary(),
    signatureDialogOpen: false,
    svgSignatures: loadSvgSignatures(),
    placement: null,
    fillPlacementActive: false,
    fillEditor: null,
    commentPlacementActive: false,
    commentEditor: null,
    redactPlacementActive: false,
    highlightPlacementActive: false,

    searchQuery: '',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchMatches: [],
    searchIndex: -1,

    selectedPages: new Set(),

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

    async deleteSelectedAction() {
      const { model, selectedPages } = get()
      if (!model || selectedPages.size === 0) return
      if (selectedPages.size >= model.pages.length) {
        set({ status: 'cannot delete all pages' })
        return
      }
      // descending order so earlier deletes don't shift later indices
      const indices = [...selectedPages].sort((a, b) => b - a)
      await commitStructural(() => {
        for (const idx of indices) deletePage(get().host!, get().model!, idx)
        return `${indices.length} page(s) deleted`
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

    async setFormFieldAction(pageIndex, fieldName, value) {
      await commitStructural(() => {
        setFormFieldValue(get().host!, get().model!, pageIndex, fieldName, value)
        return `field "${fieldName}" updated`
      })
    },

    openSignatureDialog() {
      set({ signatureDialogOpen: true })
    },

    closeSignatureDialog() {
      set({ signatureDialogOpen: false })
    },

    startFillPlacement() {
      set({
        fillPlacementActive: true,
        commentPlacementActive: false,
        redactPlacementActive: false,
        highlightPlacementActive: false,
      })
    },

    cancelFillPlacement() {
      set({ fillPlacementActive: false, fillEditor: null })
    },

    openFillEditor(paneId, pageIndex, point) {
      set({ fillEditor: { paneId, pageIndex, point } })
    },

    closeFillEditor() {
      set({ fillEditor: null })
    },

    async placeFillTextAction(text) {
      const editor = get().fillEditor
      const trimmed = text.trim()
      set({ fillEditor: null })
      if (!editor || !trimmed) return
      const { pageIndex, point } = editor
      // rect is arranged so embedText's baseline lands on the clicked point
      await commitViaReload(async () => {
        await placeText(
          get().host!,
          pageIndex,
          trimmed,
          { x: point.x, y: point.y, w: 0, h: FILL_FONT_SIZE },
          FILL_FONT_SIZE,
        )
      }, `text placed on page ${pageIndex + 1}`)
    },

    startPlacingComment() {
      set({
        commentPlacementActive: true,
        redactPlacementActive: false,
        highlightPlacementActive: false,
        fillPlacementActive: false,
        fillEditor: null,
      })
    },

    cancelPlacingComment() {
      set({ commentPlacementActive: false })
    },

    startRedaction() {
      set({
        redactPlacementActive: true,
        commentPlacementActive: false,
        highlightPlacementActive: false,
        fillPlacementActive: false,
        fillEditor: null,
      })
    },

    cancelRedaction() {
      set({ redactPlacementActive: false })
    },

    async redactRegionAction(pageIndex, rect) {
      await commitStructural(() => {
        const { removedGlyphs, bars } = redactRegion(get().host!, get().model!, pageIndex, rect)
        return `redacted page ${pageIndex + 1} — ${removedGlyphs} character(s) removed, ${bars} bar(s) drawn`
      })
    },

    startHighlight() {
      set({
        highlightPlacementActive: true,
        redactPlacementActive: false,
        commentPlacementActive: false,
        fillPlacementActive: false,
        fillEditor: null,
      })
    },

    cancelHighlight() {
      set({ highlightPlacementActive: false })
    },

    async highlightRegionAction(pageIndex, rect) {
      await commitStructural(() => {
        const { lines } = highlightRegion(get().host!, get().model!, pageIndex, rect)
        // highlightRegion doesn't touch the page when it finds no text,
        // so throwing here skips the save/history snapshot entirely
        if (lines === 0) throw new Error('no text under the highlight')
        return `highlighted ${lines} line(s) on page ${pageIndex + 1}`
      })
    },

    openCommentEditor(paneId, pageIndex, point, existing) {
      set({
        commentPlacementActive: false,
        commentEditor: {
          paneId,
          pageIndex,
          point,
          id: existing?.id ?? null,
          initial: existing?.contents ?? '',
        },
      })
    },

    closeCommentEditor() {
      set({ commentEditor: null })
    },

    async saveCommentAction(text) {
      const { commentEditor } = get()
      const trimmed = text.trim()
      if (!commentEditor || !trimmed) {
        set({ commentEditor: null })
        return
      }
      await commitStructural(() => {
        if (commentEditor.id) {
          get().host!.updateComment(commentEditor.pageIndex, commentEditor.id, trimmed)
          return 'comment updated'
        }
        get().host!.addComment(commentEditor.pageIndex, commentEditor.point, trimmed)
        return 'comment added'
      })
      set({ commentEditor: null })
    },

    async deleteCommentAction() {
      const { commentEditor } = get()
      if (!commentEditor?.id) {
        set({ commentEditor: null })
        return
      }
      await commitStructural(() => {
        get().host!.deleteComment(commentEditor.pageIndex, commentEditor.id!)
        return 'comment deleted'
      })
      set({ commentEditor: null })
    },

    async addSvgSignatureAction(dataUrl) {
      if (get().svgSignatures.length >= MAX_SIGNATURES) {
        set({ status: `all ${MAX_SIGNATURES} signature slots are full — delete one first` })
        return
      }
      set({ status: 'tracing centerline …' })
      try {
        const { svg, aspect, pathCount, bytes } = await traceImageToSvg(dataUrl)
        set((s) => {
          const list = [...s.svgSignatures, { svg, aspect }]
          saveSvgSignatures(list)
          return {
            svgSignatures: list,
            status: `s${list.length} traced — ${pathCount} stroke(s), ${formatBytes(bytes)}`,
          }
        })
      } catch (err) {
        set({ status: `trace error: ${(err as Error).message}` })
      }
    },

    deleteSvgSignatureAction(index) {
      set((s) => {
        const list = s.svgSignatures.filter((_, i) => i !== index)
        saveSvgSignatures(list)
        return { svgSignatures: list, status: `signature s${index + 1} deleted` }
      })
    },

    beginSignatureStamp(index) {
      const sig = get().svgSignatures[index]
      const editorId = get().targetEditorPaneId()
      const { model } = get()
      if (!sig || !editorId || !model) return
      const pageIndex = get().paneView(editorId).pageIndex
      const page = model.pages[pageIndex]
      if (!page) return
      const width = Math.min(180, page.width * 0.35)
      const height = width / sig.aspect
      set({
        placement: {
          paneId: editorId,
          pageIndex,
          rect: {
            x: (page.width - width) / 2,
            y: Math.max(40, page.height * 0.15),
            w: width,
            h: height,
          },
          dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(sig.svg),
          pngBytes: new Uint8Array(0),
          aspect: sig.aspect,
          vector: { svg: sig.svg },
        },
      })
    },

    beginPlacement(dataUrl, pngBytes, aspect) {
      const editorId = get().targetEditorPaneId()
      const { model } = get()
      if (!editorId || !model) return
      const pageIndex = get().paneView(editorId).pageIndex
      const page = model.pages[pageIndex]
      if (!page) return
      const width = Math.min(200, page.width * 0.4)
      const height = width / aspect
      const rect: Rect = {
        x: (page.width - width) / 2,
        y: Math.max(40, page.height * 0.15),
        w: width,
        h: height,
      }
      set({
        signatureDialogOpen: false,
        placement: { paneId: editorId, pageIndex, rect, dataUrl, pngBytes, aspect },
      })
    },

    updatePlacementRect(rect) {
      set((s) => (s.placement ? { placement: { ...s.placement, rect } } : s))
    },

    cancelPlacement() {
      set({ placement: null })
    },

    async confirmPlacement() {
      const { placement } = get()
      if (!placement) return
      const { pageIndex, rect, pngBytes } = placement

      if (placement.vector) {
        // traced signature: stroke the centerlines straight into the
        // content stream — vector ink, no raster, no reload needed
        const strokes = parseSignatureSvg(placement.vector.svg)
        if (!strokes) {
          set({ placement: null, status: 'error: signature svg could not be parsed' })
          return
        }
        await commitStructural(() => {
          placeVectorStrokes(get().host!, get().model!, pageIndex, strokes, rect)
          return `signature placed on page ${pageIndex + 1}`
        })
        set({ placement: null })
        return
      }

      const ok = await commitViaReload(async () => {
        await placeImage(get().host!, pageIndex, pngBytes, rect)
      }, `placed on page ${pageIndex + 1}`)
      if (ok) set({ placement: null })
    },

    addSavedSignature(kind, label, dataUrl, aspect) {
      set((s) => {
        const entry: SavedSignature = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          kind,
          label,
          dataUrl,
          aspect,
        }
        const list = [...s.signatureLibrary, entry]
        saveSignatureLibrary(list)
        return { signatureLibrary: list }
      })
    },

    deleteSavedSignature(id) {
      set((s) => {
        const list = s.signatureLibrary.filter((sig) => sig.id !== id)
        saveSignatureLibrary(list)
        return { signatureLibrary: list }
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
        const formFieldNames = new Set(
          model.pages.flatMap((p) => p.formFields.map((f) => f.name)),
        )
        const formsNote = formFieldNames.size
          ? ` ${formFieldNames.size} form field(s) detected — click to fill.`
          : ''
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
          searchQuery: '',
          searchMatches: [],
          searchIndex: -1,
          selectedPages: new Set(),
          placement: null,
          signatureDialogOpen: false,
          status: `${name} — ${model.pages.length} page(s), ${words} words detected.${formsNote} click a word to edit; ? for shortcuts.`,
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
      // manual zoom always breaks out of a fit mode's auto-tracking
      get().updatePaneView(paneId, { zoom: Math.max(0.25, Math.min(4, zoom)), fitMode: null })
      set((s) => ({ editing: s.editing?.paneId === paneId ? null : s.editing }))
    },

    setFitMode(paneId, mode) {
      get().updatePaneView(paneId, { fitMode: mode })
    },

    setEditMode(paneId, mode) {
      get().updatePaneView(paneId, { editMode: mode })
      set((s) => ({ editing: s.editing?.paneId === paneId ? null : s.editing }))
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
        refreshSearch()
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

    async compressAction() {
      const { host, busy, history, historyIndex } = get()
      if (!host || busy) return
      const before = history[historyIndex]?.byteLength ?? 0
      set({ busy: true, status: 'compressing …' })
      try {
        const bytes = await host.compress()
        await get().renderer.load(bytes)
        const after = bytes.byteLength
        const saved = before - after
        set((s) => {
          const history = [...s.history.slice(0, s.historyIndex + 1), bytes].slice(
            -HISTORY_LIMIT,
          )
          return {
            busy: false,
            revision: s.revision + 1,
            history,
            historyIndex: history.length - 1,
            status:
              saved > 0
                ? `compressed — ${formatBytes(before)} → ${formatBytes(after)} (${Math.round((saved / before) * 100)}% smaller)`
                : 'compressed — already as small as it gets',
          }
        })
      } catch (err) {
        set({ busy: false, status: `compress error: ${(err as Error).message}` })
      }
    },

    async recompressImagesAction() {
      await processJpegImages(
        { quality: 0.6 },
        { onlyIfSmaller: true, verb: 'recompressed images' },
      )
    },

    async reduceImagesAction() {
      await processJpegImages(
        { quality: 0.7, grayscale: true, contrast: 1.15 },
        { onlyIfSmaller: false, verb: 'reduced images (greyscale)' },
      )
    },

    async exportPdf() {
      const { host, fileName } = get()
      if (!host) return
      set({ busy: true, status: 'exporting …' })
      try {
        const bytes = await host.save()
        const filename = (fileName ?? 'document.pdf').replace(/\.pdf$/i, '') + '_edited.pdf'
        downloadBytes(bytes, filename)
        set((s) => ({ busy: false, exportedIndex: s.historyIndex, status: `exported ${filename}` }))
      } catch (err) {
        set({ busy: false, status: `export error: ${(err as Error).message}` })
      }
    },

    toggleSelectPage(index) {
      set((s) => {
        const next = new Set(s.selectedPages)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return { selectedPages: next }
      })
      selectionAnchor = index
    },

    selectRangeTo(index) {
      const anchor = selectionAnchor ?? index
      const [lo, hi] = anchor <= index ? [anchor, index] : [index, anchor]
      const next = new Set<number>()
      for (let i = lo; i <= hi; i++) next.add(i)
      set({ selectedPages: next })
      selectionAnchor = anchor
    },

    clearSelection() {
      selectionAnchor = null
      set((s) => (s.selectedPages.size ? { selectedPages: new Set() } : s))
    },

    async extractPagesAction(indices) {
      const { host, fileName, busy } = get()
      if (!host || busy || indices.length === 0) return
      set({ busy: true, status: 'extracting pages …' })
      try {
        const sorted = [...indices].sort((a, b) => a - b)
        const bytes = await host.extractPages(sorted)
        const base = (fileName ?? 'document.pdf').replace(/\.pdf$/i, '')
        const suffix =
          sorted.length === 1
            ? `p${sorted[0] + 1}`
            : `pages-${sorted[0] + 1}-${sorted[sorted.length - 1] + 1}`
        const filename = `${base}_${suffix}.pdf`
        downloadBytes(bytes, filename)
        set({ busy: false, status: `extracted ${sorted.length} page(s) → ${filename}` })
      } catch (err) {
        set({ busy: false, status: `error: ${(err as Error).message}` })
      }
    },

    async splitAtAction(index) {
      const { host, model, fileName, busy } = get()
      if (!host || !model || busy) return
      if (index <= 0 || index >= model.pages.length) {
        set({ status: 'nothing to split at the first page' })
        return
      }
      set({ busy: true, status: 'splitting …' })
      try {
        const before = Array.from({ length: index }, (_, i) => i)
        const after = Array.from({ length: model.pages.length - index }, (_, i) => index + i)
        const base = (fileName ?? 'document.pdf').replace(/\.pdf$/i, '')
        const [bytesA, bytesB] = await Promise.all([
          host.extractPages(before),
          host.extractPages(after),
        ])
        const nameA = `${base}_part1.pdf`
        const nameB = `${base}_part2.pdf`
        downloadBytes(bytesA, nameA)
        downloadBytes(bytesB, nameB)
        set({
          busy: false,
          status: `split at page ${index + 1}: ${nameA} (${before.length}p) + ${nameB} (${after.length}p)`,
        })
      } catch (err) {
        set({ busy: false, status: `error: ${(err as Error).message}` })
      }
    },

    setRsvpAnchor(word) {
      set((s) => ({ rsvpAnchor: { word, revision: s.revision } }))
    },

    setSearchQuery(query) {
      const { searchCaseSensitive, searchWholeWord } = get()
      const matches = runSearch(query, searchCaseSensitive, searchWholeWord)
      set({ searchQuery: query, searchMatches: matches, searchIndex: matches.length ? 0 : -1 })
      if (matches.length) jumpToMatch(0)
    },

    setSearchCaseSensitive(v) {
      const { searchQuery, searchWholeWord } = get()
      const matches = runSearch(searchQuery, v, searchWholeWord)
      set({ searchCaseSensitive: v, searchMatches: matches, searchIndex: matches.length ? 0 : -1 })
      if (matches.length) jumpToMatch(0)
    },

    setSearchWholeWord(v) {
      const { searchQuery, searchCaseSensitive } = get()
      const matches = runSearch(searchQuery, searchCaseSensitive, v)
      set({ searchWholeWord: v, searchMatches: matches, searchIndex: matches.length ? 0 : -1 })
      if (matches.length) jumpToMatch(0)
    },

    searchNext() {
      const { searchMatches, searchIndex } = get()
      if (!searchMatches.length) return
      const next = (searchIndex + 1) % searchMatches.length
      set({ searchIndex: next })
      jumpToMatch(next)
    },

    searchPrev() {
      const { searchMatches, searchIndex } = get()
      if (!searchMatches.length) return
      const prev = (searchIndex - 1 + searchMatches.length) % searchMatches.length
      set({ searchIndex: prev })
      jumpToMatch(prev)
    },

    clearSearch() {
      set({ searchQuery: '', searchMatches: [], searchIndex: -1 })
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

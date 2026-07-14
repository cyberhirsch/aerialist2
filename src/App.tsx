import { useCallback, useEffect } from 'react'
import { HelpOverlay } from './ui/HelpOverlay'
import { SaveDialog } from './ui/SaveDialog'
import { SignatureDialog } from './ui/SignatureDialog'
import { StatusBar } from './ui/StatusBar'
import { Toolbar } from './ui/Toolbar'
import { WorkspaceView } from './ui/WorkspaceView'
import { useApp } from './ui/store'
import { findPane } from './ui/workspace'

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  )
}

export default function App() {
  const openFile = useApp((s) => s.openFile)
  const requestOpen = useApp((s) => s.requestOpen)

  // ?sample=/samples/invoice.pdf — load a bundled sample (demos, testing)
  useEffect(() => {
    const sample = new URLSearchParams(window.location.search).get('sample')
    if (!sample || !sample.startsWith('/')) return
    void fetch(sample)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((buf) =>
        openFile(sample.split('/').pop() ?? 'sample.pdf', new Uint8Array(buf)),
      )
  }, [openFile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = useApp.getState()
      const ctrl = e.ctrlKey || e.metaKey
      const focusedKind = s.focusedPaneId
        ? (findPane(s.layout, s.focusedPaneId)?.kind ?? null)
        : null
      const rsvpFocused = focusedKind === 'rsvp' ? s.focusedPaneId : null
      const editorId = s.targetEditorPaneId()
      const view = editorId ? s.paneView(editorId) : null

      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void s.undo()
      } else if (
        (ctrl && e.key.toLowerCase() === 'y') ||
        (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault()
        void s.redo()
      } else if (ctrl && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        document.getElementById('a2-file-input')?.click()
      } else if (ctrl && ['e', 's'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        void s.exportPdf()
      } else if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        const input = document.getElementById('a2-search-input') as HTMLInputElement | null
        input?.focus()
        input?.select()
      } else if (ctrl) {
        // leave other ctrl combos (browser zoom etc.) alone
      } else if (e.key === ' ' && rsvpFocused) {
        e.preventDefault()
        const v = s.paneView(rsvpFocused)
        s.updatePaneView(rsvpFocused, { playing: !v.playing })
      } else if (e.key === '+' || e.key === '=') {
        if (rsvpFocused) {
          s.updatePaneView(rsvpFocused, { wpm: Math.min(1200, s.paneView(rsvpFocused).wpm + 25) })
        } else if (editorId && view) {
          s.setZoom(editorId, view.zoom + 0.25)
        }
      } else if (e.key === '-') {
        if (rsvpFocused) {
          s.updatePaneView(rsvpFocused, { wpm: Math.max(60, s.paneView(rsvpFocused).wpm - 25) })
        } else if (editorId && view) {
          s.setZoom(editorId, view.zoom - 0.25)
        }
      } else if (e.key === '0') {
        if (editorId) s.setZoom(editorId, 1.25)
      } else if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        if (rsvpFocused) {
          const v = s.paneView(rsvpFocused)
          s.updatePaneView(rsvpFocused, { wordPos: v.wordPos + 10 })
        } else if (editorId && view) {
          s.setPage(editorId, view.pageIndex + 1)
        }
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        if (rsvpFocused) {
          const v = s.paneView(rsvpFocused)
          s.updatePaneView(rsvpFocused, { wordPos: Math.max(0, v.wordPos - 10) })
        } else if (editorId && view) {
          s.setPage(editorId, view.pageIndex - 1)
        }
      } else if (e.key === 'a') {
        s.setEditMode('auto')
      } else if (e.key === 'w') {
        s.setEditMode('word')
      } else if (e.key === 'l') {
        s.setEditMode('line')
      } else if (e.key === 'p') {
        s.setEditMode('block')
      } else if (e.key === '?') {
        s.toggleHelp()
      } else if (e.key === 'Escape' && s.helpOpen) {
        s.toggleHelp()
      } else if (e.key === 'Escape' && s.placement) {
        s.cancelPlacement()
      } else if (e.key === 'Escape' && s.signatureDialogOpen) {
        s.closeSignatureDialog()
      } else if (e.key === 'Escape' && s.selectedPages.size > 0) {
        s.clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // drops outside the organizer open the file as the new document
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await requestOpen(file.name, bytes)
      }
    },
    [requestOpen],
  )

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
    >
      <Toolbar />
      <WorkspaceView />
      <StatusBar />
      <HelpOverlay />
      <SaveDialog />
      <SignatureDialog />
    </div>
  )
}

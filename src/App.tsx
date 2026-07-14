import { useCallback, useEffect } from 'react'
import { HelpOverlay } from './ui/HelpOverlay'
import { PageView } from './ui/PageView'
import { StatusBar } from './ui/StatusBar'
import { Toolbar } from './ui/Toolbar'
import { useApp } from './ui/store'

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  )
}

export default function App() {
  const openFile = useApp((s) => s.openFile)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = useApp.getState()
      const ctrl = e.ctrlKey || e.metaKey

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
      } else if (ctrl) {
        // leave other ctrl combos (browser zoom etc.) alone
      } else if (e.key === '+' || e.key === '=') {
        s.setZoom(s.zoom + 0.25)
      } else if (e.key === '-') {
        s.setZoom(s.zoom - 0.25)
      } else if (e.key === '0') {
        s.setZoom(1.25)
      } else if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        s.setPage(s.pageIndex + 1)
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        s.setPage(s.pageIndex - 1)
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await openFile(file.name, bytes)
      }
    },
    [openFile],
  )

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
    >
      <Toolbar />
      <PageView />
      <StatusBar />
      <HelpOverlay />
    </div>
  )
}

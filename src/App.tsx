import { useCallback, useEffect } from 'react'
import { PageView } from './ui/PageView'
import { StatusBar } from './ui/StatusBar'
import { Toolbar } from './ui/Toolbar'
import { useApp } from './ui/store'

export default function App() {
  const openFile = useApp((s) => s.openFile)

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
    </div>
  )
}

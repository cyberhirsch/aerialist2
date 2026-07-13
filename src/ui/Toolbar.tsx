import { useRef } from 'react'
import { useApp } from './store'

function Key({ label, onClick, disabled }: {
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-7 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  )
}

export function Toolbar() {
  const fileInput = useRef<HTMLInputElement>(null)
  const { fileName, model, pageIndex, zoom, busy, openFile, setPage, setZoom, exportPdf } =
    useApp()

  const onPick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    await openFile(file.name, bytes)
  }

  return (
    <header className="flex h-9 items-center gap-3 border-b border-ink-3 bg-ink-1 px-3 select-none">
      <span className="text-ink-7">aerialist<span className="text-ink-4">2</span></span>
      <span className="text-ink-3">│</span>

      <Key label="[ open ]" onClick={() => fileInput.current?.click()} disabled={busy} />
      <Key label="[ export ]" onClick={() => void exportPdf()} disabled={!model || busy} />

      <span className="flex-1 truncate text-center text-ink-4">
        {fileName ?? '── no document ──'}
      </span>

      <span className="flex items-center gap-1 text-ink-5">
        <Key label="‹" onClick={() => setPage(pageIndex - 1)} disabled={!model || pageIndex === 0} />
        <span className="tabular-nums">
          {model ? `${pageIndex + 1}/${model.pages.length}` : '–/–'}
        </span>
        <Key
          label="›"
          onClick={() => setPage(pageIndex + 1)}
          disabled={!model || pageIndex >= (model?.pages.length ?? 1) - 1}
        />
      </span>

      <span className="flex items-center gap-1 text-ink-5">
        <Key label="−" onClick={() => setZoom(zoom - 0.25)} disabled={!model} />
        <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <Key label="+" onClick={() => setZoom(zoom + 0.25)} disabled={!model} />
      </span>

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files)
          e.target.value = ''
        }}
      />
    </header>
  )
}

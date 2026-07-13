import { useApp } from './store'

export function StatusBar() {
  const { status, busy, model, editing } = useApp()
  const mode = busy ? 'WORKING' : editing ? 'EDIT' : model ? 'READY' : 'IDLE'
  return (
    <footer className="flex h-7 items-center gap-3 border-t border-ink-3 bg-ink-1 px-3 select-none">
      <span className={busy ? 'animate-pulse text-ink-7' : 'text-ink-7'}>[{mode}]</span>
      <span className="flex-1 truncate text-ink-5">{status}</span>
      <span className="text-ink-4">client-side · no uploads</span>
    </footer>
  )
}

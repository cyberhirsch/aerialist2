import { useApp } from './store'

function countWords(model: ReturnType<typeof useApp.getState>['model']): number {
  if (!model) return 0
  let count = 0
  for (const page of model.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        count += line.words.length
      }
    }
  }
  return count
}

export function StatusBar() {
  const { status, busy, model, editing, history, historyIndex } = useApp()
  const mode = busy ? 'WORKING' : editing ? 'EDIT' : model ? 'READY' : 'IDLE'
  const wordCount = countWords(model)
  const fileSize = history[historyIndex]?.byteLength ?? 0
  const fileSizeDisplay = fileSize < 1024
    ? `${fileSize} B`
    : fileSize < 1024 * 1024
    ? `${(fileSize / 1024).toFixed(1)} KB`
    : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`

  return (
    <footer className="flex h-7 items-center gap-3 border-t border-ink-3 bg-ink-1 px-3 select-none">
      <span className={busy ? 'animate-pulse text-ink-7' : 'text-ink-7'}>[{mode}]</span>
      <span className="flex-1 truncate text-ink-5">{status}</span>
      {model && (
        <span className="text-ink-4 tabular-nums">
          {wordCount} words · {fileSizeDisplay}
        </span>
      )}
      <span className="text-ink-4">client-side · no uploads</span>
    </footer>
  )
}

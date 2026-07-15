import { formatBytes } from './format'
import { Icon } from './icons'
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
  const {
    status, busy, model, editing, history, historyIndex,
    compressAction, recompressImagesAction, reduceImagesAction,
  } = useApp()
  const mode = busy ? 'WORKING' : editing ? 'EDIT' : model ? 'READY' : 'IDLE'
  const wordCount = countWords(model)
  const fileSize = history[historyIndex]?.byteLength ?? 0

  return (
    <footer className="flex h-7 items-center gap-3 border-t border-ink-3 bg-ink-1 px-3 select-none">
      <span className={busy ? 'animate-pulse text-ink-7' : 'text-ink-7'}>[{mode}]</span>
      <span className="flex-1 truncate text-ink-5">{status}</span>
      {model && (
        <span className="flex items-center gap-2 text-ink-4 tabular-nums">
          <span>{wordCount} words</span>
          <span>·</span>
          <span>{formatBytes(fileSize)}</span>
          <button
            onClick={() => void compressAction()}
            disabled={busy}
            title="compress — repack the PDF's internal structure to shrink file size"
            className="text-ink-4 hover:text-ink-6 disabled:opacity-40 disabled:hover:text-ink-4"
          >
            <Icon name="compress" size={13} />
          </button>
          <button
            onClick={() => void recompressImagesAction()}
            disabled={busy}
            title="recompress images — re-encode embedded JPEGs at lower quality"
            className="text-ink-4 hover:text-ink-6 disabled:opacity-40 disabled:hover:text-ink-4"
          >
            <Icon name="image" size={13} />
          </button>
          <button
            onClick={() => void reduceImagesAction()}
            disabled={busy}
            title="reduce images — greyscale + contrast on embedded JPEGs"
            className="text-ink-4 hover:text-ink-6 disabled:opacity-40 disabled:hover:text-ink-4"
          >
            <Icon name="contrast" size={13} />
          </button>
        </span>
      )}
      <span className="text-ink-4">client-side · no uploads</span>
    </footer>
  )
}

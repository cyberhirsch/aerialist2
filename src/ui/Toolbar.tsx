import { useRef } from 'react'
import { Icon } from './icons'
import { useApp } from './store'

export function Toolbar() {
  const fileInput = useRef<HTMLInputElement>(null)
  const {
    fileName, model, busy, history, historyIndex,
    searchQuery, searchCaseSensitive, searchWholeWord, searchMatches, searchIndex,
    requestOpen, exportPdf, undo, redo,
    toggleHelp,
    setSearchQuery, setSearchCaseSensitive, setSearchWholeWord, searchNext, searchPrev, clearSearch,
  } = useApp()

  const onPick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    await requestOpen(file.name, bytes)
  }

  return (
    <header className="flex h-9 items-center gap-3 border-b border-ink-3 bg-ink-1 px-3 select-none">
      <span className="text-ink-7">aerialist<span className="text-ink-4">2</span></span>
      <span className="text-ink-3">│</span>

      <button
        onClick={() => fileInput.current?.click()}
        disabled={busy}
        title="open"
        className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-7 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="open" size={14} />
      </button>
      <button
        onClick={() => void exportPdf()}
        disabled={!model || busy}
        title="export"
        className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-7 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="export" size={14} />
      </button>
      <button
        onClick={() => void undo()}
        disabled={busy || historyIndex <= 0}
        title="undo"
        className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-7 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="undo" size={14} />
      </button>
      <button
        onClick={() => void redo()}
        disabled={busy || historyIndex >= history.length - 1}
        title="redo"
        className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-7 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="redo" size={14} />
      </button>

      <span className="text-ink-3">│</span>
      <span className="flex items-center gap-1">
        <input
          id="a2-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) searchPrev()
              else searchNext()
            } else if (e.key === 'Escape') {
              if (searchQuery) clearSearch()
              e.currentTarget.blur()
            }
          }}
          disabled={!model}
          placeholder="find…"
          className="w-24 border border-ink-3 bg-ink-0 px-1 text-ink-6 outline-none placeholder:text-ink-4 focus:border-ink-5 disabled:opacity-40"
        />
        <button
          onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
          disabled={!model}
          title="case sensitive"
          className={
            'px-1 disabled:opacity-40 text-ink-5 ' +
            (searchCaseSensitive ? 'bg-ink-2 text-ink-7' : 'hover:bg-ink-2 hover:text-ink-6')
          }
        >
          <Icon name="find" size={14} />
        </button>
        <button
          onClick={() => setSearchWholeWord(!searchWholeWord)}
          disabled={!model}
          title="whole word"
          className={
            'px-1 disabled:opacity-40 text-ink-5 ' +
            (searchWholeWord ? 'bg-ink-2 text-ink-7' : 'hover:bg-ink-2 hover:text-ink-6')
          }
        >
          <Icon name="find" size={14} />
        </button>
        <button
          onClick={searchPrev}
          disabled={searchMatches.length === 0}
          title="previous match"
          className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Icon name="page-prev" size={14} />
        </button>
        <span className="w-14 text-center tabular-nums text-ink-5">
          {searchQuery ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}` : '–/–'}
        </span>
        <button
          onClick={searchNext}
          disabled={searchMatches.length === 0}
          title="next match"
          className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Icon name="page-next" size={14} />
        </button>
      </span>

      <span className="flex-1 truncate text-center text-ink-4">
        {fileName ?? '── no document ──'}
      </span>

      <button
        onClick={toggleHelp}
        title="help"
        className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-6"
      >
        <Icon name="help" size={14} />
      </button>

      <input
        id="a2-file-input"
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

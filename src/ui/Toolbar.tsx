import { useRef } from 'react'
import { defaultPaneView, useApp } from './store'

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

const MODES = ['auto', 'word', 'line', 'block'] as const

export function Toolbar() {
  const fileInput = useRef<HTMLInputElement>(null)
  const {
    fileName, model, busy, editMode, history, historyIndex, paneViews,
    searchQuery, searchCaseSensitive, searchWholeWord, searchMatches, searchIndex,
    requestOpen, setPage, setZoom, setEditMode, exportPdf, undo, redo,
    toggleHelp, targetEditorPaneId,
    setSearchQuery, setSearchCaseSensitive, setSearchWholeWord, searchNext, searchPrev, clearSearch,
  } = useApp()

  const editorId = targetEditorPaneId()
  const view = editorId ? (paneViews[editorId] ?? defaultPaneView()) : null
  const navDisabled = !model || !editorId

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

      <Key label="[ open ]" onClick={() => fileInput.current?.click()} disabled={busy} />
      <Key label="[ export ]" onClick={() => void exportPdf()} disabled={!model || busy} />
      <Key label="[ undo ]" onClick={() => void undo()} disabled={busy || historyIndex <= 0} />
      <Key
        label="[ redo ]"
        onClick={() => void redo()}
        disabled={busy || historyIndex >= history.length - 1}
      />

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
            'px-1 disabled:opacity-40 ' +
            (searchCaseSensitive ? 'bg-ink-2 text-ink-7' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
          }
        >
          Aa
        </button>
        <button
          onClick={() => setSearchWholeWord(!searchWholeWord)}
          disabled={!model}
          title="whole word"
          className={
            'px-1 disabled:opacity-40 ' +
            (searchWholeWord ? 'bg-ink-2 text-ink-7' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
          }
        >
          "ab"
        </button>
        <Key label="‹" onClick={searchPrev} disabled={searchMatches.length === 0} />
        <span className="w-14 text-center tabular-nums text-ink-5">
          {searchQuery ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}` : '–/–'}
        </span>
        <Key label="›" onClick={searchNext} disabled={searchMatches.length === 0} />
      </span>

      <span className="text-ink-3">│</span>
      <span className="flex items-center text-ink-5">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setEditMode(m)}
            disabled={!model}
            className={
              'px-1.5 disabled:opacity-40 ' +
              (editMode === m
                ? 'bg-ink-2 text-ink-7'
                : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
            }
            title={
              m === 'auto'
                ? 'auto: paragraphs reflow, tables edit per cell, other text per line'
                : `edit granularity: ${m === 'block' ? 'paragraph' : m}`
            }
          >
            {m === 'block' ? 'para' : m}
          </button>
        ))}
      </span>

      <span className="flex-1 truncate text-center text-ink-4">
        {fileName ?? '── no document ──'}
      </span>

      <span className="flex items-center gap-1 text-ink-5">
        <Key
          label="‹"
          onClick={() => editorId && view && setPage(editorId, view.pageIndex - 1)}
          disabled={navDisabled || (view?.pageIndex ?? 0) === 0}
        />
        <span className="tabular-nums">
          {model && view ? `${view.pageIndex + 1}/${model.pages.length}` : '–/–'}
        </span>
        <Key
          label="›"
          onClick={() => editorId && view && setPage(editorId, view.pageIndex + 1)}
          disabled={navDisabled || (view?.pageIndex ?? 0) >= (model?.pages.length ?? 1) - 1}
        />
      </span>

      <span className="flex items-center gap-1 text-ink-5">
        <Key
          label="−"
          onClick={() => editorId && view && setZoom(editorId, view.zoom - 0.25)}
          disabled={navDisabled}
        />
        <span className="w-12 text-center tabular-nums">
          {view ? `${Math.round(view.zoom * 100)}%` : '–'}
        </span>
        <Key
          label="+"
          onClick={() => editorId && view && setZoom(editorId, view.zoom + 0.25)}
          disabled={navDisabled}
        />
      </span>

      <Key label="[?]" onClick={toggleHelp} />

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

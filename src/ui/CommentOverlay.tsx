import { useState } from 'react'
import { apply, type Matrix } from '../engine/matrix'
import { Icon } from './icons'
import { useApp } from './store'

/**
 * Persistent comment markers for one page, plus the popup editor for
 * adding/editing/deleting one. Comments are real PDF Text annotations
 * (src/pdf/pdflibHost.ts) — they live outside the page content stream,
 * so no engine/model reload is needed after a change.
 */
export function CommentOverlay({ paneId, pageIndex, pdfToCss }: {
  paneId: string
  pageIndex: number
  pdfToCss: Matrix
}) {
  const host = useApp((s) => s.host)
  const revision = useApp((s) => s.revision)
  void revision // re-read comments whenever the document changes
  const commentEditor = useApp((s) => s.commentEditor)
  const busy = useApp((s) => s.busy)
  const { openCommentEditor, closeCommentEditor, saveCommentAction, deleteCommentAction } = useApp()

  const comments = host ? host.getComments(pageIndex) : []
  const editorHere =
    commentEditor && commentEditor.paneId === paneId && commentEditor.pageIndex === pageIndex
      ? commentEditor
      : null

  return (
    <>
      {comments.map((c) => {
        const [left, top] = apply(pdfToCss, c.rect.x, c.rect.y + c.rect.h)
        return (
          <button
            key={c.id}
            onClick={(e) => {
              e.stopPropagation()
              openCommentEditor(
                paneId,
                pageIndex,
                { x: c.rect.x, y: c.rect.y },
                { id: c.id, contents: c.contents },
              )
            }}
            onContextMenu={(e) => e.stopPropagation()}
            title={c.contents}
            className="absolute flex h-4 w-4 items-center justify-center border border-ink-5 bg-ink-1 text-ink-5 hover:bg-ink-2 hover:text-ink-7"
            style={{ left: left - 8, top: top - 8 }}
          >
            <Icon name="comment" size={11} />
          </button>
        )
      })}

      {editorHere && (
        <CommentEditorPopup
          point={editorHere.point}
          initial={editorHere.initial}
          isNew={editorHere.id === null}
          pdfToCss={pdfToCss}
          busy={busy}
          onSave={(text) => void saveCommentAction(text)}
          onDelete={() => void deleteCommentAction()}
          onCancel={closeCommentEditor}
        />
      )}
    </>
  )
}

function CommentEditorPopup({ point, initial, isNew, pdfToCss, busy, onSave, onDelete, onCancel }: {
  point: { x: number; y: number }
  initial: string
  isNew: boolean
  pdfToCss: Matrix
  busy: boolean
  onSave: (text: string) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const [left, top] = apply(pdfToCss, point.x, point.y)

  return (
    <div
      className="absolute z-10 w-52 border border-ink-5 bg-ink-1 p-2 shadow-[4px_4px_0_0_#000]"
      style={{ left, top: top + 4 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        rows={3}
        placeholder="comment…"
        className="w-full resize-none border border-ink-3 bg-ink-0 px-1 py-0.5 text-ink-6 outline-none placeholder:text-ink-4 focus:border-ink-5"
      />
      <div className="mt-1 flex justify-end gap-1">
        {!isNew && (
          <button
            onClick={onDelete}
            disabled={busy}
            title="delete comment"
            className="border border-ink-3 px-1.5 py-0.5 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40"
          >
            <Icon name="delete" size={12} />
          </button>
        )}
        <button
          onClick={onCancel}
          title="cancel"
          className="border border-ink-3 px-1.5 py-0.5 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
        >
          <Icon name="close" size={12} />
        </button>
        <button
          onClick={() => onSave(text)}
          disabled={busy || !text.trim()}
          title="save comment"
          className="border border-ink-3 px-1.5 py-0.5 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40"
        >
          <Icon name="edit" size={12} />
        </button>
      </div>
    </div>
  )
}

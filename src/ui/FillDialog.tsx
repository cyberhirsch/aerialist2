import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { useApp } from './store'

/**
 * Minimal text-entry dialog for the free-text fill tool — type text,
 * then position it on the page via SignaturePlacer (same drag/resize
 * flow as signatures).
 */
export function FillDialog() {
  const open = useApp((s) => s.fillDialogOpen)
  const { closeFillDialog, beginTextPlacement } = useApp()
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setText('')
    const id = requestAnimationFrame(() => ref.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  if (!open) return null

  const confirm = () => {
    if (!text.trim()) return
    beginTextPlacement(text.trim())
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-0/70"
      onClick={closeFillDialog}
    >
      <div
        className="w-[380px] border border-ink-3 bg-ink-1 px-5 py-4 shadow-[6px_6px_0_0_#000]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-ink-7">── fill text ──</div>

        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              confirm()
            } else if (e.key === 'Escape') {
              closeFillDialog()
            }
          }}
          placeholder="type text to place on the page…"
          rows={3}
          className="w-full resize-none border border-ink-3 bg-ink-0 px-2 py-1 text-ink-6 outline-none placeholder:text-ink-4 focus:border-ink-5"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={closeFillDialog}
            className="border border-ink-3 px-3 py-0.5 text-ink-6 hover:bg-ink-2"
            title="cancel"
          >
            <Icon name="close" size={14} />
          </button>
          <button
            onClick={confirm}
            disabled={!text.trim()}
            className="border border-ink-3 px-3 py-0.5 text-ink-6 hover:bg-ink-2 disabled:opacity-40"
            title="place on page"
          >
            <Icon name="edit" size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

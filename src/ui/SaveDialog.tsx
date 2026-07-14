import { useApp } from './store'

/** Export/discard/cancel prompt shown when opening over unexported edits. */
export function SaveDialog() {
  const { pendingOpen, resolvePendingOpen } = useApp()
  if (!pendingOpen) return null

  const btn =
    'border border-ink-3 px-3 py-0.5 text-ink-6 hover:bg-ink-2 hover:text-ink-7'

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-0/70">
      <div className="border border-ink-3 bg-ink-1 px-6 py-4 shadow-[6px_6px_0_0_#000]">
        <div className="mb-1 text-ink-7">── unexported changes ──</div>
        <p className="mb-4 text-ink-5">
          the current document has edits that were never exported.
          <br />
          opening <span className="text-ink-6">{pendingOpen.name}</span> will discard them.
        </p>
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={() => void resolvePendingOpen('export')}>
            [ export, then open ]
          </button>
          <button className={btn} onClick={() => void resolvePendingOpen('discard')}>
            [ discard ]
          </button>
          <button className={btn} onClick={() => void resolvePendingOpen('cancel')}>
            [ cancel ]
          </button>
        </div>
      </div>
    </div>
  )
}

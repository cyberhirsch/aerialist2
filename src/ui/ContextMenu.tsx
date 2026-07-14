import { useEffect } from 'react'

export interface MenuItem {
  label: string
  action?: () => void
  disabled?: boolean
  separator?: boolean
}

/** TUI-styled context menu at fixed viewport coordinates. */
export function ContextMenu({ x, y, items, onClose }: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // keep the menu inside the viewport
  const width = 230
  const height = items.length * 22 + 10
  const left = Math.min(x, window.innerWidth - width - 8)
  const top = Math.min(y, window.innerHeight - height - 8)

  return (
    <div
      className="fixed inset-0 z-30"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        className="absolute border border-ink-3 bg-ink-1 py-1 shadow-[4px_4px_0_0_#000]"
        style={{ left, top, width }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="mx-2 my-1 border-t border-ink-3" />
          ) : (
            <button
              key={i}
              disabled={item.disabled}
              onClick={() => {
                item.action?.()
                onClose()
              }}
              className="block w-full truncate px-3 py-0.5 text-left text-ink-6 hover:bg-ink-2 hover:text-ink-7 disabled:text-ink-4 disabled:hover:bg-transparent"
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { useApp } from './store'

const MIN_THUMB = 110
const GAP = 10
const PAD = 12
const PAGE_DRAG_TYPE = 'application/x-aerialist-page'

export function OrganizerPane({ paneId }: { paneId: string }) {
  void paneId
  const {
    model, revision, busy,
    setPage, targetEditorPaneId, movePageAction, mergeDocumentAt,
    deletePageAction, duplicatePageAction, rotatePageAction,
  } = useApp()
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [insertAt, setInsertAt] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; page: number } | null>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(() => setWidth(box.clientWidth))
    ro.observe(box)
    setWidth(box.clientWidth)
    return () => ro.disconnect()
  }, [])

  const inner = Math.max(0, width - 2 * PAD)
  const cols = Math.max(1, Math.floor((inner + GAP) / (MIN_THUMB + GAP)))
  const thumbW = Math.floor((inner - GAP * (cols - 1)) / cols)

  /** Insertion index from a drag position over the grid. */
  const insertionIndex = useCallback((e: React.DragEvent): number => {
    const cells = boxRef.current?.querySelectorAll('[data-page]') ?? []
    let best = model?.pages.length ?? 0
    for (const cell of cells) {
      const rect = (cell as HTMLElement).getBoundingClientRect()
      const idx = Number((cell as HTMLElement).dataset.page)
      if (
        e.clientY < rect.bottom &&
        (e.clientY < rect.top || e.clientX < rect.left + rect.width / 2)
      ) {
        best = Math.min(best, idx)
      }
    }
    return best
  }, [model])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const at = insertionIndex(e)
      setInsertAt(null)
      const pageData = e.dataTransfer.getData(PAGE_DRAG_TYPE)
      if (pageData !== '') {
        const from = Number(pageData)
        const to = at > from ? at - 1 : at
        await movePageAction(from, to)
        return
      }
      const file = e.dataTransfer.files?.[0]
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await mergeDocumentAt(file.name, bytes, at)
      }
    },
    [insertionIndex, movePageAction, mergeDocumentAt],
  )

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center text-ink-4 select-none">
        no document
      </div>
    )
  }

  const menuItems = (page: number): MenuItem[] => [
    {
      label: 'show in editor',
      action: () => {
        const id = targetEditorPaneId()
        if (id) setPage(id, page)
      },
    },
    { separator: true, label: '' },
    { label: 'duplicate page', action: () => void duplicatePageAction(page), disabled: busy },
    { label: 'rotate ⟳ 90°', action: () => void rotatePageAction(page, 90), disabled: busy },
    { label: 'rotate ⟲ 90°', action: () => void rotatePageAction(page, -90), disabled: busy },
    { separator: true, label: '' },
    {
      label: 'delete page',
      action: () => void deletePageAction(page),
      disabled: busy || model.pages.length <= 1,
    },
  ]

  return (
    <div
      ref={boxRef}
      className="h-full overflow-y-auto"
      style={{ padding: PAD }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setInsertAt(insertionIndex(e))
      }}
      onDragLeave={() => setInsertAt(null)}
      onDrop={(e) => void onDrop(e)}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}
      >
        {model.pages.map((page, i) => (
          <Thumb
            key={`${i}:${revision}`}
            index={i}
            width={thumbW}
            aspect={page.height / page.width}
            showInsertBar={insertAt === i}
            onClick={() => {
              const id = targetEditorPaneId()
              if (id) setPage(id, i)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, page: i })
            }}
          />
        ))}
      </div>
      {insertAt === model.pages.length && (
        <div className="mt-1 border-t-2 border-ink-6" />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.page)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function Thumb({ index, width, aspect, showInsertBar, onClick, onContextMenu }: {
  index: number
  width: number
  aspect: number
  showInsertBar: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const renderer = useApp((s) => s.renderer)
  const [rendered, setRendered] = useState(false)

  // render lazily, when the thumbnail scrolls into view
  useEffect(() => {
    const holder = holderRef.current
    const canvas = canvasRef.current
    if (!holder || !canvas || width < 10) return
    setRendered(false)
    let cancelled = false
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      renderer
        .renderThumb(index, canvas, width - 2)
        .then(() => {
          if (!cancelled) setRendered(true)
        })
        .catch(() => {})
    })
    io.observe(holder)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [renderer, index, width])

  return (
    <div ref={holderRef} data-page={index} className="relative select-none">
      {showInsertBar && (
        <div className="absolute -left-[6px] top-0 bottom-0 w-[2px] bg-ink-6" />
      )}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PAGE_DRAG_TYPE, String(index))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className="cursor-pointer border border-ink-3 bg-ink-1 hover:border-ink-5"
        style={{ minHeight: width * aspect }}
        title={`page ${index + 1} — drag to reorder`}
      >
        <canvas ref={canvasRef} className={rendered ? 'block' : 'block opacity-0'} />
      </div>
      <div className="mt-0.5 text-center text-[10px] text-ink-4">{index + 1}</div>
    </div>
  )
}

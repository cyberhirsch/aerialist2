import { useCallback } from 'react'
import { applyDelta, invert, rectToCssBox, type Matrix } from '../engine/matrix'
import { useApp } from './store'

/**
 * Draggable/resizable ghost box for a signature/initials/date-stamp
 * image awaiting placement. Move by dragging the body; resize
 * (aspect-locked) via the corner handle. Nothing is embedded into the
 * PDF until [ place ] is pressed.
 */
export function SignaturePlacer({ paneId, pdfToCss }: { paneId: string; pdfToCss: Matrix }) {
  const placement = useApp((s) => s.placement)
  const busy = useApp((s) => s.busy)
  const { updatePlacementRect, confirmPlacement, cancelPlacement } = useApp()

  const startDrag = useCallback(
    (mode: 'move' | 'resize') => (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      const startRect = useApp.getState().placement?.rect
      if (!startRect) return
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startY = e.clientY
      const inv = invert(pdfToCss)
      const aspect = startRect.w / startRect.h

      const onMove = (ev: PointerEvent) => {
        const [dx, dy] = applyDelta(inv, ev.clientX - startX, ev.clientY - startY)
        if (mode === 'move') {
          updatePlacementRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy })
        } else {
          const w = Math.max(20, startRect.w + dx)
          updatePlacementRect({ ...startRect, w, h: w / aspect })
        }
      }
      const onUp = () => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [pdfToCss, updatePlacementRect],
  )

  if (!placement || placement.paneId !== paneId) return null
  const css = rectToCssBox(placement.rect, pdfToCss)

  return (
    <>
      <div
        className="absolute cursor-move border-2 border-dashed border-ink-6 bg-ink-6/10"
        style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
        onPointerDown={startDrag('move')}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <img
          src={placement.dataUrl}
          alt="signature"
          draggable={false}
          className="h-full w-full select-none"
        />
        <div
          onPointerDown={startDrag('resize')}
          onClick={(e) => e.stopPropagation()}
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize border border-ink-7 bg-ink-1"
          title="drag to resize"
        />
      </div>
      <div
        className="absolute flex gap-1"
        style={{ left: css.left, top: css.top + css.height + 4 }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => void confirmPlacement()}
          disabled={busy}
          className="border border-ink-3 bg-ink-1 px-2 py-0.5 text-ink-6 hover:bg-ink-2 disabled:opacity-40"
        >
          [ place ]
        </button>
        <button
          onClick={cancelPlacement}
          className="border border-ink-3 bg-ink-1 px-2 py-0.5 text-ink-6 hover:bg-ink-2"
        >
          [ cancel ]
        </button>
      </div>
    </>
  )
}

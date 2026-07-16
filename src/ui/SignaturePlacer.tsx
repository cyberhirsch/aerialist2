import { useCallback, useEffect } from 'react'
import { applyDelta, invert, rectToCssBox, type Matrix } from '../engine/matrix'
import { ensureSignatureFont } from './googleFonts'
import { Icon } from './icons'
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

  // the ghost's live preview needs the actual font while dragging —
  // the real embed (fetching a glyph-subset TTF) only happens on place
  useEffect(() => {
    if (placement?.text) void ensureSignatureFont(placement.text.font)
  }, [placement?.text])

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
        {placement.text ? (
          <div
            className="flex h-full w-full items-center overflow-hidden px-1 text-black select-none"
            style={{
              fontFamily: `"${placement.text.font}"`,
              fontSize: css.height * 0.7,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
            }}
          >
            {placement.text.text}
          </div>
        ) : (
          <img
            src={placement.dataUrl}
            alt="signature"
            draggable={false}
            className="h-full w-full select-none"
          />
        )}
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
          title="place"
        >
          <Icon name="sign" size={14} />
        </button>
        <button
          onClick={cancelPlacement}
          className="border border-ink-3 bg-ink-1 px-2 py-0.5 text-ink-6 hover:bg-ink-2"
          title="cancel"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </>
  )
}

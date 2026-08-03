import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ensureSignatureFont,
  randomSignatureFont,
  SIGNATURE_FONTS,
  type SignatureFont,
} from './googleFonts'
import { Icon } from './icons'
import { useApp } from './store'
import { MAX_SIGNATURES, type SignatureSlot } from './svgSignatures'
import { applyStrokeEdit, chainSetToSvg, imageToChainSet, SVG_BYTE_LIMIT, type ChainSet } from './trace'

type ComposeMode = 'import' | 'draw' | 'type' | null

const THICKNESS_OPTIONS = [
  { label: 'thin', value: 1.5 },
  { label: 'medium', value: 2.5 },
  { label: 'bold', value: 4 },
  { label: 'x-bold', value: 6 },
] as const

const DRAW_W = 320
const DRAW_H = 140

function nearestThickness(w: number): number {
  return THICKNESS_OPTIONS.reduce((a, b) =>
    Math.abs(b.value - w) < Math.abs(a.value - w) ? b : a,
  ).value
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

/**
 * The sign pane: up to 10 signature slots (s1..s10), built three ways.
 * Import and draw are centerline-traced to a compact SVG, with a relax
 * slider and thickness dropdown to adjust the trace live before saving.
 * Type is never traced — it's saved as plain text + a font name, and
 * placed later as real embedded-font PDF text (see confirmPlacement),
 * so it stays true type rather than a rasterized/traced approximation.
 * Slots also appear as s1..sN quick stamps in the editor's fill mode.
 */
export function SignPane() {
  const sigs = useApp((s) => s.svgSignatures)
  const busy = useApp((s) => s.busy)
  const { addSignatureSlotAction, deleteSvgSignatureAction, setStatus } = useApp()
  const [selected, setSelected] = useState(0)

  const [mode, setMode] = useState<ComposeMode>(null)
  const [chainSet, setChainSet] = useState<ChainSet | null>(null)
  const [smooth, setSmooth] = useState(0.4)
  const [strokeWidth, setStrokeWidth] = useState(2.5)
  const autoThicknessRef = useRef(true)

  // draw mode
  const [strokes, setStrokes] = useState<[number, number][][]>([])
  const drawBoxRef = useRef<HTMLDivElement>(null)
  // the logical drawing canvas — DRAW_W×DRAW_H by default, but switches
  // to match a loaded reference image's aspect ratio (see onPickTraceImage)
  // so traced strokes line up with it; stays put after "done" removes
  // the image, since the strokes already drawn are in that coordinate space
  const [canvasSize, setCanvasSize] = useState({ w: DRAW_W, h: DRAW_H })

  // draw mode: optional reference image shown faintly behind the strokes,
  // to trace by hand — never itself part of the saved signature
  const [traceImage, setTraceImage] = useState<string | null>(null)
  const traceImageRef = useRef<HTMLInputElement>(null)

  // stroke editing (both draw and import): crossing a stroke splits it,
  // dragging from one stroke's end to another's joins them
  const [editStrokes, setEditStrokes] = useState(false)
  const editDragStart = useRef<[number, number] | null>(null)

  // type mode
  const [text, setText] = useState('')
  const [font, setFont] = useState<SignatureFont>(SIGNATURE_FONTS[0])

  const fileRef = useRef<HTMLInputElement>(null)
  const slotsFull = sigs.length >= MAX_SIGNATURES

  const selIndex = Math.min(selected, sigs.length - 1)
  const sel = mode === null && selIndex >= 0 ? sigs[selIndex] : null

  const preview = useMemo(
    () => (chainSet ? chainSetToSvg(chainSet, { smooth, strokeWidth, maxBytes: SVG_BYTE_LIMIT }) : null),
    [chainSet, smooth, strokeWidth],
  )

  const resetComposer = () => {
    setChainSet(null)
    setStrokes([])
    drawingRef.current = false
    pointsRef.current = []
    setText('')
    setSmooth(0.4)
    setStrokeWidth(2.5)
    autoThicknessRef.current = true
    setEditStrokes(false)
    editDragStart.current = null
    setTraceImage(null)
    setCanvasSize({ w: DRAW_W, h: DRAW_H })
  }

  const startMode = (m: Exclude<ComposeMode, null>) => {
    resetComposer()
    setMode(m)
  }

  const cancelCompose = () => {
    resetComposer()
    setMode(null)
  }

  const applyAutoThickness = (cs: ChainSet) => {
    if (!autoThicknessRef.current) return
    setStrokeWidth(nearestThickness(cs.strokeWidth))
    autoThicknessRef.current = false
  }

  /* ── import ── */

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('could not read file'))
      reader.readAsDataURL(file)
    })

  const onPick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const dataUrl = await readAsDataUrl(file)
    setStatus('tracing centerline …')
    try {
      const cs = await imageToChainSet(dataUrl)
      setChainSet(cs)
      applyAutoThickness(cs)
      setStatus('trace ready — adjust relax/thickness, then save')
    } catch (err) {
      setStatus(`trace error: ${(err as Error).message}`)
    }
  }

  /* ── draw ── */

  const onPickTraceImage = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const dataUrl = await readAsDataUrl(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('could not read image'))
      el.src = dataUrl
    })
    // match the box to the reference's aspect ratio so traced strokes line
    // up with it — existing strokes are in the old coordinate space, so
    // start the drawing over rather than leave them mis-scaled
    const maxDim = 320
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    setCanvasSize({
      w: Math.max(1, Math.round(img.naturalWidth * scale)),
      h: Math.max(1, Math.round(img.naturalHeight * scale)),
    })
    setStrokes([])
    setChainSet(null)
    setTraceImage(dataUrl)
  }

  // Drawing-in-progress state lives in refs, not React state: several
  // pointermove events can land in the same React 18 batch before a
  // render commits, so a handler reading state can see a stale value
  // and silently drop points mid-stroke. Refs mutate synchronously and
  // sidestep that entirely. The box is displayed responsively (its
  // rendered size can differ from the canvasSize logical viewBox), so
  // pointer coordinates are rescaled to that fixed logical space.
  const drawingRef = useRef(false)
  const pointsRef = useRef<[number, number][]>([])

  const boxPoint = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = drawBoxRef.current!.getBoundingClientRect()
    return [
      ((e.clientX - rect.left) * canvasSize.w) / rect.width,
      ((e.clientY - rect.top) * canvasSize.h) / rect.height,
    ]
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      drawBoxRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // synthetic/edge-case pointers can reject capture — drawing still works
    }
    drawingRef.current = true
    pointsRef.current = [boxPoint(e)]
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return
    pointsRef.current = [...pointsRef.current, boxPoint(e)]
    setChainSet({ chains: [...strokes, pointsRef.current], w: canvasSize.w, h: canvasSize.h, strokeWidth })
  }
  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const pts = pointsRef.current
    pointsRef.current = []
    if (pts.length < 2) {
      setChainSet(strokes.length ? { chains: strokes, w: canvasSize.w, h: canvasSize.h, strokeWidth } : null)
      return
    }
    setStrokes((s) => {
      const next = [...s, pts]
      setChainSet({ chains: next, w: canvasSize.w, h: canvasSize.h, strokeWidth })
      return next
    })
  }

  /* ── stroke editing (split/connect) ── */

  // uses the chain set's own logical size, unlike boxPoint above, since
  // this applies equally to draw's canvasSize and an imported trace's
  // native image dimensions
  const editPoint = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = drawBoxRef.current!.getBoundingClientRect()
    return [
      ((e.clientX - rect.left) * chainSet!.w) / rect.width,
      ((e.clientY - rect.top) * chainSet!.h) / rect.height,
    ]
  }

  const onEditPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      drawBoxRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // synthetic/edge-case pointers can reject capture
    }
    editDragStart.current = editPoint(e)
  }
  const onEditPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = editDragStart.current
    editDragStart.current = null
    if (!start || !chainSet) return
    const end = editPoint(e)
    const snap = Math.max(8, chainSet.strokeWidth * 3)
    setChainSet(applyStrokeEdit(chainSet, start, end, snap))
  }

  const undoStroke = () => {
    setStrokes((s) => {
      const next = s.slice(0, -1)
      setChainSet(next.length ? { chains: next, w: canvasSize.w, h: canvasSize.h, strokeWidth } : null)
      return next
    })
  }
  const clearDrawing = () => {
    setStrokes([])
    setChainSet(null)
  }

  /* ── type ── */

  // load the font for the live preview only — typed signatures are
  // never traced, so there's no chainSet/preview pipeline to run here
  useEffect(() => {
    if (mode !== 'type') return
    ensureSignatureFont(font).catch((err: Error) => setStatus(`font error: ${err.message}`))
  }, [mode, font, setStatus])

  /* ── save ── */

  const saveSlot = (slot: SignatureSlot) => {
    addSignatureSlotAction(slot)
    setSelected(Number.MAX_SAFE_INTEGER) // clamped to the new last slot below
    cancelCompose()
  }

  const handleSaveTrace = () => {
    if (!preview) return
    saveSlot({ kind: 'vector', svg: preview.svg, aspect: preview.aspect })
  }

  const handleSaveText = () => {
    if (!text.trim()) return
    saveSlot({ kind: 'text', text: text.trim(), font })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-ink-3 bg-ink-1 p-1 select-none">
        {sigs.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setSelected(i)
              setMode(null)
            }}
            title={`signature s${i + 1}`}
            className={
              'px-1.5 text-xs ' +
              (mode === null && i === selIndex
                ? 'bg-ink-2 text-ink-7'
                : 'text-ink-5 hover:bg-ink-2 hover:text-ink-6')
            }
          >
            s{i + 1}
          </button>
        ))}
        <span className="mx-1 text-ink-3">│</span>
        <button
          onClick={() => {
            if (mode === 'import') {
              cancelCompose()
            } else {
              startMode('import')
              fileRef.current?.click()
            }
          }}
          disabled={busy || slotsFull}
          title={slotsFull ? `all ${MAX_SIGNATURES} slots are full` : 'import — trace an image'}
          className={
            'px-1 disabled:opacity-30 ' +
            (mode === 'import' ? 'bg-ink-2 text-ink-7' : 'text-ink-5 hover:bg-ink-2 hover:text-ink-6')
          }
        >
          <Icon name="upload-file" size={14} />
        </button>
        <button
          onClick={() => (mode === 'draw' ? cancelCompose() : startMode('draw'))}
          disabled={busy || slotsFull}
          title={slotsFull ? `all ${MAX_SIGNATURES} slots are full` : 'draw — sign with the mouse'}
          className={
            'px-1 disabled:opacity-30 ' +
            (mode === 'draw' ? 'bg-ink-2 text-ink-7' : 'text-ink-5 hover:bg-ink-2 hover:text-ink-6')
          }
        >
          <Icon name="draw" size={14} />
        </button>
        <button
          onClick={() => (mode === 'type' ? cancelCompose() : startMode('type'))}
          disabled={busy || slotsFull}
          title={slotsFull ? `all ${MAX_SIGNATURES} slots are full` : 'type — set your name in a script font'}
          className={
            'px-1 disabled:opacity-30 ' +
            (mode === 'type' ? 'bg-ink-2 text-ink-7' : 'text-ink-5 hover:bg-ink-2 hover:text-ink-6')
          }
        >
          <Icon name="text-fields" size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {mode === 'type' && (
          <div className="mb-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="type your name…"
                className="flex-1 border border-ink-3 bg-ink-0 px-1.5 py-1 text-ink-6 outline-none placeholder:text-ink-4 focus:border-ink-5"
              />
              <select
                value={font}
                onChange={(e) => setFont(e.target.value as SignatureFont)}
                className="border border-ink-3 bg-ink-0 px-1 py-1 text-ink-6 outline-none"
              >
                {SIGNATURE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setFont(randomSignatureFont(font))}
                title="randomize font"
                className="px-1.5 py-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
              >
                <Icon name="shuffle" size={14} />
              </button>
            </div>
            {text.trim() && (
              <>
                <div
                  className="overflow-x-auto border border-ink-3 bg-white px-6 py-12 text-black"
                  style={{ fontFamily: `"${font}"`, fontSize: '7rem', lineHeight: 1.2, whiteSpace: 'nowrap' }}
                >
                  {text}
                </div>
                <div className="text-ink-4">
                  placed as real text in {font} — not traced or rasterized
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveText}
                    disabled={busy || slotsFull}
                    title={`save as s${sigs.length + 1}`}
                    className="flex items-center gap-1 border border-ink-3 bg-ink-1 px-2 py-0.5 text-ink-6 hover:bg-ink-2 disabled:opacity-40"
                  >
                    <Icon name="sign" size={14} />
                    save as s{sigs.length + 1}
                  </button>
                  <button
                    onClick={cancelCompose}
                    className="flex items-center gap-1 border border-ink-3 bg-ink-1 px-2 py-0.5 text-ink-6 hover:bg-ink-2"
                  >
                    <Icon name="close" size={14} />
                    cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'import' && !chainSet && (
          <div className="mb-3 text-ink-4">choose an image file to trace…</div>
        )}

        {(mode === 'draw' || (chainSet && preview)) && (
          <div className="flex flex-col gap-2 border-t border-ink-3 pt-3">
            <div
              ref={drawBoxRef}
              onPointerDown={editStrokes ? onEditPointerDown : mode === 'draw' ? onPointerDown : undefined}
              onPointerMove={editStrokes ? undefined : mode === 'draw' ? onPointerMove : undefined}
              onPointerUp={editStrokes ? onEditPointerUp : mode === 'draw' ? onPointerUp : undefined}
              onPointerLeave={editStrokes ? onEditPointerUp : mode === 'draw' ? onPointerUp : undefined}
              className={
                'relative border border-ink-3 bg-white p-2 ' +
                (editStrokes || mode === 'draw' ? 'cursor-crosshair touch-none' : '')
              }
              style={mode === 'draw' ? { aspectRatio: `${canvasSize.w} / ${canvasSize.h}` } : undefined}
            >
              {mode === 'draw' && traceImage && (
                <img
                  src={traceImage}
                  alt=""
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-40 select-none"
                />
              )}
              <div
                className={mode === 'draw' ? 'absolute inset-0' : undefined}
                // our own tracer output only — never user-authored markup
                dangerouslySetInnerHTML={
                  preview
                    ? {
                        __html: preview.svg.replace(
                          '<svg ',
                          mode === 'draw'
                            ? '<svg style="display:block;width:100%;height:100%" '
                            : '<svg style="display:block;width:100%;height:auto" ',
                        ),
                      }
                    : undefined
                }
              />
            </div>
            {mode === 'draw' && (
              <div className="flex items-center gap-2 text-ink-4">
                <span>sign directly with the mouse</span>
                <span className="flex-1" />
                {traceImage ? (
                  <button
                    onClick={() => setTraceImage(null)}
                    title="done tracing — remove the reference image"
                    className="flex items-center gap-1 px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
                  >
                    <Icon name="check" size={14} />
                    done
                  </button>
                ) : (
                  <button
                    onClick={() => traceImageRef.current?.click()}
                    title="load an image to trace by hand"
                    className="flex items-center gap-1 px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
                  >
                    <Icon name="upload-file" size={14} />
                    load image
                  </button>
                )}
                <button
                  onClick={undoStroke}
                  disabled={strokes.length === 0 || editStrokes}
                  title="undo last stroke"
                  className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30"
                >
                  <Icon name="undo" size={14} />
                </button>
                <button
                  onClick={clearDrawing}
                  disabled={strokes.length === 0 || editStrokes}
                  title="clear"
                  className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30"
                >
                  <Icon name="delete" size={14} />
                </button>
              </div>
            )}
            {chainSet && preview && (
              <>
                <button
                  onClick={() => setEditStrokes((v) => !v)}
                  title="fix crossings — drag across a stroke to cut it, drag between two strokes' ends to join them"
                  className={
                    'flex items-center gap-1 self-start px-1.5 py-0.5 text-ink-4 ' +
                    (editStrokes ? 'bg-ink-2 text-ink-7' : 'hover:bg-ink-2 hover:text-ink-6')
                  }
                >
                  <Icon name="link" size={14} />
                  {editStrokes ? 'drag to cut/join strokes' : 'fix crossings'}
                </button>
                <label className="flex items-center gap-2 text-ink-4">
                  relax
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={smooth}
                    onChange={(e) => setSmooth(Number(e.target.value))}
                    className="flex-1"
                    title="smooths the curve — doesn't reduce points"
                  />
                  <span className="w-8 text-right tabular-nums">{smooth.toFixed(2)}</span>
                </label>
                <label className="flex items-center gap-2 text-ink-4">
                  thickness
                  <select
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    className="border border-ink-3 bg-ink-0 px-1 text-ink-6 outline-none"
                  >
                    {THICKNESS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="flex-1" />
                  <span className="tabular-nums">
                    {formatBytes(preview.bytes)} / {formatBytes(SVG_BYTE_LIMIT)}
                  </span>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveTrace}
                    disabled={busy || slotsFull}
                    title={`save as s${sigs.length + 1}`}
                    className="flex items-center gap-1 border border-ink-3 bg-ink-1 px-2 py-0.5 text-ink-6 hover:bg-ink-2 disabled:opacity-40"
                  >
                    <Icon name="sign" size={14} />
                    save as s{sigs.length + 1}
                  </button>
                  <button
                    onClick={cancelCompose}
                    className="flex items-center gap-1 border border-ink-3 bg-ink-1 px-2 py-0.5 text-ink-6 hover:bg-ink-2"
                  >
                    <Icon name="close" size={14} />
                    cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === null && sel && (
          <SlotPreview
            slot={sel}
            index={selIndex}
            onDelete={() => {
              deleteSvgSignatureAction(selIndex)
              setSelected(Math.max(0, selIndex - 1))
            }}
          />
        )}

        {mode === null && !sel && (
          <div className="flex h-full items-center justify-center text-ink-4 select-none">
            <pre className="leading-6">{`┌──────────────────────────────┐
│                              │
│   no signatures yet.         │
│                              │
│   import or draw to trace    │
│   one to svg (max 6 kb),     │
│   or type to place real      │
│   text in a script font.     │
│                              │
└──────────────────────────────┘`}</pre>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={traceImageRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onPickTraceImage(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/** A saved slot's preview + delete — branches on vector vs. typed text. */
function SlotPreview({ slot, index, onDelete }: {
  slot: SignatureSlot
  index: number
  onDelete: () => void
}) {
  useEffect(() => {
    if (slot.kind === 'text') ensureSignatureFont(slot.font).catch(() => {})
  }, [slot])

  return (
    <div className="flex flex-col gap-2">
      {slot.kind === 'vector' ? (
        <div
          className="border border-ink-3 bg-white p-2"
          dangerouslySetInnerHTML={{
            __html: slot.svg.replace('<svg ', '<svg style="display:block;width:100%;height:auto" '),
          }}
        />
      ) : (
        <div
          className="overflow-x-auto border border-ink-3 bg-white px-6 py-12 text-black"
          style={{ fontFamily: `"${slot.font}"`, fontSize: '7rem', lineHeight: 1.2, whiteSpace: 'nowrap' }}
        >
          {slot.text}
        </div>
      )}
      <div className="flex items-center gap-2 text-ink-4">
        <span>
          s{index + 1} ·{' '}
          {slot.kind === 'vector'
            ? `${formatBytes(new TextEncoder().encode(slot.svg).length)} · svg centerline trace`
            : `${slot.font} · real text`}
        </span>
        <span className="flex-1" />
        <button
          onClick={onDelete}
          title={`delete s${index + 1}`}
          className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
        >
          <Icon name="delete" size={14} />
        </button>
      </div>
      <div className="text-ink-4">
        place it from the editor: enable the fill tool, then press s{index + 1}.
      </div>
    </div>
  )
}

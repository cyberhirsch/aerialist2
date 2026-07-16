import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ensureSignatureFont,
  randomSignatureFont,
  SIGNATURE_FONTS,
  type SignatureFont,
} from './googleFonts'
import { Icon } from './icons'
import { useApp } from './store'
import { MAX_SIGNATURES } from './svgSignatures'
import {
  chainSetToSvg,
  imageToChainSet,
  renderTextToChainSet,
  SVG_BYTE_LIMIT,
  type ChainSet,
} from './trace'

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
 * The sign pane: up to 10 signature slots (s1..s10), built three ways —
 * import an image, draw freehand, or type in a script font — each
 * centerline-traced to a compact SVG. A relax slider and thickness
 * dropdown adjust the trace live before it's saved to a slot. Slots
 * also appear as s1..sN quick stamps in the editor's fill mode.
 */
export function SignPane() {
  const sigs = useApp((s) => s.svgSignatures)
  const busy = useApp((s) => s.busy)
  const { addSvgSignatureAction, deleteSvgSignatureAction, setStatus } = useApp()
  const [selected, setSelected] = useState(0)

  const [mode, setMode] = useState<ComposeMode>(null)
  const [chainSet, setChainSet] = useState<ChainSet | null>(null)
  const [epsilon, setEpsilon] = useState(0.8)
  const [strokeWidth, setStrokeWidth] = useState(2.5)
  const autoThicknessRef = useRef(true)

  // draw mode
  const [strokes, setStrokes] = useState<[number, number][][]>([])
  const [liveStroke, setLiveStroke] = useState<[number, number][] | null>(null)
  const drawSvgRef = useRef<SVGSVGElement>(null)

  // type mode
  const [text, setText] = useState('')
  const [font, setFont] = useState<SignatureFont>(SIGNATURE_FONTS[0])

  const fileRef = useRef<HTMLInputElement>(null)
  const slotsFull = sigs.length >= MAX_SIGNATURES

  const selIndex = Math.min(selected, sigs.length - 1)
  const sel = mode === null && selIndex >= 0 ? sigs[selIndex] : null

  const preview = useMemo(
    () => (chainSet ? chainSetToSvg(chainSet, { epsilon, strokeWidth, maxBytes: SVG_BYTE_LIMIT }) : null),
    [chainSet, epsilon, strokeWidth],
  )

  const resetComposer = () => {
    setChainSet(null)
    setStrokes([])
    setLiveStroke(null)
    drawingRef.current = false
    pointsRef.current = []
    setText('')
    setEpsilon(0.8)
    setStrokeWidth(2.5)
    autoThicknessRef.current = true
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

  const onPick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('could not read file'))
      reader.readAsDataURL(file)
    })
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

  // Drawing-in-progress state lives in refs, not React state: several
  // pointermove events can land in the same React 18 batch before a
  // render commits, so a handler reading state (even via a closure
  // check like `if (!liveStroke) return`) can see a stale value and
  // silently drop points mid-stroke. Refs mutate synchronously and
  // sidestep that entirely; `liveStroke` state exists only to paint
  // the in-progress polyline.
  const drawingRef = useRef(false)
  const pointsRef = useRef<[number, number][]>([])

  const svgPoint = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = drawSvgRef.current!.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      drawSvgRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // synthetic/edge-case pointers can reject capture — drawing still works
    }
    drawingRef.current = true
    pointsRef.current = [svgPoint(e)]
    setLiveStroke(pointsRef.current)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingRef.current) return
    pointsRef.current = [...pointsRef.current, svgPoint(e)]
    setLiveStroke(pointsRef.current)
  }
  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const pts = pointsRef.current
    pointsRef.current = []
    setLiveStroke(null)
    if (pts.length < 2) return
    setStrokes((s) => {
      const next = [...s, pts]
      setChainSet({ chains: next, w: DRAW_W, h: DRAW_H, strokeWidth })
      return next
    })
  }

  const undoStroke = () => {
    setStrokes((s) => {
      const next = s.slice(0, -1)
      setChainSet(next.length ? { chains: next, w: DRAW_W, h: DRAW_H, strokeWidth } : null)
      return next
    })
  }
  const clearDrawing = () => {
    setStrokes([])
    setChainSet(null)
  }

  /* ── type ── */

  useEffect(() => {
    if (mode !== 'type') return
    if (!text.trim()) {
      setChainSet(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        await ensureSignatureFont(font)
        if (cancelled) return
        const cs = renderTextToChainSet(text, font)
        if (cancelled) return
        setChainSet(cs)
        applyAutoThickness(cs)
      } catch (err) {
        if (!cancelled) setStatus(`font error: ${(err as Error).message}`)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, text, font])

  /* ── save ── */

  const handleSave = () => {
    if (!preview) return
    addSvgSignatureAction(preview.svg, preview.aspect)
    setSelected(Number.MAX_SAFE_INTEGER) // clamped to the new last slot below
    cancelCompose()
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
        {mode === 'draw' && (
          <div className="mb-3 flex flex-col gap-2">
            <svg
              ref={drawSvgRef}
              viewBox={`0 0 ${DRAW_W} ${DRAW_H}`}
              width={DRAW_W}
              height={DRAW_H}
              className="cursor-crosshair touch-none border border-ink-3 bg-white"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {strokes.map((s, i) => (
                <polyline
                  key={i}
                  points={s.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="#000"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {liveStroke && (
                <polyline
                  points={liveStroke.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="#000"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
            <div className="flex items-center gap-2 text-ink-4">
              <span>draw with the mouse — this is the raw ink, before relax</span>
              <span className="flex-1" />
              <button
                onClick={undoStroke}
                disabled={strokes.length === 0}
                title="undo last stroke"
                className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30"
              >
                <Icon name="undo" size={14} />
              </button>
              <button
                onClick={clearDrawing}
                disabled={strokes.length === 0}
                title="clear"
                className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30"
              >
                <Icon name="delete" size={14} />
              </button>
            </div>
          </div>
        )}

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
              <div
                className="border border-ink-3 bg-white px-3 py-4 text-3xl text-black"
                style={{ fontFamily: `"${font}"` }}
              >
                {text}
              </div>
            )}
          </div>
        )}

        {mode === 'import' && !chainSet && (
          <div className="mb-3 text-ink-4">choose an image file to trace…</div>
        )}

        {chainSet && preview && (
          <div className="flex flex-col gap-2 border-t border-ink-3 pt-3">
            <div
              className="border border-ink-3 bg-white p-2"
              // our own tracer output only — never user-authored markup
              dangerouslySetInnerHTML={{
                __html: preview.svg.replace(
                  '<svg ',
                  '<svg style="display:block;width:100%;height:auto" ',
                ),
              }}
            />
            <label className="flex items-center gap-2 text-ink-4">
              relax
              <input
                type="range"
                min={0.2}
                max={4}
                step={0.2}
                value={epsilon}
                onChange={(e) => setEpsilon(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-8 text-right tabular-nums">{epsilon.toFixed(1)}</span>
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
                onClick={handleSave}
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
          </div>
        )}

        {mode === null && sel && (
          <div className="flex flex-col gap-2">
            <div
              className="border border-ink-3 bg-white p-2"
              dangerouslySetInnerHTML={{
                __html: sel.svg.replace(
                  '<svg ',
                  '<svg style="display:block;width:100%;height:auto" ',
                ),
              }}
            />
            <div className="flex items-center gap-2 text-ink-4">
              <span>
                s{selIndex + 1} · {formatBytes(new TextEncoder().encode(sel.svg).length)} · svg
                centerline trace
              </span>
              <span className="flex-1" />
              <button
                onClick={() => {
                  deleteSvgSignatureAction(selIndex)
                  setSelected(Math.max(0, selIndex - 1))
                }}
                title={`delete s${selIndex + 1}`}
                className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
              >
                <Icon name="delete" size={14} />
              </button>
            </div>
            <div className="text-ink-4">
              place it from the editor: enable the fill tool, then press s{selIndex + 1}.
            </div>
          </div>
        )}

        {mode === null && !sel && (
          <div className="flex h-full items-center justify-center text-ink-4 select-none">
            <pre className="leading-6">{`┌──────────────────────────────┐
│                              │
│   no signatures yet.         │
│                              │
│   import, draw, or type      │
│   above to trace one to      │
│   svg (max 6 kb).            │
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
    </div>
  )
}

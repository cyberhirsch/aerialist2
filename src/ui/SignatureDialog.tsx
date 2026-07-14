import { useEffect, useRef, useState } from 'react'
import { dataUrlToBytes, rasterizeToPng, renderTextSignature } from './imageUtils'
import { useApp } from './store'
import type { SignatureKind } from './signatureLibrary'

type Tab = 'draw' | 'type' | 'upload' | 'saved'

const DRAW_W = 420
const DRAW_H = 160

export function SignatureDialog() {
  const open = useApp((s) => s.signatureDialogOpen)
  const { closeSignatureDialog, beginPlacement, addSavedSignature, signatureLibrary, deleteSavedSignature } =
    useApp()

  const [tab, setTab] = useState<Tab>('draw')
  const [typedText, setTypedText] = useState('')
  const [uploaded, setUploaded] = useState<{ dataUrl: string; aspect: number } | null>(null)
  const [saveLabel, setSaveLabel] = useState('')
  const [saveKind, setSaveKind] = useState<SignatureKind>('signature')
  const [saveForReuse, setSaveForReuse] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  // reactive (not a ref): drives the confirm button's disabled state,
  // which a ref mutation alone would never trigger a re-render for
  const [hasDrawing, setHasDrawing] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('draw')
    setTypedText('')
    setUploaded(null)
    setSaveLabel('')
    setSaveForReuse(false)
    setHasDrawing(false)
  }, [open])

  useEffect(() => {
    if (tab !== 'draw') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      setHasDrawing(false)
    }
  }, [tab, open])

  if (!open) return null

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top] as const
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const [x, y] = pointerPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const [x, y] = pointerPos(e)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#000000'
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!hasDrawing) setHasDrawing(true)
  }

  const onPointerUp = () => {
    drawingRef.current = false
  }

  const clearDraw = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawing(false)
  }

  const onUploadFile = async (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      void rasterizeToPng(reader.result as string).then(setUploaded)
    }
    reader.readAsDataURL(file)
  }

  /** Produce the final {dataUrl, aspect} for the active tab, or null if nothing to place. */
  const currentAsset = (): { dataUrl: string; aspect: number } | null => {
    if (tab === 'draw') {
      const canvas = canvasRef.current
      if (!canvas || !hasDrawing) return null
      return { dataUrl: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height }
    }
    if (tab === 'type') {
      if (!typedText.trim()) return null
      return renderTextSignature(typedText.trim())
    }
    if (tab === 'upload') {
      return uploaded
    }
    return null
  }

  const confirm = () => {
    const asset = currentAsset()
    if (!asset) return
    const pngBytes = dataUrlToBytes(asset.dataUrl)
    if (saveForReuse && saveLabel.trim()) {
      addSavedSignature(saveKind, saveLabel.trim(), asset.dataUrl, asset.aspect)
    }
    beginPlacement(asset.dataUrl, pngBytes, asset.aspect)
  }

  const insertDateStamp = () => {
    const today = new Date().toISOString().slice(0, 10)
    const asset = renderTextSignature(today, 'bold 32px "Cascadia Mono", monospace')
    beginPlacement(asset.dataUrl, dataUrlToBytes(asset.dataUrl), asset.aspect)
  }

  const pickSaved = (dataUrl: string, aspect: number) => {
    beginPlacement(dataUrl, dataUrlToBytes(dataUrl), aspect)
  }

  const asset = currentAsset()
  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={
        'px-2 py-0.5 ' +
        (tab === t ? 'bg-ink-2 text-ink-7' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
      }
    >
      {label}
    </button>
  )

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-0/70"
      onClick={closeSignatureDialog}
    >
      <div
        className="w-[460px] border border-ink-3 bg-ink-1 px-5 py-4 shadow-[6px_6px_0_0_#000]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-ink-7">── signature ──</span>
          <button onClick={insertDateStamp} className="text-ink-4 hover:text-ink-6">
            [ insert date stamp ]
          </button>
        </div>

        <div className="mb-3 flex border border-ink-3 text-ink-5">
          {tabBtn('draw', 'draw')}
          {tabBtn('type', 'type')}
          {tabBtn('upload', 'upload')}
          {tabBtn('saved', `saved (${signatureLibrary.length})`)}
        </div>

        {tab === 'draw' && (
          <div>
            <canvas
              ref={canvasRef}
              width={DRAW_W}
              height={DRAW_H}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className="w-full touch-none border border-ink-3 bg-ink-7"
            />
            <div className="mt-1 flex justify-between text-ink-4">
              <span>draw with mouse or touch</span>
              <button onClick={clearDraw} className="hover:text-ink-6">
                [ clear ]
              </button>
            </div>
          </div>
        )}

        {tab === 'type' && (
          <div>
            <input
              autoFocus
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="type your name…"
              className="w-full border border-ink-3 bg-ink-0 px-2 py-1 text-ink-6 outline-none focus:border-ink-5"
            />
            {typedText.trim() && (
              <div className="mt-2 flex items-center justify-center border border-ink-3 bg-ink-7 py-3">
                <img src={renderTextSignature(typedText.trim()).dataUrl} alt="signature preview" />
              </div>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onUploadFile(file)
              }}
              className="w-full text-ink-5"
            />
            {uploaded && (
              <div className="mt-2 flex items-center justify-center border border-ink-3 bg-ink-7 py-3">
                <img src={uploaded.dataUrl} alt="upload preview" className="max-h-24" />
              </div>
            )}
          </div>
        )}

        {tab === 'saved' && (
          <div className="max-h-64 overflow-y-auto">
            {signatureLibrary.length === 0 && (
              <div className="py-4 text-center text-ink-4">no saved signatures yet</div>
            )}
            {signatureLibrary.map((sig) => (
              <div
                key={sig.id}
                className="mb-1.5 flex items-center gap-2 border border-ink-3 bg-ink-0 p-1.5"
              >
                <button
                  onClick={() => pickSaved(sig.dataUrl, sig.aspect)}
                  className="flex flex-1 items-center gap-2 text-left hover:bg-ink-2"
                >
                  <img src={sig.dataUrl} alt={sig.label} className="h-8 bg-white" />
                  <span className="text-ink-5">
                    {sig.label} <span className="text-ink-4">({sig.kind})</span>
                  </span>
                </button>
                <button
                  onClick={() => deleteSavedSignature(sig.id)}
                  className="px-1 text-ink-4 hover:text-ink-6"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {tab !== 'saved' && (
          <div className="mt-3 border-t border-ink-3 pt-3">
            <label className="flex items-center gap-2 text-ink-5">
              <input
                type="checkbox"
                checked={saveForReuse}
                onChange={(e) => setSaveForReuse(e.target.checked)}
              />
              save for reuse as
              <select
                value={saveKind}
                onChange={(e) => setSaveKind(e.target.value as SignatureKind)}
                className="border border-ink-3 bg-ink-0 text-ink-6"
                disabled={!saveForReuse}
              >
                <option value="signature">signature</option>
                <option value="initials">initials</option>
              </select>
              <input
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                placeholder="label"
                disabled={!saveForReuse}
                className="w-24 border border-ink-3 bg-ink-0 px-1 text-ink-6 outline-none disabled:opacity-40"
              />
            </label>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={closeSignatureDialog}
            className="border border-ink-3 px-3 py-0.5 text-ink-6 hover:bg-ink-2"
          >
            [ cancel ]
          </button>
          {tab !== 'saved' && (
            <button
              onClick={confirm}
              disabled={!asset}
              className="border border-ink-3 px-3 py-0.5 text-ink-6 hover:bg-ink-2 disabled:opacity-40"
            >
              [ place on page ]
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

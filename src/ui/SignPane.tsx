import { useRef, useState } from 'react'
import { Icon } from './icons'
import { useApp } from './store'
import { MAX_SIGNATURES } from './svgSignatures'

/**
 * The sign pane: up to 10 signature slots (s1..s10). The + imports an
 * image, traces its centerline to a compact SVG (< 6 KB), and shows the
 * trace. Slots also appear as quick stamps in the editor's fill mode.
 */
export function SignPane() {
  const sigs = useApp((s) => s.svgSignatures)
  const busy = useApp((s) => s.busy)
  const { addSvgSignatureAction, deleteSvgSignatureAction } = useApp()
  const [selected, setSelected] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const selIndex = Math.min(selected, sigs.length - 1)
  const sel = selIndex >= 0 ? sigs[selIndex] : null

  const onPick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('could not read file'))
      reader.readAsDataURL(file)
    })
    await addSvgSignatureAction(dataUrl)
    setSelected(useApp.getState().svgSignatures.length - 1)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-3 bg-ink-1 p-1 select-none">
        {sigs.map((_, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            title={`signature s${i + 1}`}
            className={
              'px-1.5 text-xs ' +
              (i === selIndex
                ? 'bg-ink-2 text-ink-7'
                : 'text-ink-5 hover:bg-ink-2 hover:text-ink-6')
            }
          >
            s{i + 1}
          </button>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || sigs.length >= MAX_SIGNATURES}
          title={
            sigs.length >= MAX_SIGNATURES
              ? `all ${MAX_SIGNATURES} slots are full`
              : 'add signature — import an image; its centerline is traced to svg'
          }
          className="px-1.5 text-ink-5 hover:bg-ink-2 hover:text-ink-7 disabled:opacity-30"
        >
          +
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {sel ? (
          <div className="flex flex-col gap-2">
            <div
              className="border border-ink-3 bg-white p-2"
              // our own tracer output — nothing user-authored lands here
              dangerouslySetInnerHTML={{
                __html: sel.svg.replace(
                  '<svg ',
                  '<svg style="display:block;width:100%;height:auto" ',
                ),
              }}
            />
            <div className="flex items-center gap-2 text-ink-4">
              <span>
                s{selIndex + 1} · {formatSvgBytes(sel.svg)} · svg centerline trace
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
        ) : (
          <div className="flex h-full items-center justify-center text-ink-4 select-none">
            <pre className="leading-6">{`┌──────────────────────────────┐
│                              │
│   no signatures yet.         │
│                              │
│   [ + ] imports an image     │
│   and traces its centerline  │
│   to svg (max 6 kb).         │
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

function formatSvgBytes(svg: string): string {
  const bytes = new TextEncoder().encode(svg).length
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

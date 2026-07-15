/** How to reprocess an embedded JPEG: quality, optional greyscale/contrast, downscale cap. */
export interface JpegTransform {
  /** Output JPEG quality, 0–1. */
  quality: number
  grayscale?: boolean
  /** CSS contrast multiplier (1 = unchanged). */
  contrast?: number
  /** Cap the long edge to this many pixels (downscale only). */
  maxDim?: number
}

/**
 * Decode a JPEG, optionally desaturate / adjust contrast / downscale,
 * and re-encode it as a JPEG. Returns null if the image can't be
 * decoded (leave the original in place). Pure browser-canvas work — the
 * host stays free of pixel handling.
 */
export async function transformJpegBytes(
  bytes: Uint8Array,
  t: JpegTransform,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const view = bytes.slice()
  const blob = new Blob([view.buffer as ArrayBuffer], { type: 'image/jpeg' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const w0 = img.naturalWidth || 1
    const h0 = img.naturalHeight || 1
    const scale = t.maxDim ? Math.min(1, t.maxDim / Math.max(w0, h0)) : 1
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const filters: string[] = []
    if (t.grayscale) filters.push('grayscale(1)')
    if (t.contrast && t.contrast !== 1) filters.push(`contrast(${t.contrast})`)
    if (filters.length) ctx.filter = filters.join(' ')
    ctx.drawImage(img, 0, 0, w, h)
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', t.quality),
    )
    if (!out) return null
    return { bytes: new Uint8Array(await out.arrayBuffer()), width: w, height: h }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Convert a data: URL (e.g. from canvas.toDataURL) to raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not load image'))
    img.src = src
  })
}

/** Render typed text as a signature-style image (transparent PNG, black ink). */
export function renderTextSignature(
  text: string,
  font = 'italic 48px "Brush Script MT", "Segoe Script", cursive',
): { dataUrl: string; aspect: number } {
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const width = Math.max(60, Math.ceil(measure.measureText(text || ' ').width) + 24)
  const height = 90

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.font = font
  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 12, height / 2)

  return { dataUrl: canvas.toDataURL('image/png'), aspect: width / height }
}

/**
 * Rasterize an arbitrary image source (PNG/JPG/SVG data URL) to a PNG
 * data URL, capped to maxDim on the long edge. Normalizes every upload
 * to one format so the host only ever needs to embed PNG bytes.
 */
export async function rasterizeToPng(
  src: string,
  maxDim = 600,
): Promise<{ dataUrl: string; aspect: number }> {
  const img = await loadImage(src)
  const w = img.naturalWidth || 1
  const h = img.naturalHeight || 1
  const scale = Math.min(1, maxDim / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height }
}

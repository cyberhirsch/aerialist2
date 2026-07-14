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

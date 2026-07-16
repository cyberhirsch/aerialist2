/**
 * Centerline tracer: turns raster ink (an imported image, or typed text
 * rendered to a canvas) into a compact SVG of stroked centerline paths
 * (the pen's path, not an outline trace). Freehand-drawn signatures skip
 * straight to the same simplify/emit stage, since pointer input is
 * already a centerline.
 *
 * Pipeline: alpha-aware Otsu threshold → Zhang-Suen thinning down to a
 * 1px skeleton → spur pruning → chain peeling into polylines (this half
 * is `skeletonToChains`, the expensive part) → Douglas-Peucker
 * simplification, retried with a coarser tolerance until the SVG fits
 * the byte budget (`chainSetToSvg`, cheap enough to re-run live as a UI
 * slider moves). All custom TS, no dependencies.
 */

export const SVG_BYTE_LIMIT = 6 * 1024

export interface TraceResult {
  svg: string
  aspect: number
  /** Ink strokes traced (subpaths in the SVG). */
  pathCount: number
  /** Encoded size of the SVG in bytes. */
  bytes: number
}

type Point = [number, number]

/** Unsimplified centerline polylines awaiting relax/thickness/emit. */
export interface ChainSet {
  chains: Point[][]
  w: number
  h: number
  /** Estimated pen thickness in view-box units (ink area / skeleton length). */
  strokeWidth: number
}

/* ── canvas front end ────────────────────────────────────────── */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not load image'))
    img.src = src
  })
}

/** Ink mask from image data: composite on white, Otsu threshold. */
function binarize(image: ImageData): Uint8Array {
  const { data, width, height } = image
  const luma = new Uint8Array(width * height)
  const hist = new Uint32Array(256)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3] / 255
    const l = ((data[i] + data[i + 1] + data[i + 2]) / 3) * a + 255 * (1 - a)
    const v = Math.round(l)
    luma[p] = v
    hist[v]++
  }
  const threshold = otsu(hist, width * height)
  const mask = new Uint8Array(width * height)
  for (let p = 0; p < luma.length; p++) mask[p] = luma[p] < threshold ? 1 : 0
  return mask
}

/** Otsu's method: threshold maximizing between-class variance. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 160
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/** Trace whatever's currently drawn on a canvas (white bg, dark ink). */
export function canvasToChainSet(canvas: HTMLCanvasElement): ChainSet {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const mask = binarize(ctx.getImageData(0, 0, canvas.width, canvas.height))
  return skeletonToChains(mask, canvas.width, canvas.height)
}

/** Trace an image (any data URL the browser can decode) to a chain set. */
export async function imageToChainSet(dataUrl: string, maxDim = 700): Promise<ChainSet> {
  const img = await loadImage(dataUrl)
  const w0 = img.naturalWidth || 1
  const h0 = img.naturalHeight || 1
  // enough resolution for a faithful skeleton, small enough to thin fast
  const scale = Math.min(1, maxDim / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, w, h)
  return canvasToChainSet(canvas)
}

/** Render text in a loaded font to a chain set (caller ensures the font is ready). */
export function renderTextToChainSet(text: string, fontFamily: string, size = 80): ChainSet {
  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('no 2d context')
  measure.font = `${size}px "${fontFamily}"`
  const width = Math.max(80, Math.ceil(measure.measureText(text || ' ').width) + size)
  const height = Math.round(size * 2)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000'
  ctx.font = `${size}px "${fontFamily}"`
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, height / 2)
  return canvasToChainSet(canvas)
}

/** Trace an image straight to a size-capped SVG (import, one-shot). */
export async function traceImageToSvg(
  dataUrl: string,
  maxBytes = SVG_BYTE_LIMIT,
): Promise<TraceResult> {
  const set = await imageToChainSet(dataUrl)
  return chainSetToSvg(set, { maxBytes })
}

/* ── skeleton (Zhang-Suen thinning) ──────────────────────────── */

function thin(mask: Uint8Array, w: number, h: number): void {
  // clear the border so the 8-neighborhood never leaves the buffer
  for (let x = 0; x < w; x++) {
    mask[x] = 0
    mask[(h - 1) * w + x] = 0
  }
  for (let y = 0; y < h; y++) {
    mask[y * w] = 0
    mask[y * w + w - 1] = 0
  }

  const toClear: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let step = 0; step < 2; step++) {
      toClear.length = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!mask[i]) continue
          const p2 = mask[i - w]
          const p3 = mask[i - w + 1]
          const p4 = mask[i + 1]
          const p5 = mask[i + w + 1]
          const p6 = mask[i + w]
          const p7 = mask[i + w - 1]
          const p8 = mask[i - 1]
          const p9 = mask[i - w - 1]
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          // transitions 0→1 around the ring must be exactly one
          let a = 0
          if (!p2 && p3) a++
          if (!p3 && p4) a++
          if (!p4 && p5) a++
          if (!p5 && p6) a++
          if (!p6 && p7) a++
          if (!p7 && p8) a++
          if (!p8 && p9) a++
          if (!p9 && p2) a++
          if (a !== 1) continue
          if (step === 0) {
            if ((p2 && p4 && p6) || (p4 && p6 && p8)) continue
          } else {
            if ((p2 && p4 && p8) || (p2 && p6 && p8)) continue
          }
          toClear.push(i)
        }
      }
      if (toClear.length) {
        changed = true
        for (const i of toClear) mask[i] = 0
      }
    }
  }
}

/* ── chain extraction ────────────────────────────────────────── */

const N8: Point[] = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
]

/**
 * Erase thinning-artifact spurs: short dead-end branches hanging off a
 * longer stroke. Walking such a branch during extraction would cut the
 * main stroke in two, fragmenting one pen movement into many subpaths.
 * A branch is only erased when it actually meets a junction — an
 * isolated short stroke is real ink and stays.
 */
function pruneSpurs(skel: Uint8Array, w: number, h: number, maxLen: number): void {
  const idx = (x: number, y: number) => y * w + x
  const degree = (x: number, y: number): number => {
    let d = 0
    for (const [dx, dy] of N8) if (skel[idx(x + dx, y + dy)]) d++
    return d
  }

  let changed = true
  while (changed) {
    changed = false
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!skel[idx(x, y)] || degree(x, y) !== 1) continue
        const chain: number[] = []
        let cx = x
        let cy = y
        let prev = -1
        let junction = false
        while (chain.length < maxLen) {
          chain.push(idx(cx, cy))
          let nx = 0
          let ny = 0
          let n = 0
          for (const [dx, dy] of N8) {
            const q = idx(cx + dx, cy + dy)
            if (!skel[q] || q === prev || chain.includes(q)) continue
            n++
            nx = cx + dx
            ny = cy + dy
          }
          if (n === 0) break // standalone short stroke — keep
          if (degree(nx, ny) >= 3) {
            junction = true
            break
          }
          prev = idx(cx, cy)
          cx = nx
          cy = ny
        }
        if (junction) {
          for (const i of chain) skel[i] = 0
          changed = true
        }
      }
    }
  }
}

/**
 * Peel the skeleton into polylines: repeatedly start at an endpoint
 * (or, once none are left, anywhere — a loop) and walk pixel-to-pixel,
 * consuming as we go and preferring the straightest continuation at
 * junctions so strokes read as single pen movements.
 */
function extractChains(skel: Uint8Array, w: number, h: number): Point[][] {
  const live = skel.slice()
  const at = (x: number, y: number) => live[y * w + x]

  const degree = (x: number, y: number): number => {
    let d = 0
    for (const [dx, dy] of N8) if (at(x + dx, y + dy)) d++
    return d
  }

  const chains: Point[][] = []

  const walk = (sx: number, sy: number): Point[] => {
    const path: Point[] = [[sx, sy]]
    live[sy * w + sx] = 0
    let cx = sx
    let cy = sy
    let pdx = 0
    let pdy = 0
    for (;;) {
      let best: Point | null = null
      let bestScore = -Infinity
      for (const [dx, dy] of N8) {
        if (!at(cx + dx, cy + dy)) continue
        // prefer continuing straight (dot product with last direction)
        const score = pdx * dx + pdy * dy
        if (score > bestScore) {
          bestScore = score
          best = [dx, dy]
        }
      }
      if (!best) break
      cx += best[0]
      cy += best[1]
      pdx = best[0]
      pdy = best[1]
      live[cy * w + cx] = 0
      path.push([cx, cy])
    }
    return path
  }

  // open strokes first, walked from endpoints — consuming a junction
  // exposes new endpoints, so sweep until a pass finds none
  let found = true
  while (found) {
    found = false
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!at(x, y) || degree(x, y) > 1) continue
        chains.push(walk(x, y))
        found = true
      }
    }
  }
  // whatever remains is closed loops — start anywhere on them
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (at(x, y)) chains.push(walk(x, y))
    }
  }
  return chains
}

/** Threshold → thin → prune → peel: the expensive, non-interactive half. */
export function skeletonToChains(mask: Uint8Array, w: number, h: number): ChainSet {
  let inkCount = 0
  for (let i = 0; i < mask.length; i++) inkCount += mask[i]
  if (inkCount === 0) throw new Error('no ink found to trace')

  const skel = mask.slice()
  thin(skel, w, h)
  let skelCount = 0
  for (let i = 0; i < skel.length; i++) skelCount += skel[i]
  if (skelCount === 0) throw new Error('no strokes survived thinning')

  // ink area / centerline length ≈ average stroke thickness
  const strokeWidth = Math.min(8, Math.max(1.25, inkCount / skelCount))

  pruneSpurs(skel, w, h, Math.max(4, Math.round(strokeWidth * 2)))

  // pixels isolated in the skeleton are real dots (the dot on an i);
  // single pixels orphaned later, during chain peeling at staircase
  // corners, are noise and must not survive as fake dots
  const isolated = new Set<number>()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!skel[i]) continue
      let d = 0
      for (const [dx, dy] of N8) if (skel[(y + dy) * w + x + dx]) d++
      if (d === 0) isolated.add(i)
    }
  }

  const chains = extractChains(skel, w, h)
  const paths: Point[][] = []
  for (const chain of chains) {
    if (chain.length === 1) {
      // a zero-length segment still draws as a dot via the round cap
      const [x, y] = chain[0]
      if (isolated.has(y * w + x)) paths.push([[x, y], [x + 0.01, y]])
      continue
    }
    if (pathLength(chain) >= strokeWidth * 1.5) paths.push(chain)
  }

  return { chains: paths, w, h, strokeWidth }
}

/* ── simplification (Ramer-Douglas-Peucker) ──────────────────── */

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let maxDist = 0
    let maxIdx = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      if (dist > maxDist) {
        maxDist = dist
        maxIdx = i
      }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = 1
      stack.push([a, maxIdx], [maxIdx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/* ── SVG emit ────────────────────────────────────────────────── */

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function buildSvg(paths: Point[][], w: number, h: number, strokeWidth: number): string {
  const d = paths
    .map((p) => 'M' + p.map(([x, y], i) => `${i ? 'L' : ''}${fmt(x)} ${fmt(y)}`).join(''))
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<path fill="none" stroke="#000" stroke-width="${fmt(strokeWidth)}" ` +
    `stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`
  )
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length

function pathLength(p: Point[]): number {
  let len = 0
  for (let i = 1; i < p.length; i++) {
    len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
  }
  return len
}

/**
 * Simplify + emit: the cheap, interactive half — safe to re-run on
 * every relax-slider tick or thickness change. `epsilon` is a floor,
 * not a fixed value: if the requested tolerance still doesn't fit
 * `maxBytes`, it escalates further (and, in the pathological case,
 * sheds the shortest strokes) so the result never exceeds the budget.
 */
export function chainSetToSvg(
  set: ChainSet,
  opts: { epsilon?: number; strokeWidth?: number; maxBytes?: number } = {},
): TraceResult {
  const strokeWidth = opts.strokeWidth ?? set.strokeWidth
  const maxBytes = opts.maxBytes ?? SVG_BYTE_LIMIT

  // always apply the requested tolerance at least once — even when the
  // unsimplified chains already fit the budget, the caller's epsilon
  // (e.g. a relax-slider position) must still take visible effect
  let epsilon = opts.epsilon ?? 0.8
  let simplified = set.chains.map((p) => rdp(p, epsilon)).filter((p) => p.length >= 2)
  let svg = buildSvg(simplified, set.w, set.h, strokeWidth)
  while (byteLength(svg) > maxBytes && epsilon <= 64) {
    epsilon *= 1.6
    simplified = set.chains.map((p) => rdp(p, epsilon)).filter((p) => p.length >= 2)
    svg = buildSvg(simplified, set.w, set.h, strokeWidth)
  }
  // pathological fallback: shed the shortest strokes until it fits
  while (byteLength(svg) > maxBytes && simplified.length > 1) {
    simplified = [...simplified]
      .sort((a, b) => pathLength(b) - pathLength(a))
      .slice(0, Math.max(1, Math.floor(simplified.length * 0.8)))
    svg = buildSvg(simplified, set.w, set.h, strokeWidth)
  }

  return {
    svg,
    aspect: set.w / set.h,
    pathCount: simplified.length,
    bytes: byteLength(svg),
  }
}

/** Trace a binary ink mask straight to a size-capped SVG (used by tests). */
export function traceMask(
  mask: Uint8Array,
  w: number,
  h: number,
  maxBytes = SVG_BYTE_LIMIT,
): TraceResult {
  return chainSetToSvg(skeletonToChains(mask, w, h), { maxBytes })
}

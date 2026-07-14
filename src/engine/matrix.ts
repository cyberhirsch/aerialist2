/**
 * 2D affine transforms as [a b c d e f] — the PDF convention:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */

export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** m1 × m2 (apply m1 first, then m2). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ]
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Apply only the linear part of a transform (no translation) — for deltas, not points. */
export function applyDelta(m: Matrix, dx: number, dy: number): [number, number] {
  return [m[0] * dx + m[2] * dy, m[1] * dx + m[3] * dy]
}

export function translate(m: Matrix, tx: number, ty: number): Matrix {
  return multiply([1, 0, 0, 1, tx, ty], m)
}

/** Approximate scale factors the matrix applies along x and y. */
export function scaleOf(m: Matrix): [number, number] {
  return [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])]
}

/**
 * Display transform mapping PDF user space → CSS pixels for a page of
 * `w`×`h` user units at `scale`, honoring /Rotate (matches PDF.js
 * viewport math for a zero-origin MediaBox).
 */
export function pageViewportTransform(
  w: number,
  h: number,
  rotation: number,
  scale: number,
): { transform: Matrix; cssWidth: number; cssHeight: number } {
  const r = ((rotation % 360) + 360) % 360
  const s = scale
  switch (r) {
    case 90:
      return { transform: [0, s, s, 0, 0, 0], cssWidth: h * s, cssHeight: w * s }
    case 180:
      return { transform: [-s, 0, 0, s, w * s, 0], cssWidth: w * s, cssHeight: h * s }
    case 270:
      return { transform: [0, -s, -s, 0, h * s, w * s], cssWidth: h * s, cssHeight: w * s }
    default:
      return { transform: [s, 0, 0, -s, 0, h * s], cssWidth: w * s, cssHeight: h * s }
  }
}

export interface CssBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * CSS position of a PDF-user-space rect (x, y, w, h — bottom-left
 * origin) under a page's render transform (zoom, y-flip, rotation).
 */
export function rectToCssBox(
  rect: { x: number; y: number; w: number; h: number },
  pdfToCss: Matrix,
): CssBox {
  const corners = [
    apply(pdfToCss, rect.x, rect.y),
    apply(pdfToCss, rect.x + rect.w, rect.y),
    apply(pdfToCss, rect.x, rect.y + rect.h),
    apply(pdfToCss, rect.x + rect.w, rect.y + rect.h),
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  }
}

/** Inverse of an affine transform (throws on singular matrices). */
export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  if (det === 0) throw new Error('singular matrix')
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)]
}

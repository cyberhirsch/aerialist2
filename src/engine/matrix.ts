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

export function translate(m: Matrix, tx: number, ty: number): Matrix {
  return multiply([1, 0, 0, 1, tx, ty], m)
}

/** Approximate scale factors the matrix applies along x and y. */
export function scaleOf(m: Matrix): [number, number] {
  return [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])]
}

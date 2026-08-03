import { describe, expect, it } from 'vitest'
import type { PathCommand } from '../model/signatureOps'
import { parseSignatureSvg } from './svgSignatures'
import { applyStrokeEdit, SVG_BYTE_LIMIT, traceMask, type ChainSet } from './trace'

/** Blank w×h mask with a painter callback. */
function makeMask(w: number, h: number, paint: (set: (x: number, y: number) => void) => void): Uint8Array {
  const mask = new Uint8Array(w * h)
  paint((x, y) => {
    if (x >= 0 && x < w && y >= 0 && y < h) mask[y * w + x] = 1
  })
  return mask
}

/** Every command's terminal (x, y) — M/L/C all end at one. */
const endpoints = (path: PathCommand[]): [number, number][] => path.map((c) => [c.x, c.y])

describe('traceMask (centerline tracing)', () => {
  it('reduces a thick horizontal bar to one centerline stroke', () => {
    const w = 80
    const h = 40
    // a 5px-thick bar from x=10..70 centered on y=20
    const mask = makeMask(w, h, (set) => {
      for (let x = 10; x <= 70; x++) for (let dy = -2; dy <= 2; dy++) set(x, 20 + dy)
    })

    const result = traceMask(mask, w, h)
    expect(result.pathCount).toBe(1)
    expect(result.bytes).toBeLessThanOrEqual(SVG_BYTE_LIMIT)
    expect(result.aspect).toBe(2)

    // the traced stroke runs the bar's length near its vertical center
    const strokes = parseSignatureSvg(result.svg)!
    const pts = endpoints(strokes.paths[0])
    const xs = pts.map(([x]) => x)
    const ys = pts.map(([, y]) => y)
    expect(Math.min(...xs)).toBeLessThan(16)
    expect(Math.max(...xs)).toBeGreaterThan(64)
    for (const y of ys) expect(Math.abs(y - 20)).toBeLessThan(3)
    // ink area / skeleton length ≈ the bar's 5px thickness
    expect(strokes.strokeWidth).toBeGreaterThan(3)
    expect(strokes.strokeWidth).toBeLessThan(7)
  })

  it('keeps separate marks as separate subpaths, dots included', () => {
    const w = 60
    const h = 30
    const mask = makeMask(w, h, (set) => {
      for (let x = 5; x <= 25; x++) set(x, 10) // a thin stroke
      set(45, 10) // an isolated dot (like the dot on an i)
    })

    const result = traceMask(mask, w, h)
    expect(result.pathCount).toBe(2)
    const strokes = parseSignatureSvg(result.svg)!
    expect(strokes.paths.length).toBe(2)
  })

  it('respects the byte budget by simplifying harder', () => {
    const w = 200
    const h = 200
    // a noisy spiral — lots of points before simplification
    const mask = makeMask(w, h, (set) => {
      for (let t = 0; t < 720; t++) {
        const a = (t / 180) * Math.PI
        const r = 10 + t / 10
        set(Math.round(100 + r * Math.cos(a)), Math.round(100 + r * Math.sin(a)))
      }
    })

    const tight = 700
    const result = traceMask(mask, w, h, tight)
    expect(result.bytes).toBeLessThanOrEqual(tight)
    expect(result.pathCount).toBeGreaterThan(0)
  })

  it('throws when there is no ink', () => {
    expect(() => traceMask(new Uint8Array(100), 10, 10)).toThrow(/no ink/)
  })
})

describe('applyStrokeEdit (manual split/connect)', () => {
  const set = (chains: [number, number][][]): ChainSet => ({ chains, w: 100, h: 100, strokeWidth: 2 })

  it('splits a stroke the drag line crosses', () => {
    const horizontal = set([
      [
        [10, 50],
        [90, 50],
      ],
    ])
    // a short vertical cut through the middle of the horizontal stroke
    const result = applyStrokeEdit(horizontal, [50, 30], [50, 70], 5)
    expect(result.chains.length).toBe(2)
    const xs = result.chains.map((c) => c.map(([x]) => x))
    expect(Math.max(...xs[0])).toBeLessThanOrEqual(50)
    expect(Math.min(...xs[1])).toBeGreaterThanOrEqual(50)
  })

  it('leaves strokes alone when the drag misses everything', () => {
    const horizontal = set([
      [
        [10, 50],
        [90, 50],
      ],
    ])
    const result = applyStrokeEdit(horizontal, [10, 10], [90, 10], 5)
    expect(result.chains.length).toBe(1)
    expect(result).toBe(horizontal) // unchanged reference — no-op fast path
  })

  it('connects two different strokes at their nearest ends when the drag starts and lands on each', () => {
    const twoStrokes = set([
      [
        [10, 10],
        [40, 10],
      ],
      [
        [60, 10],
        [90, 10],
      ],
    ])
    // drag from near the first stroke's right end to near the second's left end
    const result = applyStrokeEdit(twoStrokes, [40, 11], [60, 9], 5)
    expect(result.chains.length).toBe(1)
    expect(result.chains[0]).toEqual([
      [10, 10],
      [40, 10],
      [60, 10],
      [90, 10],
    ])
  })

  it('does not connect when the drag is not near two different strokes', () => {
    const twoStrokes = set([
      [
        [10, 10],
        [40, 10],
      ],
      [
        [60, 10],
        [90, 10],
      ],
    ])
    // both drag ends land on the *same* stroke — should fall through to a (no-op) cut, not a merge
    const result = applyStrokeEdit(twoStrokes, [10, 10], [40, 10], 5)
    expect(result.chains.length).toBe(2)
  })
})

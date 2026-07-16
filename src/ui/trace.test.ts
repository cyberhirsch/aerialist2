import { describe, expect, it } from 'vitest'
import { parseSignatureSvg } from './svgSignatures'
import { SVG_BYTE_LIMIT, traceMask } from './trace'

/** Blank w×h mask with a painter callback. */
function makeMask(w: number, h: number, paint: (set: (x: number, y: number) => void) => void): Uint8Array {
  const mask = new Uint8Array(w * h)
  paint((x, y) => {
    if (x >= 0 && x < w && y >= 0 && y < h) mask[y * w + x] = 1
  })
  return mask
}

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
    const pts = strokes.paths[0]
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

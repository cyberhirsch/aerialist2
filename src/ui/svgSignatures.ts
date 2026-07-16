/**
 * The s1..s10 signature slots, persisted in localStorage. Two kinds:
 *  - vector: a centerline-traced, curve-smoothed SVG (drawn/imported),
 *    under the 6 KB budget enforced by the tracer. parseSignatureSvg
 *    turns our own emitted markup back into path commands for vector
 *    placement (real PDF Bezier curves, not a polyline).
 *  - text: a typed signature — just the string and the chosen Google
 *    Font name. Never traced; placed as real embedded-font PDF text
 *    (see googleFonts.fetchSignatureFontBytes + PdfHost.embedText).
 */

import type { PathCommand, VectorStrokes } from '../model/signatureOps'
import type { SignatureFont } from './googleFonts'

export const MAX_SIGNATURES = 10

export interface VectorSignatureSlot {
  kind: 'vector'
  svg: string
  aspect: number
}

export interface TextSignatureSlot {
  kind: 'text'
  text: string
  font: SignatureFont
}

export type SignatureSlot = VectorSignatureSlot | TextSignatureSlot

const STORAGE_KEY = 'aerialist2.svgsigs.v1'

export function loadSvgSignatures(): SignatureSlot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: SignatureSlot[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      if (r.kind === 'text' && typeof r.text === 'string' && typeof r.font === 'string') {
        out.push({ kind: 'text', text: r.text, font: r.font as SignatureFont })
      } else if (typeof r.svg === 'string' && typeof r.aspect === 'number') {
        // pre-migration entries (and vector entries) have no kind tag
        out.push({ kind: 'vector', svg: r.svg, aspect: r.aspect })
      }
      if (out.length >= MAX_SIGNATURES) break
    }
    return out
  } catch {
    return []
  }
}

export function saveSvgSignatures(list: SignatureSlot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // storage full/unavailable — signatures just won't persist
  }
}

/**
 * Parse the tracer's SVG back into path commands (M/L/C). Only
 * understands the exact shape buildSmoothSvg emits (one path, absolute
 * commands, no other letters) — which is fine, because these SVGs are
 * always our own output.
 */
export function parseSignatureSvg(svg: string): VectorStrokes | null {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  const dAttr = /\bd="([^"]+)"/.exec(svg)
  const sw = /stroke-width="([\d.]+)"/.exec(svg)
  if (!vb || !dAttr) return null

  const tokens = dAttr[1].match(/[MLC][^MLC]*/g)
  if (!tokens) return null

  const paths: PathCommand[][] = []
  let current: PathCommand[] = []
  for (const tok of tokens) {
    const type = tok[0] as 'M' | 'L' | 'C'
    const n = tok
      .slice(1)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
    if (type === 'M') {
      if (current.length >= 2) paths.push(current)
      if (!Number.isFinite(n[0]) || !Number.isFinite(n[1])) {
        current = []
        continue
      }
      current = [{ type: 'M', x: n[0], y: n[1] }]
    } else if (type === 'L') {
      if (Number.isFinite(n[0]) && Number.isFinite(n[1])) {
        current.push({ type: 'L', x: n[0], y: n[1] })
      }
    } else if (n.length >= 6 && n.every(Number.isFinite)) {
      current.push({ type: 'C', x1: n[0], y1: n[1], x2: n[2], y2: n[3], x: n[4], y: n[5] })
    }
  }
  if (current.length >= 2) paths.push(current)
  if (paths.length === 0) return null

  return {
    paths,
    viewW: parseFloat(vb[1]),
    viewH: parseFloat(vb[2]),
    strokeWidth: sw ? parseFloat(sw[1]) : 2,
  }
}

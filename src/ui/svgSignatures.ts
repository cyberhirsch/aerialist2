/**
 * The s1..s10 signature slots, persisted in localStorage. Two kinds:
 *  - vector: a centerline-traced SVG (drawn/imported), under the 6 KB
 *    budget enforced by the tracer. parseSignatureSvg turns our own
 *    emitted markup back into plain polyline data for vector placement.
 *  - text: a typed signature — just the string and the chosen Google
 *    Font name. Never traced; placed as real embedded-font PDF text
 *    (see googleFonts.fetchSignatureFontBytes + PdfHost.embedText).
 */

import type { VectorStrokes } from '../model/signatureOps'
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
 * Parse the tracer's SVG back into polylines. Only understands the
 * exact shape buildSvg emits (one path, absolute M/L commands) — which
 * is fine, because these SVGs are always our own output.
 */
export function parseSignatureSvg(svg: string): VectorStrokes | null {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  const d = /\bd="([^"]+)"/.exec(svg)
  const sw = /stroke-width="([\d.]+)"/.exec(svg)
  if (!vb || !d) return null

  const paths: [number, number][][] = []
  for (const sub of d[1].split('M')) {
    if (!sub.trim()) continue
    const points: [number, number][] = []
    for (const pair of sub.split('L')) {
      const [x, y] = pair.trim().split(/\s+/).map(Number)
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y])
    }
    if (points.length >= 2) paths.push(points)
  }
  if (paths.length === 0) return null

  return {
    paths,
    viewW: parseFloat(vb[1]),
    viewH: parseFloat(vb[2]),
    strokeWidth: sw ? parseFloat(sw[1]) : 2,
  }
}

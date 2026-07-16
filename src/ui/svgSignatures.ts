/**
 * The s1..s10 signature slots: centerline-traced SVGs (each under the
 * 6 KB budget enforced by the tracer), persisted in localStorage. The
 * SVG string is the stored form; parseSignatureSvg turns our own
 * emitted markup back into plain polyline data for vector placement.
 */

import type { VectorStrokes } from '../model/signatureOps'

export const MAX_SIGNATURES = 10

export interface SvgSignature {
  svg: string
  aspect: number
}

const STORAGE_KEY = 'aerialist2.svgsigs.v1'

export function loadSvgSignatures(): SvgSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SvgSignature[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s) => typeof s?.svg === 'string' && typeof s?.aspect === 'number')
      .slice(0, MAX_SIGNATURES)
  } catch {
    return []
  }
}

export function saveSvgSignatures(list: SvgSignature[]): void {
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

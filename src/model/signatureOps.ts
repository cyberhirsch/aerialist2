/**
 * Signature/initials/date-stamp placement.
 *
 * placeImage draws a PNG via pdf-lib — the caller must reload the whole
 * document from fresh save() bytes afterward (see the host method's
 * note on why an in-place model patch isn't safe there).
 *
 * placeSignatureText embeds a typed signature's own script font and
 * draws real PDF text with it — never traced or rasterized. Same
 * reload requirement as placeImage (it goes through pdf-lib's drawText).
 *
 * placeVectorStrokes writes traced signature centerlines straight into
 * the content stream as stroked path operators — real vector ink, never
 * a rasterized stamp. It rebuilds the page model itself, so plain
 * commitStructural semantics apply.
 */

import { toBytes } from '../engine/serialize'
import { buildPageModel } from './buildModel'
import type { DocumentModel, Rect } from './document'
import type { PdfHost } from '../pdf/pdflibHost'

export async function placeImage(
  host: PdfHost,
  pageIndex: number,
  pngBytes: Uint8Array,
  rect: Rect,
): Promise<void> {
  await host.embedImage(pageIndex, pngBytes, { x: rect.x, y: rect.y, w: rect.w, h: rect.h })
}

export async function placeSignatureText(
  host: PdfHost,
  pageIndex: number,
  text: string,
  fontBytes: Uint8Array,
  rect: Rect,
): Promise<void> {
  const fontSize = Math.max(6, Math.min(140, rect.h * 0.85))
  await host.embedText(pageIndex, text, { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, fontSize, fontBytes)
}

/**
 * One command in a stroked path, in a y-down view box (as traced from
 * an image): a straight move/line, or a cubic Bezier curve — the same
 * control-point convention SVG's `C` and PDF's `c` operators both use,
 * so placing one is a direct per-point coordinate transform, no curve
 * conversion needed.
 */
export type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }

export interface VectorStrokes {
  paths: PathCommand[][]
  viewW: number
  viewH: number
  strokeWidth: number
}

export function placeVectorStrokes(
  host: PdfHost,
  model: DocumentModel,
  pageIndex: number,
  strokes: VectorStrokes,
  rect: Rect,
): void {
  const page = model.pages[pageIndex]
  if (!page) throw new Error('page not found')

  // view box (y down) → the placement rect in page space (y up)
  const sx = rect.w / (strokes.viewW || 1)
  const sy = rect.h / (strokes.viewH || 1)
  const tx = (x: number) => rect.x + x * sx
  const ty = (y: number) => rect.y + rect.h - y * sy

  const ops: string[] = [
    `q 1 J 1 j 0 0 0 RG ${fmt(strokes.strokeWidth * (sx + sy) / 2)} w`,
  ]
  for (const path of strokes.paths) {
    const parts = path.map((cmd) => {
      if (cmd.type === 'C') {
        return `${fmt(tx(cmd.x1))} ${fmt(ty(cmd.y1))} ${fmt(tx(cmd.x2))} ${fmt(ty(cmd.y2))} ${fmt(tx(cmd.x))} ${fmt(ty(cmd.y))} c`
      }
      return `${fmt(tx(cmd.x))} ${fmt(ty(cmd.y))} ${cmd.type === 'M' ? 'm' : 'l'}`
    })
    ops.push(parts.join(' ') + ' S')
  }
  ops.push('Q')

  // same technique as the marker tools: wrap the original content in
  // q…Q so our strokes draw under a restored default user-space CTM
  const lead = toBytes('q\n')
  const tail = toBytes('\nQ\n')
  const drawing = toBytes(ops.join('\n') + '\n')
  const merged = new Uint8Array(
    lead.length + page.contentBytes.length + tail.length + drawing.length,
  )
  let off = 0
  for (const chunk of [lead, page.contentBytes, tail, drawing]) {
    merged.set(chunk, off)
    off += chunk.length
  }

  host.setPageContent(pageIndex, merged)
  model.pages[pageIndex] = buildPageModel(host, pageIndex)
}

function fmt(n: number): string {
  return Number.isInteger(n)
    ? String(n)
    : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

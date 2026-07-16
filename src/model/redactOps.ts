/**
 * Marker tools: redact and highlight. Both take a dragged region and
 * snap to the text under it, producing one bar per text line (like a
 * marker stroke) instead of echoing the raw drag rectangle.
 *
 * Redact is true content removal, not a black-box overlay: every glyph
 * whose box overlaps the region has its source bytes deleted from the
 * page content stream (the characters are gone from the file, not
 * merely hidden), then opaque black bars are drawn where the lines
 * were. Highlight leaves the text alone and paints translucent marker
 * bars *under* it (prepended to the stream so the text renders on top).
 */

import { rewriteOperation, spliceBytes, type Splice, type StringEdit } from '../engine/rewriter'
import { toBytes } from '../engine/serialize'
import { buildPageModel } from './buildModel'
import type { DocumentModel, Glyph, PageModel, Rect } from './document'
import type { PdfHost } from '../pdf/pdflibHost'

export interface RedactOutcome {
  /** Glyphs whose bytes were removed from the content stream. */
  removedGlyphs: number
  /** Cover bars drawn (one per affected text line). */
  bars: number
}

/** Does the glyph's em box overlap the region rect (user space)? */
function glyphOverlaps(g: Glyph, r: Rect): boolean {
  return (
    g.x < r.x + r.w &&
    g.x + g.width > r.x &&
    g.y < r.y + r.h &&
    g.y + g.height > r.y
  )
}

/**
 * One bar per text line touched by the region: the line's full height,
 * spanning only the glyphs that were actually hit — bars hug the text
 * like marker strokes. Padded 1pt so ink at the edges is fully covered.
 */
export function lineBarsInRegion(page: PageModel, rect: Rect): Rect[] {
  const bars: Rect[] = []
  for (const block of page.blocks) {
    for (const line of block.lines) {
      let x0 = Infinity
      let x1 = -Infinity
      for (const word of line.words) {
        for (const g of word.glyphs) {
          if (!glyphOverlaps(g, rect)) continue
          x0 = Math.min(x0, g.x)
          x1 = Math.max(x1, g.x + g.width)
        }
      }
      if (x1 > x0) {
        bars.push({
          x: x0 - 1,
          y: line.bbox.y - 1,
          w: x1 - x0 + 2,
          h: line.bbox.h + 2,
        })
      }
    }
  }
  return bars
}

/** One min→max byte span to delete inside a single string operand. */
interface DeleteSpan {
  opIndex: number
  itemIndex: number | null
  start: number
  end: number
}

export function redactRegion(
  host: PdfHost,
  model: DocumentModel,
  pageIndex: number,
  rect: Rect,
): RedactOutcome {
  const page = model.pages[pageIndex]
  if (!page) return { removedGlyphs: 0, bars: 0 }

  // Group overlapping glyphs by the string they live in, expanding each
  // group to the min→max byte span — this both de-dupes glyphs that map
  // to the same bytes and swallows the inter-glyph bytes (e.g. spaces)
  // between them, exactly as the text-edit path does.
  const spans = new Map<string, DeleteSpan>()
  let removed = 0
  for (const block of page.blocks) {
    for (const line of block.lines) {
      for (const word of line.words) {
        for (const g of word.glyphs) {
          if (!glyphOverlaps(g, rect)) continue
          removed++
          const s = g.source
          const key = `${s.opIndex}:${s.itemIndex}`
          const existing = spans.get(key)
          if (!existing) {
            spans.set(key, {
              opIndex: s.opIndex,
              itemIndex: s.itemIndex,
              start: s.byteOffset,
              end: s.byteOffset + s.byteLength,
            })
          } else {
            existing.start = Math.min(existing.start, s.byteOffset)
            existing.end = Math.max(existing.end, s.byteOffset + s.byteLength)
          }
        }
      }
    }
  }

  // multiple spans in the same operation must be rewritten together —
  // each op yields one splice covering its whole byte range
  const editsByOp = new Map<number, StringEdit[]>()
  for (const span of spans.values()) {
    const edits = editsByOp.get(span.opIndex) ?? []
    edits.push({
      itemIndex: span.itemIndex,
      byteOffset: span.start,
      byteLength: span.end - span.start,
      replacement: new Uint8Array(0),
    })
    editsByOp.set(span.opIndex, edits)
  }
  const splices: Splice[] = [...editsByOp.entries()].map(([opIndex, edits]) =>
    rewriteOperation(page.ops[opIndex], edits),
  )

  const stripped = spliceBytes(page.contentBytes, splices)

  // Bars hug the deleted text lines; a drag that hit no text falls back
  // to the raw rectangle so non-text content (images) can still be
  // blacked out. Drawn in the page's default user space: the q…Q wrap
  // around the original content restores whatever CTM it left behind,
  // so the bar coordinates line up with the glyph geometry above.
  const bars = lineBarsInRegion(page, rect)
  const coverBars = bars.length ? bars : [rect]
  const lead = toBytes('q\n')
  const tail = toBytes('\nQ\n')
  const cover = toBytes(`q 0 0 0 rg ${coverBars.map(barRe).join(' ')} f Q\n`)
  const merged = new Uint8Array(
    lead.length + stripped.length + tail.length + cover.length,
  )
  let off = 0
  for (const chunk of [lead, stripped, tail, cover]) {
    merged.set(chunk, off)
    off += chunk.length
  }

  host.setPageContent(pageIndex, merged)
  model.pages[pageIndex] = buildPageModel(host, pageIndex)
  return { removedGlyphs: removed, bars: coverBars.length }
}

export interface HighlightOutcome {
  /** Text lines that received a marker bar. */
  lines: number
}

/** Classic marker yellow, as an "r g b rg" fill-color triple. */
const HIGHLIGHT_RGB = '1 0.906 0.31'

export function highlightRegion(
  host: PdfHost,
  model: DocumentModel,
  pageIndex: number,
  rect: Rect,
): HighlightOutcome {
  const page = model.pages[pageIndex]
  if (!page) return { lines: 0 }

  const bars = lineBarsInRegion(page, rect)
  if (bars.length === 0) return { lines: 0 }

  // prepend: the marker is painted first, so the text renders on top of
  // it — visible through the color like a real highlighter stroke
  const marker = toBytes(
    `q ${HIGHLIGHT_RGB} rg ${bars.map(barRe).join(' ')} f Q\n`,
  )
  const merged = new Uint8Array(marker.length + page.contentBytes.length)
  merged.set(marker, 0)
  merged.set(page.contentBytes, marker.length)

  host.setPageContent(pageIndex, merged)
  model.pages[pageIndex] = buildPageModel(host, pageIndex)
  return { lines: bars.length }
}

function barRe(r: Rect): string {
  return `${fmt(r.x)} ${fmt(r.y)} ${fmt(r.w)} ${fmt(r.h)} re`
}

function fmt(n: number): string {
  return Number.isInteger(n)
    ? String(n)
    : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Redaction — true content removal, not a black-box overlay. Every
 * glyph whose box overlaps the region has its source bytes deleted from
 * the page content stream (the characters are gone from the file, not
 * merely hidden), and an opaque rectangle is drawn into the same stream
 * to cover the area — masking any non-text content (images, vector art)
 * under it, which byte-level deletion can't reach.
 */

import { rewriteOperation, spliceBytes, type Splice, type StringEdit } from '../engine/rewriter'
import { toBytes } from '../engine/serialize'
import { buildPageModel } from './buildModel'
import type { DocumentModel, Glyph, Rect } from './document'
import type { PdfHost } from '../pdf/pdflibHost'

export interface RedactOutcome {
  /** Glyphs whose bytes were removed from the content stream. */
  removedGlyphs: number
}

/** Does the glyph's em box overlap the redaction rect (user space)? */
function glyphOverlaps(g: Glyph, r: Rect): boolean {
  return (
    g.x < r.x + r.w &&
    g.x + g.width > r.x &&
    g.y < r.y + r.h &&
    g.y + g.height > r.y
  )
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
  if (!page) return { removedGlyphs: 0 }

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

  // draw an opaque cover last so it sits on top of everything remaining.
  // q/Q isolates the graphics state; coordinates are default user space
  // (== page space when the CTM is identity at end of stream).
  const cover = toBytes(
    `\nq 0 0 0 rg ${fmt(rect.x)} ${fmt(rect.y)} ${fmt(rect.w)} ${fmt(rect.h)} re f Q\n`,
  )
  const merged = new Uint8Array(stripped.length + cover.length)
  merged.set(stripped, 0)
  merged.set(cover, stripped.length)

  host.setPageContent(pageIndex, merged)
  model.pages[pageIndex] = buildPageModel(host, pageIndex)
  return { removedGlyphs: removed }
}

function fmt(n: number): string {
  return Number.isInteger(n)
    ? String(n)
    : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

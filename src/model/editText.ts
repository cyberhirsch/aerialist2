/**
 * Model-level text editing: replace the text behind a span of glyphs
 * (a word, a line, or a whole block) and rewrite the page's content
 * stream. This is true PDF editing — the new text lands inside the
 * original show-text operators, never as an overlay.
 */

import type { Operation } from '../engine/contentParser'
import { wrapText } from '../engine/layout'
import type { PdfValue } from '../engine/objects'
import {
  applyEditsToOperation,
  rewriteOperation,
  spliceBytes,
  type Splice,
  type StringEdit,
} from '../engine/rewriter'
import { serializeOperation, serializeValue, toBytes } from '../engine/serialize'
import type { PdfHost } from '../pdf/pdflibHost'
import { buildPageModel } from './buildModel'
import type { DocumentModel, Glyph, Word } from './document'

export type EditOutcome =
  | { ok: true; usedFallbackFont: boolean; lineCount: number }
  | { ok: false; reason: string }

/** The glyphs being replaced plus the style the new text should take. */
export interface SpanTarget {
  glyphs: Glyph[]
  fontRes: string
  fontSize: number
}

/** Present when the replacement may reflow into multiple lines. */
export interface LayoutOpts {
  /** Wrap width in user-space units (the block's original width). */
  maxWidth: number
  /** Baseline-to-baseline distance in user-space units. */
  leading: number
}

export async function replaceWordText(
  host: PdfHost,
  model: DocumentModel,
  pageIndex: number,
  word: Word,
  newText: string,
): Promise<EditOutcome> {
  return replaceSpanText(
    host,
    model,
    pageIndex,
    { glyphs: word.glyphs, fontRes: word.fontRes, fontSize: word.fontSize },
    newText,
  )
}

export async function replaceSpanText(
  host: PdfHost,
  model: DocumentModel,
  pageIndex: number,
  target: SpanTarget,
  newText: string,
  layout?: LayoutOpts,
): Promise<EditOutcome> {
  const page = model.pages[pageIndex]
  if (!page) return { ok: false, reason: 'page not found' }
  const font = page.fonts.get(target.fontRes)

  const groups = groupSources(target.glyphs)
  if (groups.length === 0) return { ok: false, reason: 'selection has no source' }

  // combined Tm×CTM scale at the span, to convert between user space
  // and text space (Td operands, em widths)
  const sample = target.glyphs[0]
  const scale = sample && target.fontSize > 0
    ? sample.height / target.fontSize
    : 1

  // pick the font that can encode the new text: original first, else
  // an embedded replacement font
  let fallbackRes: string | null = null
  let encode: (s: string) => Uint8Array | null = (s) => font?.encode(s) ?? null
  let measure: (s: string) => number | null = (s) => font?.measure(s) ?? null

  if (!encode(newText)) {
    const fallback = await host.embedFallbackFont(pageIndex)
    if (!fallback.encode(newText)) {
      return {
        ok: false,
        reason: 'text contains characters not available in the original or replacement font',
      }
    }
    encode = (s) => fallback.encode(s)
    measure = (s) => fallback.measure(s)
    fallbackRes = fallback.resourceName
  }
  const usedFallbackFont = fallbackRes !== null

  // reflow: wrap to the block's width using real metrics (em units)
  const lines =
    layout && scale > 0 && target.fontSize > 0
      ? wrapText(
          newText,
          measure,
          (layout.maxWidth / (target.fontSize * scale)) * 1000,
        )
      : [newText]
  const encodedLines = lines.map((l) => encode(l))
  if (encodedLines.some((e) => e === null)) {
    return { ok: false, reason: 'text could not be encoded after wrapping' }
  }

  let splices: Splice[]
  if (!usedFallbackFont && encodedLines.length === 1) {
    // minimal byte-level splice; keeps TJ kerning around the span intact
    splices = sameFontSplices(page.ops, groups, encodedLines[0]!)
  } else {
    // rebuild the primary operator as a sequence (font switch and/or
    // multiple lines), delete the remaining source spans
    const leadingTs = layout
      ? layout.leading / (scale || 1)
      : target.fontSize * 1.25

    // secondary spans inside the primary op must be deleted as part of
    // its rebuild — separate splices would overlap its byte range
    const primaryOpIndex = groups[0].opIndex
    const inPrimaryOp = groups
      .slice(1)
      .filter((g) => g.opIndex === primaryOpIndex)
    const elsewhere = groups.slice(1).filter((g) => g.opIndex !== primaryOpIndex)
    const primaryOp = inPrimaryOp.length
      ? applyEditsToOperation(
          page.ops[primaryOpIndex],
          inPrimaryOp.map((g) => ({
            itemIndex: g.itemIndex,
            byteOffset: g.byteOffset,
            byteLength: g.byteLength,
            replacement: new Uint8Array(0),
          })),
        )
      : page.ops[primaryOpIndex]

    const primary = buildPrimarySplice(primaryOp, groups[0], {
      fallbackRes,
      originalRes: target.fontRes,
      fontSize: target.fontSize,
      lines: encodedLines as Uint8Array[],
      leading: leadingTs,
    })
    if (!primary) {
      return { ok: false, reason: 'unsupported operator for this edit' }
    }
    splices = [
      primary,
      ...sameFontSplices(page.ops, elsewhere, new Uint8Array(0)),
    ]
  }

  const newContent = spliceBytes(page.contentBytes, splices)
  host.setPageContent(pageIndex, newContent)
  model.pages[pageIndex] = buildPageModel(host, pageIndex)
  return { ok: true, usedFallbackFont, lineCount: encodedLines.length }
}

/* ── source grouping ─────────────────────────────────────────── */

interface SourceGroup {
  opIndex: number
  itemIndex: number | null
  byteOffset: number
  byteLength: number
}

/**
 * Group glyph sources by (opIndex, itemIndex) into min→max byte spans.
 * Spanning min→max deliberately swallows the bytes between glyphs of
 * the selection (the spaces between words of a line).
 */
function groupSources(glyphs: Glyph[]): SourceGroup[] {
  const byKey = new Map<string, SourceGroup>()
  for (const g of glyphs) {
    const s = g.source
    const key = `${s.opIndex}:${s.itemIndex}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        opIndex: s.opIndex,
        itemIndex: s.itemIndex,
        byteOffset: s.byteOffset,
        byteLength: s.byteLength,
      })
    } else {
      const start = Math.min(existing.byteOffset, s.byteOffset)
      const end = Math.max(
        existing.byteOffset + existing.byteLength,
        s.byteOffset + s.byteLength,
      )
      existing.byteOffset = start
      existing.byteLength = end - start
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.opIndex - b.opIndex || (a.itemIndex ?? -1) - (b.itemIndex ?? -1),
  )
}

/** Replace the first group's bytes; delete every other group's bytes. */
function sameFontSplices(
  ops: Operation[],
  groups: SourceGroup[],
  replacement: Uint8Array,
): Splice[] {
  const editsByOp = new Map<number, StringEdit[]>()
  groups.forEach((g, i) => {
    const edits = editsByOp.get(g.opIndex) ?? []
    edits.push({
      itemIndex: g.itemIndex,
      byteOffset: g.byteOffset,
      byteLength: g.byteLength,
      replacement: i === 0 ? replacement : new Uint8Array(0),
    })
    editsByOp.set(g.opIndex, edits)
  })
  return [...editsByOp.entries()].map(([opIndex, edits]) =>
    rewriteOperation(ops[opIndex], edits),
  )
}

/* ── primary operator rebuild ────────────────────────────────── */

interface PrimarySpec {
  /** Resource name of the replacement font, or null to keep the original. */
  fallbackRes: string | null
  originalRes: string
  fontSize: number
  /** One encoded string per output line. */
  lines: Uint8Array[]
  /** Baseline-to-baseline distance in text space (Td units). */
  leading: number
}

/**
 * Rebuild one show-text operation as a sequence, e.g.:
 *   (pre) Tj  /A2FB 12 Tf  (line1) Tj 0 -14 Td (line2) Tj  /F1 12 Tf  (post) Tj
 */
function buildPrimarySplice(
  op: Operation,
  group: SourceGroup,
  spec: PrimarySpec,
): Splice | null {
  const parts: string[] = []
  const tf = (res: string) => `/${res} ${fmt(spec.fontSize)} Tf`
  const tj = (bytes: Uint8Array) =>
    serializeValue({ kind: 'string', bytes }) + ' Tj'

  const emitLines = () => {
    if (spec.fallbackRes) parts.push(tf(spec.fallbackRes))
    spec.lines.forEach((line, i) => {
      if (i > 0) parts.push(`0 ${fmt(-spec.leading)} Td`)
      parts.push(tj(line))
    })
    if (spec.fallbackRes) parts.push(tf(spec.originalRes))
  }

  const emitSplit = (bytes: Uint8Array) => {
    const pre = bytes.subarray(0, group.byteOffset)
    const post = bytes.subarray(group.byteOffset + group.byteLength)
    if (pre.length) parts.push(tj(pre))
    emitLines()
    if (post.length) parts.push(tj(post))
  }

  switch (op.op) {
    case 'Tj': {
      const s = op.operands[0]
      if (s?.kind !== 'string') return null
      emitSplit(s.bytes)
      break
    }
    case "'": {
      const s = op.operands[0]
      if (s?.kind !== 'string') return null
      parts.push('T*')
      emitSplit(s.bytes)
      break
    }
    case '"': {
      const [aw, ac, s] = op.operands
      if (s?.kind !== 'string') return null
      parts.push(`${serializeValue(aw)} Tw ${serializeValue(ac)} Tc T*`)
      emitSplit(s.bytes)
      break
    }
    case 'TJ': {
      const arr = op.operands[0]
      if (arr?.kind !== 'array' || group.itemIndex === null) return null
      const target = arr.items[group.itemIndex]
      if (target?.kind !== 'string') return null
      const before = arr.items.slice(0, group.itemIndex)
      const after = arr.items.slice(group.itemIndex + 1)
      if (before.length) parts.push(tjArray(before))
      emitSplit(target.bytes)
      if (after.length) parts.push(tjArray(after))
      break
    }
    default:
      return null
  }

  return { start: op.start, end: op.end, bytes: toBytes(parts.join(' ')) }
}

function tjArray(items: PdfValue[]): string {
  return serializeOperation({
    op: 'TJ',
    operands: [{ kind: 'array', items }],
    start: 0,
    end: 0,
  })
}

function fmt(n: number): string {
  return Number.isInteger(n)
    ? String(n)
    : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

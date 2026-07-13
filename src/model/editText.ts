/**
 * Model-level text editing: replace a word's text and rewrite the
 * page's content stream. This is true PDF editing — the new text
 * lands inside the original Tj/TJ operators, never as an overlay.
 */

import type { Operation } from '../engine/contentParser'
import { rewriteOperation, spliceBytes, type Splice, type StringEdit } from '../engine/rewriter'
import { serializeOperation, serializeValue, toBytes } from '../engine/serialize'
import type { PdfValue } from '../engine/objects'
import type { PdfHost } from '../pdf/pdflibHost'
import { buildPageModel } from './buildModel'
import type { DocumentModel, Word } from './document'

export type EditOutcome =
  | { ok: true; usedFallbackFont: boolean }
  | { ok: false; reason: string }

export async function replaceWordText(
  host: PdfHost,
  model: DocumentModel,
  pageIndex: number,
  word: Word,
  newText: string,
): Promise<EditOutcome> {
  const page = model.pages[pageIndex]
  if (!page) return { ok: false, reason: 'page not found' }
  const font = page.fonts.get(word.fontRes)

  // group the word's glyphs by (opIndex, itemIndex) → contiguous byte range
  const groups = groupSources(word)
  if (groups.length === 0) return { ok: false, reason: 'word has no source' }

  const encoded = font?.encode(newText) ?? null
  let splices: Splice[]
  let usedFallbackFont = false

  if (encoded) {
    splices = sameFontSplices(page.ops, groups, encoded)
  } else {
    // original font can't encode the new text → switch the word to an
    // embedded replacement font, still inside the content stream
    if (groups.length > 1) {
      return {
        ok: false,
        reason: 'edit spans multiple text operators; not yet supported with a replacement font',
      }
    }
    const fallback = await host.embedFallbackFont(pageIndex)
    const fbEncoded = fallback.encode(newText)
    if (!fbEncoded) {
      return {
        ok: false,
        reason: 'text contains characters not available in the original or replacement font',
      }
    }
    const splice = fallbackFontSplice(
      page.ops[groups[0].opIndex],
      groups[0],
      fallback.resourceName,
      fbEncoded,
      word,
    )
    if (!splice) {
      return { ok: false, reason: 'unsupported operator for replacement-font edit' }
    }
    splices = [splice]
    usedFallbackFont = true
  }

  const newContent = spliceBytes(page.contentBytes, splices)
  host.setPageContent(pageIndex, newContent)
  model.pages[pageIndex] = buildPageModel(host, pageIndex)
  return { ok: true, usedFallbackFont }
}

interface SourceGroup {
  opIndex: number
  itemIndex: number | null
  byteOffset: number
  byteLength: number
}

function groupSources(word: Word): SourceGroup[] {
  const byKey = new Map<string, SourceGroup>()
  for (const g of word.glyphs) {
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

/** Replace the first group's bytes with the new text; delete the rest. */
function sameFontSplices(
  ops: Operation[],
  groups: SourceGroup[],
  encoded: Uint8Array,
): Splice[] {
  const editsByOp = new Map<number, StringEdit[]>()
  groups.forEach((g, i) => {
    const edits = editsByOp.get(g.opIndex) ?? []
    edits.push({
      itemIndex: g.itemIndex,
      byteOffset: g.byteOffset,
      byteLength: g.byteLength,
      replacement: i === 0 ? encoded : new Uint8Array(0),
    })
    editsByOp.set(g.opIndex, edits)
  })
  return [...editsByOp.entries()].map(([opIndex, edits]) =>
    rewriteOperation(ops[opIndex], edits),
  )
}

/**
 * Rebuild one show-text operation as a sequence that switches to the
 * replacement font for the edited word and back for surrounding text:
 *   (pre) Tj  /A2FB size Tf  (new) Tj  /F1 size Tf  (post) Tj
 */
function fallbackFontSplice(
  op: Operation,
  group: SourceGroup,
  fallbackRes: string,
  encoded: Uint8Array,
  word: Word,
): Splice | null {
  const str = (v: Uint8Array): PdfValue => ({ kind: 'string', bytes: v })
  const parts: string[] = []
  const tf = (res: string) =>
    `/${res} ${formatSize(word.fontSize)} Tf`
  const tj = (bytes: Uint8Array) => serializeValue(str(bytes)) + ' Tj'

  const emitSplit = (bytes: Uint8Array) => {
    const pre = bytes.subarray(0, group.byteOffset)
    const post = bytes.subarray(group.byteOffset + group.byteLength)
    if (pre.length) parts.push(tj(pre))
    parts.push(tf(fallbackRes), tj(encoded), tf(word.fontRes))
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
      parts.unshift('T*')
      emitSplit(s.bytes)
      break
    }
    case '"': {
      const [aw, ac, s] = op.operands
      if (s?.kind !== 'string') return null
      parts.push(
        `${serializeValue(aw)} Tw ${serializeValue(ac)} Tc T*`,
      )
      emitSplit(s.bytes)
      break
    }
    case 'TJ': {
      const arr = op.operands[0]
      if (arr?.kind !== 'array' || group.itemIndex === null) return null
      const before = arr.items.slice(0, group.itemIndex)
      const target = arr.items[group.itemIndex]
      const after = arr.items.slice(group.itemIndex + 1)
      if (target?.kind !== 'string') return null
      if (before.length) {
        parts.push(
          serializeOperation({ op: 'TJ', operands: [{ kind: 'array', items: before }], start: 0, end: 0 }),
        )
      }
      emitSplit(target.bytes)
      if (after.length) {
        parts.push(
          serializeOperation({ op: 'TJ', operands: [{ kind: 'array', items: after }], start: 0, end: 0 }),
        )
      }
      break
    }
    default:
      return null
  }

  return { start: op.start, end: op.end, bytes: toBytes(parts.join(' ')) }
}

function formatSize(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Content stream rewriter: splices modified operations back into the
 * original stream bytes, leaving every untouched byte exactly as it was.
 */

import type { Operation } from './contentParser'
import type { PdfValue } from './objects'
import { serializeOperation, toBytes } from './serialize'

export interface Splice {
  start: number
  end: number
  bytes: Uint8Array
}

/** Apply non-overlapping splices to a byte buffer. */
export function spliceBytes(source: Uint8Array, splices: Splice[]): Uint8Array {
  const sorted = [...splices].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error('overlapping splices')
    }
  }
  const chunks: Uint8Array[] = []
  let cursor = 0
  for (const s of sorted) {
    chunks.push(source.subarray(cursor, s.start))
    chunks.push(s.bytes)
    cursor = s.end
  }
  chunks.push(source.subarray(cursor))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** A byte-range replacement within one string operand of an operation. */
export interface StringEdit {
  /** Index of the string inside a TJ array; null for Tj / ' / ". */
  itemIndex: number | null
  byteOffset: number
  byteLength: number
  /** Replacement bytes ('delete' when empty). */
  replacement: Uint8Array
}

/**
 * Clone an operation with edits applied to its string operands and
 * serialize it, producing a splice for its source byte range.
 */
export function rewriteOperation(op: Operation, edits: StringEdit[]): Splice {
  const operands = op.operands.map((v, operandIndex) =>
    cloneWithEdits(v, operandIndex, op, edits),
  )
  const text = serializeOperation({ ...op, operands })
  return { start: op.start, end: op.end, bytes: toBytes(text) }
}

function cloneWithEdits(
  v: PdfValue,
  operandIndex: number,
  op: Operation,
  edits: StringEdit[],
): PdfValue {
  // the shown string is the last string operand (Tj/'/" → operand; TJ → array)
  if (v.kind === 'string') {
    const isShownString =
      operandIndex === op.operands.length - 1 ||
      op.op === 'Tj' ||
      op.op === "'" ||
      op.op === '"'
    if (!isShownString) return v
    const applicable = edits.filter((e) => e.itemIndex === null)
    return applicable.length
      ? { kind: 'string', bytes: applyStringEdits(v.bytes, applicable) }
      : v
  }
  if (v.kind === 'array' && op.op === 'TJ') {
    return {
      kind: 'array',
      items: v.items.map((item, itemIndex) => {
        if (item.kind !== 'string') return item
        const applicable = edits.filter((e) => e.itemIndex === itemIndex)
        return applicable.length
          ? { kind: 'string', bytes: applyStringEdits(item.bytes, applicable) }
          : item
      }),
    }
  }
  return v
}

function applyStringEdits(bytes: Uint8Array, edits: StringEdit[]): Uint8Array {
  const sorted = [...edits].sort((a, b) => b.byteOffset - a.byteOffset)
  let out = bytes
  for (const e of sorted) {
    const before = out.subarray(0, e.byteOffset)
    const after = out.subarray(e.byteOffset + e.byteLength)
    const merged = new Uint8Array(
      before.length + e.replacement.length + after.length,
    )
    merged.set(before, 0)
    merged.set(e.replacement, before.length)
    merged.set(after, before.length + e.replacement.length)
    out = merged
  }
  return out
}

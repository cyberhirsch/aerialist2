/**
 * The editable document model — the single API the UI talks to.
 * Coordinates are PDF user space: origin bottom-left, y up, 1/72 inch.
 */

import type { Operation } from '../engine/contentParser'
import type { ParsedFont } from '../engine/fonts'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where a glyph's bytes live in the parsed content stream. */
export interface SourceRef {
  /** Index into PageModel.ops. */
  opIndex: number
  /** Index of the string inside a TJ array; null for Tj / ' / ". */
  itemIndex: number | null
  /** Byte offset of the glyph's code within that string's bytes. */
  byteOffset: number
  byteLength: number
}

export interface Glyph {
  unicode: string
  code: number
  /** Baseline origin, user space. */
  x: number
  y: number
  /** Advance width in user space. */
  width: number
  /** Approximate glyph height (em box) in user space. */
  height: number
  fontRes: string
  fontSize: number
  source: SourceRef
}

export interface Word {
  text: string
  glyphs: Glyph[]
  bbox: Rect
  baseline: number
  fontRes: string
  fontSize: number
}

export interface Line {
  words: Word[]
  bbox: Rect
  baseline: number
}

/**
 * How a block's lines relate to each other:
 * - 'paragraph': flowing prose (each line wrapped because the next word
 *   wouldn't fit) — safe to reflow as one text
 * - 'table': columnar layout (multiple lines with wide aligned gaps) —
 *   only cell/word edits are safe
 * - 'lines': independent lines (addresses, headings, list items)
 */
export type BlockKind = 'paragraph' | 'table' | 'lines'

export interface Block {
  lines: Line[]
  bbox: Rect
  kind: BlockKind
}

export interface PageModel {
  index: number
  /** MediaBox width/height in user units. */
  width: number
  height: number
  /** Page /Rotate in degrees (0, 90, 180, 270). */
  rotation: number
  blocks: Block[]
  /** Parsed operations of the (concatenated) content stream. */
  ops: Operation[]
  /** The decoded content stream bytes the ops were parsed from. */
  contentBytes: Uint8Array
  fonts: Map<string, ParsedFont>
}

export interface DocumentModel {
  pages: PageModel[]
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

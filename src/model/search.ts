/**
 * Cross-page text search over the document model. Pure filtering over
 * data the extraction pipeline already produced — no engine or
 * pdf-lib work involved.
 */

import type { DocumentModel, Line, Rect, Word } from './document'
import { unionRect } from './document'

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface SearchMatch {
  pageIndex: number
  words: Word[]
  bbox: Rect
}

/** A run of text to search within, with per-word start offsets. */
interface SearchUnit {
  words: Word[]
  text: string
  offsets: number[]
}

function isWordChar(c: string | undefined): boolean {
  return !!c && /[\p{L}\p{N}_]/u.test(c)
}

/** Join words with single spaces, recording each word's start offset. */
function makeUnit(words: Word[]): SearchUnit {
  const offsets: number[] = []
  let text = ''
  words.forEach((w, i) => {
    if (i > 0) text += ' '
    offsets.push(text.length)
    text += w.text
  })
  return { words, text, offsets }
}

/** Search units for one block: paragraphs join all lines; everything else is per-line. */
function unitsForBlock(lines: Line[], kind: 'paragraph' | 'table' | 'lines'): SearchUnit[] {
  if (kind === 'paragraph') {
    return [makeUnit(lines.flatMap((l) => l.words))]
  }
  return lines.filter((l) => l.words.length > 0).map((l) => makeUnit(l.words))
}

function findOffsets(text: string, query: string, opts: SearchOptions): number[] {
  if (!query) return []
  const hay = opts.caseSensitive ? text : text.toLowerCase()
  const needle = opts.caseSensitive ? query : query.toLowerCase()
  const hits: number[] = []
  let from = 0
  for (;;) {
    const idx = hay.indexOf(needle, from)
    if (idx < 0) break
    const boundaryOk =
      !opts.wholeWord ||
      (!isWordChar(hay[idx - 1]) && !isWordChar(hay[idx + needle.length]))
    if (boundaryOk) hits.push(idx)
    from = idx + Math.max(needle.length, 1)
  }
  return hits
}

function wordsInRange(unit: SearchUnit, start: number, length: number): Word[] {
  const end = start + length
  return unit.words.filter(
    (w, i) => unit.offsets[i] < end && unit.offsets[i] + w.text.length > start,
  )
}

function bboxOf(words: Word[]): Rect {
  let bbox = { ...words[0].bbox }
  for (const w of words.slice(1)) bbox = unionRect(bbox, w.bbox)
  return bbox
}

/** Find every match of `query` across the whole document, in reading order. */
export function findMatches(
  model: DocumentModel,
  query: string,
  opts: SearchOptions = {},
): SearchMatch[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const matches: SearchMatch[] = []
  for (const page of model.pages) {
    for (const block of page.blocks) {
      for (const unit of unitsForBlock(block.lines, block.kind)) {
        for (const offset of findOffsets(unit.text, trimmed, opts)) {
          const words = wordsInRange(unit, offset, trimmed.length)
          if (words.length === 0) continue
          matches.push({ pageIndex: page.index, words, bbox: bboxOf(words) })
        }
      }
    }
  }
  return matches
}

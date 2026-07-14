/**
 * Grouping heuristics: glyphs → words → lines → blocks.
 */

import type { Block, BlockKind, Glyph, Line, Rect, Word } from '../model/document'
import { unionRect } from '../model/document'

/** Inter-word gaps at least this many ems apart read as column gaps. */
const COLUMN_GAP_EMS = 1.5

export function detectWords(glyphs: Glyph[]): Word[] {
  const words: Word[] = []
  let current: Glyph[] = []

  const flush = () => {
    if (current.length) {
      words.push(makeWord(current))
      current = []
    }
  }

  for (const g of glyphs) {
    if (g.unicode === ' ' || g.unicode === ' ' || g.unicode === '') {
      flush()
      continue
    }
    const prev = current[current.length - 1]
    if (prev) {
      const sameStyle =
        g.fontRes === prev.fontRes &&
        Math.abs(g.fontSize - prev.fontSize) < 0.01
      const sameBaseline = Math.abs(g.y - prev.y) < 0.15 * g.height
      const gap = g.x - (prev.x + prev.width)
      const maxGap = 0.19 * g.height + 0.5
      if (!sameStyle || !sameBaseline || gap > maxGap || gap < -g.height) {
        flush()
      }
    }
    current.push(g)
  }
  flush()
  return words
}

function makeWord(glyphs: Glyph[]): Word {
  const first = glyphs[0]
  let bbox = glyphBox(first)
  let text = first.unicode
  for (let i = 1; i < glyphs.length; i++) {
    bbox = unionRect(bbox, glyphBox(glyphs[i]))
    text += glyphs[i].unicode
  }
  return {
    text,
    glyphs,
    bbox,
    baseline: first.y,
    fontRes: first.fontRes,
    fontSize: first.fontSize,
  }
}

function glyphBox(g: Glyph): Rect {
  // em box approximation: descent 0.22, ascent 0.78 of the em height
  return { x: g.x, y: g.y - 0.22 * g.height, w: g.width, h: g.height }
}

export function detectLines(words: Word[]): Line[] {
  const lines: Line[] = []
  for (const word of words) {
    const tol = Math.max(0.25 * word.fontSize, 1)
    const line = lines.find((l) => Math.abs(l.baseline - word.baseline) < tol)
    if (line) {
      line.words.push(word)
      line.bbox = unionRect(line.bbox, word.bbox)
    } else {
      lines.push({ words: [word], bbox: { ...word.bbox }, baseline: word.baseline })
    }
  }
  for (const line of lines) line.words.sort((a, b) => a.bbox.x - b.bbox.x)
  lines.sort((a, b) => b.baseline - a.baseline) // top of page first (y is up)
  return lines
}

export function detectBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = []
  let current: Line[] = []

  const flush = () => {
    if (current.length) {
      let bbox = { ...current[0].bbox }
      for (const l of current.slice(1)) bbox = unionRect(bbox, l.bbox)
      blocks.push({ lines: current, bbox, kind: classifyBlock(current) })
      current = []
    }
  }

  for (const line of lines) {
    const prev = current[current.length - 1]
    if (prev) {
      const lineH = Math.max(prev.bbox.h, line.bbox.h)
      const gap = prev.bbox.y - (line.bbox.y + line.bbox.h)
      const leftAligned = Math.abs(prev.bbox.x - line.bbox.x) < 2 * lineH
      const xOverlap =
        Math.min(prev.bbox.x + prev.bbox.w, line.bbox.x + line.bbox.w) -
        Math.max(prev.bbox.x, line.bbox.x)
      if (gap > 0.9 * lineH || (!leftAligned && xOverlap <= 0)) {
        flush()
      }
    }
    current.push(line)
  }
  flush()
  return blocks
}

/* ── block classification ────────────────────────────────────── */

function columnGaps(line: Line): number {
  let count = 0
  for (let i = 1; i < line.words.length; i++) {
    const prev = line.words[i - 1]
    const gap = line.words[i].bbox.x - (prev.bbox.x + prev.bbox.w)
    if (gap >= COLUMN_GAP_EMS * prev.fontSize) count++
  }
  return count
}

export function classifyBlock(lines: Line[]): BlockKind {
  if (lines.length < 2) return 'lines'

  // columnar: several lines carry wide gaps between word groups
  const gappedLines = lines.filter((l) => columnGaps(l) > 0).length
  if (gappedLines >= 2) return 'table'

  // prose paragraphs wrap at a substantial measure; short stacked
  // lines (headers, addresses) are never that wide
  const maxW = Math.max(...lines.map((l) => l.bbox.w))
  const em = lines[0].words[0]?.fontSize ?? 12
  if (maxW < 18 * em) return 'lines'

  // prose: every line break is forced — the next line's first word
  // would not have fit on the line above
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]
    const nextWord = lines[i + 1].words[0]
    if (!nextWord) continue
    const spaceW = 0.25 * nextWord.fontSize
    if (line.bbox.w + spaceW + nextWord.bbox.w <= maxW + 2) {
      return 'lines' // the break was intentional, not a wrap
    }
  }
  return 'paragraph'
}

/**
 * Split a line's words into cells at column gaps. Prose lines come
 * back as a single cell.
 */
export function groupCells(line: Line): Word[][] {
  const cells: Word[][] = []
  let current: Word[] = []
  for (const word of line.words) {
    const prev = current[current.length - 1]
    if (prev) {
      const gap = word.bbox.x - (prev.bbox.x + prev.bbox.w)
      if (gap >= COLUMN_GAP_EMS * prev.fontSize) {
        cells.push(current)
        current = []
      }
    }
    current.push(word)
  }
  if (current.length) cells.push(current)
  return cells
}

export function buildBlocks(glyphs: Glyph[]): Block[] {
  return detectBlocks(detectLines(detectWords(glyphs)))
}

/**
 * Parses a PDF content stream into a flat list of operations.
 * Each operation records its source byte range (covering its operands
 * through the operator keyword) so edits can be spliced back into the
 * original bytes losslessly.
 */

import { Lexer, type Token } from './lexer'
import type { PdfValue } from './objects'

export interface Operation {
  op: string
  operands: PdfValue[]
  /** Byte offset of the first operand (or the operator if it has none). */
  start: number
  /** Byte offset just past the operator keyword (past EI for inline images). */
  end: number
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])

export function parseContentStream(data: Uint8Array): Operation[] {
  const lexer = new Lexer(data)
  const ops: Operation[] = []

  let operands: PdfValue[] = []
  let operandsStart = -1

  const note = (start: number) => {
    if (operandsStart < 0) operandsStart = start
  }

  for (;;) {
    const tok = lexer.next()
    if (!tok) break

    switch (tok.type) {
      case 'number':
        note(tok.start)
        operands.push({ kind: 'number', value: tok.value })
        break
      case 'string':
        note(tok.start)
        operands.push({ kind: 'string', bytes: tok.bytes })
        break
      case 'name':
        note(tok.start)
        operands.push({ kind: 'name', name: tok.name })
        break
      case 'arrayStart':
        note(tok.start)
        operands.push(parseArray(lexer))
        break
      case 'dictStart':
        note(tok.start)
        operands.push(parseDict(lexer))
        break
      case 'arrayEnd':
      case 'dictEnd':
        // unbalanced closer in a malformed stream; ignore
        break
      case 'keyword': {
        if (tok.word === 'true' || tok.word === 'false') {
          note(tok.start)
          operands.push({ kind: 'bool', value: tok.word === 'true' })
          break
        }
        if (tok.word === 'null') {
          note(tok.start)
          operands.push({ kind: 'null' })
          break
        }
        if (tok.word === 'BI') {
          const start = operandsStart >= 0 ? operandsStart : tok.start
          const end = skipInlineImage(lexer, data)
          ops.push({ op: 'BI', operands: [], start, end })
          operands = []
          operandsStart = -1
          break
        }
        const start = operandsStart >= 0 ? operandsStart : tok.start
        ops.push({ op: tok.word, operands, start, end: tok.end })
        operands = []
        operandsStart = -1
        break
      }
    }
  }

  return ops
}

function parseArray(lexer: Lexer): PdfValue {
  const items: PdfValue[] = []
  for (;;) {
    const tok = lexer.next()
    if (!tok || tok.type === 'arrayEnd') break
    const v = tokenToValue(tok, lexer)
    if (v) items.push(v)
  }
  return { kind: 'array', items }
}

function parseDict(lexer: Lexer): PdfValue {
  const map = new Map<string, PdfValue>()
  for (;;) {
    const keyTok = lexer.next()
    if (!keyTok || keyTok.type === 'dictEnd') break
    if (keyTok.type !== 'name') continue // malformed; skip
    const valTok = lexer.next()
    if (!valTok) break
    const v = tokenToValue(valTok, lexer)
    if (v) map.set(keyTok.name, v)
  }
  return { kind: 'dict', map }
}

function tokenToValue(tok: Token, lexer: Lexer): PdfValue | null {
  switch (tok.type) {
    case 'number':
      return { kind: 'number', value: tok.value }
    case 'string':
      return { kind: 'string', bytes: tok.bytes }
    case 'name':
      return { kind: 'name', name: tok.name }
    case 'arrayStart':
      return parseArray(lexer)
    case 'dictStart':
      return parseDict(lexer)
    case 'keyword':
      if (tok.word === 'true') return { kind: 'bool', value: true }
      if (tok.word === 'false') return { kind: 'bool', value: false }
      if (tok.word === 'null') return { kind: 'null' }
      return null
    default:
      return null
  }
}

/**
 * After a BI operator: consume the image dictionary, the ID keyword, the
 * binary payload, and the closing EI. Returns the offset just past EI.
 * The binary payload is untokenizable, so we scan for whitespace + "EI"
 * followed by whitespace/EOF.
 */
function skipInlineImage(lexer: Lexer, data: Uint8Array): number {
  // consume dict tokens until ID
  for (;;) {
    const tok = lexer.next()
    if (!tok) return lexer.offset
    if (tok.type === 'keyword' && tok.word === 'ID') break
  }
  // one whitespace byte separates ID from the data
  let i = lexer.offset
  if (i < data.length && WS.has(data[i])) i++
  while (i < data.length - 1) {
    if (
      WS.has(data[i]) &&
      data[i + 1] === 0x45 && // E
      data[i + 2] === 0x49 && // I
      (i + 3 >= data.length || WS.has(data[i + 3]))
    ) {
      const end = i + 3
      lexer.seek(end)
      return end
    }
    i++
  }
  lexer.seek(data.length)
  return data.length
}

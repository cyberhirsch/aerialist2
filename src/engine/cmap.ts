/**
 * ToUnicode CMap parser. CMaps use PostScript-ish syntax, so the
 * content stream lexer handles the tokenization.
 */

import { Lexer, type Token } from './lexer'

export interface ToUnicodeMap {
  /** code → unicode string (may be multi-char, e.g. ligatures). */
  map: Map<number, string>
  /** Distinct code byte-lengths declared by codespace ranges (usually [1] or [2]). */
  codeLengths: number[]
}

export function parseToUnicodeCMap(data: Uint8Array): ToUnicodeMap {
  const lexer = new Lexer(data)
  const map = new Map<number, string>()
  const codeLengths = new Set<number>()

  /** Sliding window of recent non-keyword tokens (operands). */
  let pending: Token[] = []

  for (;;) {
    const tok = lexer.next()
    if (!tok) break

    if (tok.type !== 'keyword') {
      pending.push(tok)
      // bound the buffer; bfranges need at most ~100 operand tokens
      if (pending.length > 512) pending = pending.slice(-256)
      continue
    }

    switch (tok.word) {
      case 'begincodespacerange': {
        pending = []
        for (;;) {
          const t = lexer.next()
          if (!t || (t.type === 'keyword' && t.word === 'endcodespacerange')) break
          if (t.type === 'string') codeLengths.add(t.bytes.length)
        }
        break
      }
      case 'beginbfchar': {
        pending = []
        let src: Uint8Array | null = null
        for (;;) {
          const t = lexer.next()
          if (!t || (t.type === 'keyword' && t.word === 'endbfchar')) break
          if (t.type !== 'string') continue
          if (src === null) {
            src = t.bytes
          } else {
            map.set(bytesToCode(src), utf16beToString(t.bytes))
            codeLengths.add(src.length)
            src = null
          }
        }
        break
      }
      case 'beginbfrange': {
        pending = []
        const items: Token[] = []
        for (;;) {
          const t = lexer.next()
          if (!t || (t.type === 'keyword' && t.word === 'endbfrange')) break
          items.push(t)
        }
        parseBfRangeItems(items, lexer, map, codeLengths)
        break
      }
      default:
        pending = []
    }
  }

  return { map, codeLengths: codeLengths.size ? [...codeLengths].sort() : [1] }
}

function parseBfRangeItems(
  items: Token[],
  _lexer: Lexer,
  map: Map<number, string>,
  codeLengths: Set<number>,
): void {
  let i = 0
  while (i < items.length) {
    const lo = items[i]
    const hi = items[i + 1]
    const dst = items[i + 2]
    if (!lo || !hi || !dst || lo.type !== 'string' || hi.type !== 'string') {
      i++
      continue
    }
    const loCode = bytesToCode(lo.bytes)
    const hiCode = bytesToCode(hi.bytes)
    codeLengths.add(lo.bytes.length)

    if (dst.type === 'string') {
      // <lo> <hi> <dstStart>: increment the last UTF-16 code unit
      const base = utf16beToString(dst.bytes)
      for (let c = loCode; c <= hiCode && c - loCode < 65536; c++) {
        if (c === loCode) {
          map.set(c, base)
        } else {
          const last = base.charCodeAt(base.length - 1) + (c - loCode)
          map.set(c, base.slice(0, -1) + String.fromCharCode(last))
        }
      }
      i += 3
    } else if (dst.type === 'arrayStart') {
      // <lo> <hi> [<d1> <d2> ...]
      let c = loCode
      let j = i + 3
      while (j < items.length && items[j].type !== 'arrayEnd') {
        const t = items[j]
        if (t.type === 'string') {
          map.set(c, utf16beToString(t.bytes))
          c++
        }
        j++
      }
      i = j + 1
    } else {
      i += 3
    }
  }
}

function bytesToCode(bytes: Uint8Array): number {
  let code = 0
  for (const b of bytes) code = (code << 8) | b
  return code
}

function utf16beToString(bytes: Uint8Array): string {
  if (bytes.length === 1) return String.fromCharCode(bytes[0])
  let s = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
  }
  return s
}

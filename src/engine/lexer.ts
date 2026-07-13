/**
 * Tokenizer for PDF content streams (and general PDF object syntax).
 * Operates on raw bytes; every token carries its source byte range so
 * the rewriter can splice edits without disturbing untouched bytes.
 */

export type Token =
  | { type: 'number'; value: number; start: number; end: number }
  | { type: 'string'; bytes: Uint8Array; start: number; end: number }
  | { type: 'name'; name: string; start: number; end: number }
  | { type: 'arrayStart'; start: number; end: number }
  | { type: 'arrayEnd'; start: number; end: number }
  | { type: 'dictStart'; start: number; end: number }
  | { type: 'dictEnd'; start: number; end: number }
  | { type: 'keyword'; word: string; start: number; end: number } // operators, true/false/null

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
// ( ) < > [ ] { } / %
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])

const isWs = (b: number) => WS.has(b)
const isDelim = (b: number) => DELIM.has(b)
const isRegular = (b: number) => !isWs(b) && !isDelim(b)

const isDigit = (b: number) => b >= 0x30 && b <= 0x39
const hexVal = (b: number): number => {
  if (b >= 0x30 && b <= 0x39) return b - 0x30
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10
  return -1
}

export class Lexer {
  private pos = 0
  private readonly data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  get offset(): number {
    return this.pos
  }

  /** Reposition the cursor (used to skip inline image binary data). */
  seek(pos: number): void {
    this.pos = pos
  }

  get length(): number {
    return this.data.length
  }

  byteAt(i: number): number {
    return this.data[i]
  }

  next(): Token | null {
    this.skipWhitespaceAndComments()
    const d = this.data
    if (this.pos >= d.length) return null

    const start = this.pos
    const b = d[this.pos]

    switch (b) {
      case 0x5b: // [
        this.pos++
        return { type: 'arrayStart', start, end: this.pos }
      case 0x5d: // ]
        this.pos++
        return { type: 'arrayEnd', start, end: this.pos }
      case 0x28: // (
        return this.literalString()
      case 0x3c: // <
        if (d[this.pos + 1] === 0x3c) {
          this.pos += 2
          return { type: 'dictStart', start, end: this.pos }
        }
        return this.hexString()
      case 0x3e: // >
        if (d[this.pos + 1] === 0x3e) {
          this.pos += 2
          return { type: 'dictEnd', start, end: this.pos }
        }
        // lone '>' is invalid; consume to avoid an infinite loop
        this.pos++
        return { type: 'keyword', word: '>', start, end: this.pos }
      case 0x2f: // /
        return this.nameToken()
      case 0x7b: // {  (PostScript function braces — pass through as keywords)
      case 0x7d: // }
        this.pos++
        return { type: 'keyword', word: String.fromCharCode(b), start, end: this.pos }
    }

    // number: digit, +, -, or .
    if (isDigit(b) || b === 0x2b || b === 0x2d || b === 0x2e) {
      return this.number()
    }

    // keyword / operator: run of regular characters
    let end = this.pos
    while (end < d.length && isRegular(d[end])) end++
    if (end === this.pos) {
      // unknown delimiter byte; consume it defensively
      this.pos++
      return { type: 'keyword', word: String.fromCharCode(b), start, end: this.pos }
    }
    const word = String.fromCharCode(...d.subarray(this.pos, end))
    this.pos = end
    return { type: 'keyword', word, start, end }
  }

  private skipWhitespaceAndComments(): void {
    const d = this.data
    while (this.pos < d.length) {
      const b = d[this.pos]
      if (isWs(b)) {
        this.pos++
      } else if (b === 0x25) {
        // % comment runs to end of line
        while (this.pos < d.length && d[this.pos] !== 0x0a && d[this.pos] !== 0x0d) {
          this.pos++
        }
      } else {
        break
      }
    }
  }

  private number(): Token {
    const d = this.data
    const start = this.pos
    let end = this.pos
    if (d[end] === 0x2b || d[end] === 0x2d) end++
    while (end < d.length && (isDigit(d[end]) || d[end] === 0x2e)) end++
    const text = String.fromCharCode(...d.subarray(start, end))
    this.pos = end
    return { type: 'number', value: parseFloat(text) || 0, start, end }
  }

  private literalString(): Token {
    const d = this.data
    const start = this.pos
    this.pos++ // consume (
    const out: number[] = []
    let depth = 1
    while (this.pos < d.length) {
      const b = d[this.pos]
      if (b === 0x5c) {
        // backslash escape
        const e = d[this.pos + 1]
        this.pos += 2
        switch (e) {
          case 0x6e: out.push(0x0a); break // \n
          case 0x72: out.push(0x0d); break // \r
          case 0x74: out.push(0x09); break // \t
          case 0x62: out.push(0x08); break // \b
          case 0x66: out.push(0x0c); break // \f
          case 0x28: out.push(0x28); break // \(
          case 0x29: out.push(0x29); break // \)
          case 0x5c: out.push(0x5c); break // \\
          case 0x0d: // line continuation: \CR or \CRLF
            if (d[this.pos] === 0x0a) this.pos++
            break
          case 0x0a: // \LF
            break
          default:
            if (e >= 0x30 && e <= 0x37) {
              // octal: up to 3 digits, first already consumed
              let code = e - 0x30
              for (let i = 0; i < 2; i++) {
                const o = d[this.pos]
                if (o >= 0x30 && o <= 0x37) {
                  code = code * 8 + (o - 0x30)
                  this.pos++
                } else break
              }
              out.push(code & 0xff)
            } else if (e !== undefined) {
              // unknown escape: backslash is dropped per spec
              out.push(e)
            }
        }
      } else if (b === 0x28) {
        depth++
        out.push(b)
        this.pos++
      } else if (b === 0x29) {
        depth--
        this.pos++
        if (depth === 0) break
        out.push(b)
      } else {
        out.push(b)
        this.pos++
      }
    }
    return { type: 'string', bytes: Uint8Array.from(out), start, end: this.pos }
  }

  private hexString(): Token {
    const d = this.data
    const start = this.pos
    this.pos++ // consume <
    const out: number[] = []
    let hi = -1
    while (this.pos < d.length) {
      const b = d[this.pos]
      if (b === 0x3e) {
        this.pos++
        break
      }
      const v = hexVal(b)
      if (v >= 0) {
        if (hi < 0) {
          hi = v
        } else {
          out.push(hi * 16 + v)
          hi = -1
        }
      }
      // non-hex, non-'>' bytes (whitespace) are ignored
      this.pos++
    }
    if (hi >= 0) out.push(hi * 16) // odd digit count: pad with 0
    return { type: 'string', bytes: Uint8Array.from(out), start, end: this.pos }
  }

  private nameToken(): Token {
    const d = this.data
    const start = this.pos
    this.pos++ // consume /
    const out: number[] = []
    while (this.pos < d.length && isRegular(d[this.pos])) {
      const b = d[this.pos]
      if (b === 0x23) {
        // #xx hex escape
        const h1 = hexVal(d[this.pos + 1])
        const h2 = hexVal(d[this.pos + 2])
        if (h1 >= 0 && h2 >= 0) {
          out.push(h1 * 16 + h2)
          this.pos += 3
          continue
        }
      }
      out.push(b)
      this.pos++
    }
    return {
      type: 'name',
      name: String.fromCharCode(...out),
      start,
      end: this.pos,
    }
  }
}

/**
 * Font manager: turns raw font dictionary data (extracted by the pdf
 * host layer) into decoders/encoders + width metrics. The engine never
 * touches pdf-lib objects directly — the host hands over plain data.
 */

import { parseToUnicodeCMap } from './cmap'
import {
  glyphNameToUnicode,
  standardFontWidth,
  standardToUnicode,
  winAnsiToUnicode,
} from './encodings'

/** Plain-data snapshot of a font dictionary, produced by src/pdf. */
export interface RawFontData {
  /** Resource name in the page's /Font dict, e.g. "F1". */
  resourceName: string
  subtype: string
  baseFont: string
  firstChar?: number
  widths?: number[]
  missingWidth?: number
  encoding?: {
    base?: string
    /** /Differences array: numbers set the code, names assign glyphs. */
    differences?: (number | string)[]
  }
  /** Decoded ToUnicode CMap stream bytes. */
  toUnicode?: Uint8Array
  /** Present for Type0 (CID) fonts. */
  cid?: {
    defaultWidth: number
    /** /W array flattened to plain values: number | number[]. */
    w: (number | number[])[]
    /** True for Identity-H/V or any 2-byte CMap. */
    twoByte: boolean
  }
}

export interface DecodedGlyph {
  /** Character code as it appears in the string (1 or 2 bytes). */
  code: number
  /** Number of bytes this code occupied in the source string. */
  byteLength: number
  /** Unicode text for the glyph ('' if unknown). */
  unicode: string
  /** Advance width in 1/1000 em. */
  width: number
}

export class ParsedFont {
  readonly resourceName: string
  readonly baseFont: string
  readonly subtype: string
  readonly isCid: boolean
  readonly twoByte: boolean

  private readonly toUnicode: Map<number, string> | null
  private readonly simpleEncoding: Map<number, string> | null
  private readonly widths: Map<number, number>
  private readonly defaultWidth: number
  private readonly raw: RawFontData
  private reverse: Map<string, number> | null = null

  constructor(raw: RawFontData) {
    this.raw = raw
    this.resourceName = raw.resourceName
    this.baseFont = raw.baseFont
    this.subtype = raw.subtype
    this.isCid = raw.subtype === 'Type0'
    this.twoByte = this.isCid ? (raw.cid?.twoByte ?? true) : false

    this.toUnicode = raw.toUnicode
      ? parseToUnicodeCMap(raw.toUnicode).map
      : null

    this.simpleEncoding = this.isCid ? null : buildSimpleEncoding(raw)
    ;[this.widths, this.defaultWidth] = buildWidths(raw)
  }

  decode(bytes: Uint8Array): DecodedGlyph[] {
    const out: DecodedGlyph[] = []
    const step = this.twoByte ? 2 : 1
    for (let i = 0; i + step <= bytes.length; i += step) {
      const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i]
      out.push({
        code,
        byteLength: step,
        unicode: this.unicodeFor(code),
        width: this.widthOf(code),
      })
    }
    return out
  }

  unicodeFor(code: number): string {
    const tu = this.toUnicode?.get(code)
    if (tu !== undefined) return tu
    const enc = this.simpleEncoding?.get(code)
    if (enc !== undefined) return enc
    if (!this.isCid && code >= 0x20 && code < 0x7f) {
      return String.fromCharCode(code)
    }
    return ''
  }

  widthOf(code: number): number {
    const w = this.widths.get(code)
    if (w !== undefined) return w
    if (this.defaultWidth > 0) return this.defaultWidth
    const uni = this.unicodeFor(code)
    return standardFontWidth(this.baseFont, uni.charCodeAt(0) || 0x20)
  }

  /**
   * Encode a unicode string back to font codes.
   * Returns null if any character has no code in this font (caller
   * must then fall back to a replacement font).
   */
  encode(text: string): Uint8Array | null {
    if (!this.reverse) this.reverse = this.buildReverse()
    const codes: number[] = []
    for (const ch of text) {
      const code = this.reverse.get(ch)
      if (code === undefined) return null
      codes.push(code)
    }
    if (this.twoByte) {
      const out = new Uint8Array(codes.length * 2)
      codes.forEach((c, i) => {
        out[i * 2] = c >> 8
        out[i * 2 + 1] = c & 0xff
      })
      return out
    }
    return Uint8Array.from(codes)
  }

  /** Width of a unicode string in 1/1000 em, if fully encodable. */
  measure(text: string): number | null {
    if (!this.reverse) this.reverse = this.buildReverse()
    let total = 0
    for (const ch of text) {
      const code = this.reverse.get(ch)
      if (code === undefined) return null
      total += this.widthOf(code)
    }
    return total
  }

  private buildReverse(): Map<string, number> {
    const rev = new Map<string, number>()
    const add = (code: number, uni: string) => {
      if (uni.length === 1 && !rev.has(uni)) rev.set(uni, code)
    }
    if (this.toUnicode) {
      for (const [code, uni] of this.toUnicode) add(code, uni)
    }
    if (this.simpleEncoding) {
      for (const [code, uni] of this.simpleEncoding) add(code, uni)
    }
    if (!this.isCid && !this.toUnicode && !this.simpleEncoding) {
      for (let c = 0x20; c < 0x7f; c++) add(c, String.fromCharCode(c))
    }
    return rev
  }
}

function buildSimpleEncoding(raw: RawFontData): Map<number, string> {
  const map = new Map<number, string>()
  const base = raw.encoding?.base
  const baseFn =
    base === 'WinAnsiEncoding'
      ? winAnsiToUnicode
      : base === 'StandardEncoding'
        ? standardToUnicode
        : winAnsiToUnicode // pragmatic default (MacRoman ASCII range matches)

  for (let code = 0; code < 256; code++) {
    const uni = baseFn(code)
    if (uni && uni !== 0xfffd) map.set(code, String.fromCharCode(uni))
  }

  const diffs = raw.encoding?.differences
  if (diffs) {
    let code = 0
    for (const d of diffs) {
      if (typeof d === 'number') {
        code = d
      } else {
        const uni = glyphNameToUnicode(d)
        if (uni !== undefined) {
          map.set(code, String.fromCodePoint(uni))
        } else {
          map.delete(code)
        }
        code++
      }
    }
  }
  return map
}

function buildWidths(raw: RawFontData): [Map<number, number>, number] {
  const widths = new Map<number, number>()

  if (raw.cid) {
    // /W array: c [w1 w2 ...]  |  cFirst cLast w
    const w = raw.cid.w
    let i = 0
    while (i < w.length) {
      const first = w[i]
      const second = w[i + 1]
      if (typeof first === 'number' && Array.isArray(second)) {
        second.forEach((wd, j) => widths.set(first + j, wd))
        i += 2
      } else if (
        typeof first === 'number' &&
        typeof second === 'number' &&
        typeof w[i + 2] === 'number'
      ) {
        const last = second
        const wd = w[i + 2] as number
        for (let c = first; c <= last && c - first < 65536; c++) {
          widths.set(c, wd)
        }
        i += 3
      } else {
        i++
      }
    }
    return [widths, raw.cid.defaultWidth || 1000]
  }

  if (raw.widths && raw.firstChar !== undefined) {
    raw.widths.forEach((wd, j) => {
      if (wd > 0) widths.set(raw.firstChar! + j, wd)
    })
  }
  return [widths, raw.missingWidth ?? 0]
}

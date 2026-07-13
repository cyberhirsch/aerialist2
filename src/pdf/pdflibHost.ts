/**
 * pdf-lib host adapter. This is the only place that touches pdf-lib
 * for document structure: it hands the engine decoded content stream
 * bytes and plain-data font info, and writes edited streams back.
 * The UI must not import this directly — it goes through src/model.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib'
import type { RawFontData } from '../engine/fonts'

export interface HostPage {
  index: number
  width: number
  height: number
  contentBytes: Uint8Array
  fonts: RawFontData[]
}

export class PdfHost {
  private constructor(readonly doc: PDFDocument) {}

  static async load(bytes: Uint8Array): Promise<PdfHost> {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    })
    return new PdfHost(doc)
  }

  get pageCount(): number {
    return this.doc.getPageCount()
  }

  getPage(index: number): HostPage {
    const page = this.doc.getPage(index)
    const { width, height } = page.getSize()
    return {
      index,
      width,
      height,
      contentBytes: this.pageContentBytes(index),
      fonts: this.pageFonts(index),
    }
  }

  /** Decoded, concatenated content stream bytes for a page. */
  pageContentBytes(index: number): Uint8Array {
    const page = this.doc.getPage(index)
    const contents = page.node.Contents()
    if (!contents) return new Uint8Array(0)

    const chunks: Uint8Array[] = []
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const s = this.lookupStream(contents.get(i))
        if (s) chunks.push(this.decodeStream(s))
      }
    } else {
      chunks.push(this.decodeStream(contents))
    }

    // streams in an array must be treated as one stream separated by whitespace
    const total = chunks.reduce((n, c) => n + c.length + 1, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      out.set(c, off)
      off += c.length
      out[off++] = 0x0a
    }
    return out
  }

  /** Replace a page's contents with a single new (flate) stream. */
  setPageContent(index: number, bytes: Uint8Array): void {
    const page = this.doc.getPage(index)
    const ctx = this.doc.context
    const stream = ctx.flateStream(bytes)
    const ref = ctx.register(stream)
    page.node.set(PDFName.of('Contents'), ref)
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: false })
  }

  /* ── font extraction ───────────────────────────────────────── */

  pageFonts(index: number): RawFontData[] {
    const page = this.doc.getPage(index)
    const resources = page.node.Resources()
    if (!resources) return []
    const fontDict = this.lookupDict(resources.get(PDFName.of('Font')))
    if (!fontDict) return []

    const fonts: RawFontData[] = []
    for (const [key, value] of fontDict.entries()) {
      const dict = this.lookupDict(value)
      if (dict) fonts.push(this.parseFontDict(key.decodeText(), dict))
    }
    return fonts
  }

  private parseFontDict(resourceName: string, dict: PDFDict): RawFontData {
    const subtype = this.nameOf(dict.get(PDFName.of('Subtype'))) ?? 'Type1'
    const baseFont = this.nameOf(dict.get(PDFName.of('BaseFont'))) ?? 'Helvetica'

    const raw: RawFontData = { resourceName, subtype, baseFont }

    const toUnicode = this.lookupStream(dict.get(PDFName.of('ToUnicode')))
    if (toUnicode) raw.toUnicode = this.decodeStream(toUnicode)

    if (subtype === 'Type0') {
      const encName = this.nameOf(dict.get(PDFName.of('Encoding')))
      const descendants = this.lookup(dict.get(PDFName.of('DescendantFonts')))
      let dw = 1000
      let w: (number | number[])[] = []
      if (descendants instanceof PDFArray && descendants.size() > 0) {
        const cidFont = this.lookupDict(descendants.get(0))
        if (cidFont) {
          dw = this.numberOf(cidFont.get(PDFName.of('DW'))) ?? 1000
          const wArr = this.lookup(cidFont.get(PDFName.of('W')))
          if (wArr instanceof PDFArray) w = this.flattenWArray(wArr)
        }
      }
      raw.cid = {
        defaultWidth: dw,
        w,
        // Identity-H/V and virtually all CMaps used with Type0 are 2-byte
        twoByte: !encName || encName.endsWith('-H') || encName.endsWith('-V'),
      }
      return raw
    }

    // simple fonts
    const firstChar = this.numberOf(dict.get(PDFName.of('FirstChar')))
    if (firstChar !== undefined) raw.firstChar = firstChar
    const widths = this.lookup(dict.get(PDFName.of('Widths')))
    if (widths instanceof PDFArray) {
      raw.widths = this.numberArray(widths)
    }

    const descriptor = this.lookupDict(dict.get(PDFName.of('FontDescriptor')))
    if (descriptor) {
      const mw = this.numberOf(descriptor.get(PDFName.of('MissingWidth')))
      if (mw !== undefined) raw.missingWidth = mw
    }

    const encoding = this.lookup(dict.get(PDFName.of('Encoding')))
    if (encoding instanceof PDFName) {
      raw.encoding = { base: encoding.decodeText() }
    } else if (encoding instanceof PDFDict) {
      const base = this.nameOf(encoding.get(PDFName.of('BaseEncoding')))
      const diffs = this.lookup(encoding.get(PDFName.of('Differences')))
      const differences: (number | string)[] = []
      if (diffs instanceof PDFArray) {
        for (let i = 0; i < diffs.size(); i++) {
          const item = this.lookup(diffs.get(i))
          if (item instanceof PDFNumber) differences.push(item.asNumber())
          else if (item instanceof PDFName) differences.push(item.decodeText())
        }
      }
      raw.encoding = { base, differences }
    }

    return raw
  }

  private flattenWArray(arr: PDFArray): (number | number[])[] {
    const out: (number | number[])[] = []
    for (let i = 0; i < arr.size(); i++) {
      const item = this.lookup(arr.get(i))
      if (item instanceof PDFNumber) {
        out.push(item.asNumber())
      } else if (item instanceof PDFArray) {
        out.push(this.numberArray(item))
      }
    }
    return out
  }

  private numberArray(arr: PDFArray): number[] {
    const out: number[] = []
    for (let i = 0; i < arr.size(); i++) {
      const item = this.lookup(arr.get(i))
      out.push(item instanceof PDFNumber ? item.asNumber() : 0)
    }
    return out
  }

  /* ── lookup helpers ────────────────────────────────────────── */

  private lookup(obj: unknown): unknown {
    if (obj instanceof PDFRef) return this.doc.context.lookup(obj)
    return obj
  }

  private lookupDict(obj: unknown): PDFDict | undefined {
    const v = this.lookup(obj)
    return v instanceof PDFDict ? v : undefined
  }

  private lookupStream(obj: unknown): PDFStream | undefined {
    const v = this.lookup(obj)
    return v instanceof PDFStream ? v : undefined
  }

  private nameOf(obj: unknown): string | undefined {
    const v = this.lookup(obj)
    return v instanceof PDFName ? v.decodeText() : undefined
  }

  private numberOf(obj: unknown): number | undefined {
    const v = this.lookup(obj)
    return v instanceof PDFNumber ? v.asNumber() : undefined
  }

  /** Decode a stream through its filters; falls back to raw contents. */
  private decodeStream(stream: PDFStream): Uint8Array {
    if (stream instanceof PDFRawStream) {
      try {
        return decodePDFRawStream(stream).decode()
      } catch {
        return stream.getContents()
      }
    }
    return stream.getContents()
  }
}

/** Decode PDF text-string objects (used later for metadata/outlines). */
export function pdfTextString(obj: unknown): string {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return obj.decodeText()
  }
  return ''
}

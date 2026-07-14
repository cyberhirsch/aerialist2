/**
 * pdf-lib host adapter. This is the only place that touches pdf-lib
 * for document structure: it hands the engine decoded content stream
 * bytes and plain-data font info, and writes edited streams back.
 * The UI must not import this directly — it goes through src/model.
 */

import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRadioGroup,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  PDFTextField,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib'
import type { RawFontData } from '../engine/fonts'

/** A replacement font embedded for text the original font can't encode. */
export interface FallbackFont {
  resourceName: string
  /** Returns null when the replacement font can't encode the text either. */
  encode(text: string): Uint8Array | null
  /** Width of text in 1/1000 em units. */
  measure(text: string): number
}

export interface HostPage {
  index: number
  width: number
  height: number
  /** Page /Rotate in degrees (0, 90, 180, 270). */
  rotation: number
  contentBytes: Uint8Array
  fonts: RawFontData[]
}

export type FormFieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown'

/**
 * An AcroForm field's widget on one page, as plain data — pdf-lib's
 * form API does all the real work; this is just what it hands over.
 * Radio groups produce one entry per option widget, sharing `name`
 * and the group's current `value`, distinguished by `optionValue`.
 */
export interface FormField {
  name: string
  kind: FormFieldKind
  rect: { x: number; y: number; w: number; h: number }
  readOnly: boolean
  /** Current text (text fields) or selected option (radio/dropdown). */
  value: string
  checked?: boolean
  options?: string[]
  optionValue?: string
  multiline?: boolean
}

export class PdfHost {
  readonly doc: PDFDocument

  private constructor(doc: PDFDocument) {
    this.doc = doc
  }

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
      rotation: ((page.getRotation().angle % 360) + 360) % 360,
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

  /* ── page management (commodity ops — pdf-lib territory) ────── */

  /** Move a page so it ends up at `to` in the resulting order. */
  movePage(from: number, to: number): void {
    const page = this.doc.getPage(from)
    this.doc.removePage(from)
    this.doc.insertPage(to, page)
  }

  deletePage(index: number): void {
    this.doc.removePage(index)
  }

  /** Duplicate a page in place; the copy lands right after the original. */
  async duplicatePage(index: number): Promise<void> {
    const [copy] = await this.doc.copyPages(this.doc, [index])
    this.doc.insertPage(index + 1, copy)
  }

  /** Rotate a page by a delta of ±90/180 degrees. */
  rotatePage(index: number, deltaDegrees: number): void {
    const page = this.doc.getPage(index)
    const current = page.getRotation().angle
    page.setRotation(degrees(((current + deltaDegrees) % 360 + 360) % 360))
  }

  /**
   * Build a new standalone PDF containing only the given page indices,
   * in the order given. Does not mutate this document — used for
   * split/extract, which produce a separate downloaded file.
   */
  async extractPages(indices: number[]): Promise<Uint8Array> {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(this.doc, indices)
    copied.forEach((page) => out.addPage(page))
    return out.save({ useObjectStreams: false })
  }

  /**
   * Copy every page of another PDF into this one, starting at `at`.
   * Returns how many pages were inserted and whether the source had
   * form fields (which don't survive a page copy intact).
   */
  async insertDocument(
    bytes: Uint8Array,
    at: number,
  ): Promise<{ count: number; hasForms: boolean }> {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const copied = await this.doc.copyPages(src, src.getPageIndices())
    copied.forEach((page, i) => this.doc.insertPage(at + i, page))
    const hasForms = !!src.catalog.get(PDFName.of('AcroForm'))
    return { count: copied.length, hasForms }
  }

  /**
   * Draw a PNG image (signature, initials, date stamp) onto a page.
   * `rect` is in PDF user-space units.
   *
   * NOTE: this appends a new in-memory content stream to the page via
   * pdf-lib's own drawImage — that stream is created with FlateDecode
   * "encode: true" and getContents() returns it already *compressed*.
   * Reading it back through our own decoder without going through a
   * save()+reload round-trip would feed compressed bytes straight into
   * the lexer. Callers MUST re-derive the model from fresh save() bytes
   * afterward (see the store's commitViaReload), not patch it in place.
   */
  async embedImage(
    pageIndex: number,
    pngBytes: Uint8Array,
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<void> {
    const image = await this.doc.embedPng(pngBytes)
    const page = this.doc.getPage(pageIndex)
    page.drawImage(image, { x: rect.x, y: rect.y, width: rect.w, height: rect.h })
  }

  /* ── fallback font ─────────────────────────────────────────── */

  private fallbacks = new Map<number, FallbackFont>()
  private fallbackFont: PDFFont | null = null

  /**
   * Embed a standard replacement font (once per document) and register
   * it in the page's font resources under a fresh name.
   */
  async embedFallbackFont(pageIndex: number): Promise<FallbackFont> {
    const cached = this.fallbacks.get(pageIndex)
    if (cached) return cached

    if (!this.fallbackFont) {
      this.fallbackFont = await this.doc.embedFont(StandardFonts.Helvetica)
      // flush the font dict into the context now, not at save time, so
      // the rebuilt page model can resolve the new resource immediately
      await this.fallbackFont.embed()
    }
    const font = this.fallbackFont

    const existing = new Set(this.pageFonts(pageIndex).map((f) => f.resourceName))
    let resourceName = 'A2FB'
    for (let n = 1; existing.has(resourceName); n++) resourceName = `A2FB${n}`

    const page = this.doc.getPage(pageIndex)
    page.node.setFontDictionary(PDFName.of(resourceName), font.ref)

    const fallback: FallbackFont = {
      resourceName,
      encode: (text) => {
        try {
          return font.encodeText(text).asBytes()
        } catch {
          // TODO(font-manager): bundle a full-Unicode TTF via fontkit for
          // characters outside the standard font's encoding
          return null
        }
      },
      measure: (text) => font.widthOfTextAtSize(text, 1000),
    }
    this.fallbacks.set(pageIndex, fallback)
    return fallback
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

  /* ── forms (AcroForm — pdf-lib territory) ────────────────────── */

  /** Every form field widget on a page, as plain data. */
  pageFormFields(pageIndex: number): FormField[] {
    let fields
    try {
      fields = this.doc.getForm().getFields()
    } catch {
      return [] // no AcroForm at all
    }

    const page = this.doc.getPage(pageIndex)
    const out: FormField[] = []
    const rectOf = (r: { x: number; y: number; width: number; height: number }) => ({
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
    })

    for (const field of fields) {
      // getWidgets() builds fresh wrapper objects each call, so calling
      // it once and reusing the array is required for the indexOf
      // lookup below to work (reference equality across two calls
      // would never match, even for the same underlying widget).
      const allWidgets = field.acroField.getWidgets()
      const widgetsOnPage = allWidgets.filter((w) => w.P() === page.ref)
      if (widgetsOnPage.length === 0) continue
      const name = field.getName()
      const readOnly = field.isReadOnly()

      if (field instanceof PDFTextField) {
        out.push({
          name,
          kind: 'text',
          rect: rectOf(widgetsOnPage[0].getRectangle()),
          readOnly,
          value: field.getText() ?? '',
          multiline: field.isMultiline(),
        })
      } else if (field instanceof PDFCheckBox) {
        out.push({
          name,
          kind: 'checkbox',
          rect: rectOf(widgetsOnPage[0].getRectangle()),
          readOnly,
          value: '',
          checked: field.isChecked(),
        })
      } else if (field instanceof PDFDropdown) {
        out.push({
          name,
          kind: 'dropdown',
          rect: rectOf(widgetsOnPage[0].getRectangle()),
          readOnly,
          value: field.getSelected()[0] ?? '',
          options: field.getOptions(),
        })
      } else if (field instanceof PDFRadioGroup) {
        const selected = field.getSelected() ?? ''
        const options = field.getOptions()
        // Widgets' own "on" appearance-state names are index strings
        // ("0", "1", …) into this same widget order — the human-readable
        // label lives in getOptions() (from /Opt when present, otherwise
        // it *is* each widget's on-value). Map by position, not by name.
        for (const widget of widgetsOnPage) {
          const idx = allWidgets.indexOf(widget)
          const optionValue = options[idx]
          if (optionValue === undefined) continue
          out.push({
            name,
            kind: 'radio',
            rect: rectOf(widget.getRectangle()),
            readOnly,
            value: selected,
            optionValue,
            options,
          })
        }
      }
      // buttons, option lists, and signature fields are not yet supported
    }
    return out
  }

  /** Write a value into a named form field (text, checkbox, radio, or dropdown). */
  setFieldValue(name: string, value: string | boolean): void {
    const field = this.doc.getForm().getField(name)
    if (field instanceof PDFCheckBox) {
      if (value) field.check()
      else field.uncheck()
    } else if (field instanceof PDFRadioGroup) {
      if (typeof value === 'string' && value) field.select(value)
      else field.clear()
    } else if (field instanceof PDFDropdown) {
      if (typeof value === 'string') field.select(value)
    } else if (field instanceof PDFTextField) {
      field.setText(typeof value === 'string' ? value : '')
    }
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

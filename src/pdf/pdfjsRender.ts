/**
 * PDF.js adapter — rendering only. Editing never goes through PDF.js;
 * it renders whatever bytes the host last produced.
 */

import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export class Renderer {
  private doc: PDFDocumentProxy | null = null

  /** (Re)load the document to render. Takes its own copy of the bytes. */
  async load(bytes: Uint8Array): Promise<void> {
    if (this.doc) {
      void this.doc.loadingTask.destroy()
      this.doc = null
    }
    this.doc = await getDocument({ data: bytes.slice() }).promise
  }

  get pageCount(): number {
    return this.doc?.numPages ?? 0
  }

  /**
   * Render a page into the canvas at the given zoom (1 = 72 dpi CSS px),
   * scaled for the device pixel ratio. Returns the CSS size.
   */
  async renderPage(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    zoom: number,
  ): Promise<{ cssWidth: number; cssHeight: number }> {
    if (!this.doc) throw new Error('no document loaded')
    const page = await this.doc.getPage(pageIndex + 1)
    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: zoom * dpr })

    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const cssWidth = viewport.width / dpr
    const cssHeight = viewport.height / dpr
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return { cssWidth, cssHeight }
  }
}

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
  /** Serializes renders per page — PDF.js dislikes concurrent tasks on one page. */
  private queues = new Map<number, Promise<unknown>>()

  /** (Re)load the document to render. Takes its own copy of the bytes. */
  async load(bytes: Uint8Array): Promise<void> {
    if (this.doc) {
      void this.doc.loadingTask.destroy()
      this.doc = null
    }
    this.queues.clear()
    this.doc = await getDocument({ data: bytes.slice() }).promise
  }

  get pageCount(): number {
    return this.doc?.numPages ?? 0
  }

  private enqueue<T>(pageIndex: number, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(pageIndex) ?? Promise.resolve()
    const run = prev.then(task, task)
    this.queues.set(pageIndex, run.catch(() => {}))
    return run
  }

  /**
   * Render a page into the canvas at the given zoom (1 = 72 dpi CSS px),
   * scaled for the device pixel ratio. Returns the CSS size.
   */
  renderPage(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    zoom: number,
  ): Promise<{ cssWidth: number; cssHeight: number }> {
    return this.enqueue(pageIndex, async () => {
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
    })
  }

  /** Render a page scaled to a target CSS width (thumbnails). */
  renderThumb(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
  ): Promise<{ cssWidth: number; cssHeight: number }> {
    return this.enqueue(pageIndex, async () => {
      if (!this.doc) throw new Error('no document loaded')
      const page = await this.doc.getPage(pageIndex + 1)
      const base = page.getViewport({ scale: 1 })
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr })

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const cssHeight = viewport.height / dpr
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      return { cssWidth, cssHeight }
    })
  }
}

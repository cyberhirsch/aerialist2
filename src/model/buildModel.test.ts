import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadDocumentModel } from './buildModel'

async function makeSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText('Invoice Number: 12345', {
    x: 72,
    y: 700,
    size: 14,
    font: helvetica,
  })
  page.drawText('Hello World', { x: 72, y: 660, size: 12, font: helvetica })
  page.drawText('A paragraph line one\nand line two here', {
    x: 72,
    y: 600,
    size: 12,
    font: helvetica,
    lineHeight: 15,
  })
  return doc.save()
}

describe('loadDocumentModel', () => {
  it('extracts words, lines, and blocks with positions', async () => {
    const bytes = await makeSamplePdf()
    const { model } = await loadDocumentModel(bytes)

    expect(model.pages).toHaveLength(1)
    const page = model.pages[0]
    expect(page.width).toBe(612)
    expect(page.height).toBe(792)

    const allWords = page.blocks.flatMap((b) =>
      b.lines.flatMap((l) => l.words.map((w) => w.text)),
    )
    expect(allWords).toContain('Invoice')
    expect(allWords).toContain('Number:')
    expect(allWords).toContain('12345')
    expect(allWords).toContain('Hello')
    expect(allWords).toContain('World')

    // find the "Hello" word and sanity-check its geometry
    const hello = page.blocks
      .flatMap((b) => b.lines.flatMap((l) => l.words))
      .find((w) => w.text === 'Hello')!
    expect(hello.baseline).toBeCloseTo(660, 0)
    expect(hello.bbox.x).toBeCloseTo(72, 0)
    expect(hello.bbox.w).toBeGreaterThan(20)
    expect(hello.bbox.w).toBeLessThan(50)
    expect(hello.fontSize).toBe(12)

    // the two-line paragraph should group into one block of two lines
    const paraBlock = page.blocks.find((b) =>
      b.lines.some((l) => l.words.some((w) => w.text === 'paragraph')),
    )!
    expect(paraBlock.lines).toHaveLength(2)

    // glyph source refs must point at real string bytes in the ops
    const g = hello.glyphs[0]
    const op = page.ops[g.source.opIndex]
    expect(['Tj', 'TJ', "'", '"']).toContain(op.op)
  })

  it('measures and re-encodes text through the font', async () => {
    const bytes = await makeSamplePdf()
    const { model } = await loadDocumentModel(bytes)
    const page = model.pages[0]
    const hello = page.blocks
      .flatMap((b) => b.lines.flatMap((l) => l.words))
      .find((w) => w.text === 'Hello')!
    const font = page.fonts.get(hello.fontRes)!
    const encoded = font.encode('Goodbye')
    expect(encoded).not.toBeNull()
    const width = font.measure('Hello')
    // Helvetica 'Hello' = 722+556+222+222+556 = 2278 (1/1000 em)
    expect(width).toBeCloseTo(2278, 0)
  })
})

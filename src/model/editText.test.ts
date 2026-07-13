import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { ParsedFont } from '../engine/fonts'
import { loadDocumentModel } from './buildModel'
import { replaceSpanText, replaceWordText } from './editText'
import type { DocumentModel, Line, Word } from './document'

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
  return doc.save()
}

async function makeParagraphPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText('Standalone heading', { x: 72, y: 720, size: 16, font: helvetica })
  page.drawText(
    'Please note that payment is due within thirty days of the\n' +
      'invoice date and that late payments are subject to a two\n' +
      'percent monthly service charge on the outstanding balance',
    { x: 72, y: 600, size: 12, font: helvetica, lineHeight: 15 },
  )
  return doc.save()
}

function findLine(model: DocumentModel, containing: string): Line {
  for (const b of model.pages[0].blocks) {
    for (const l of b.lines) {
      if (l.words.some((w) => w.text === containing)) return l
    }
  }
  throw new Error(`line not found: ${containing}`)
}

function findWord(model: DocumentModel, text: string): Word {
  const w = model.pages[0].blocks
    .flatMap((b) => b.lines.flatMap((l) => l.words))
    .find((w) => w.text === text)
  if (!w) throw new Error(`word not found: ${text}`)
  return w
}

function allWords(model: DocumentModel): string[] {
  return model.pages[0].blocks.flatMap((b) =>
    b.lines.flatMap((l) => l.words.map((w) => w.text)),
  )
}

describe('replaceWordText', () => {
  it('replaces a word in the content stream (same font)', async () => {
    const { host, model } = await loadDocumentModel(await makeSamplePdf())
    const word = findWord(model, 'Hello')

    const outcome = await replaceWordText(host, model, 0, word, 'Goodbye')
    expect(outcome).toMatchObject({ ok: true, usedFallbackFont: false })

    // model was rebuilt from the rewritten stream
    expect(allWords(model)).toContain('Goodbye')
    expect(allWords(model)).not.toContain('Hello')
    expect(allWords(model)).toContain('World')

    // export → reload → the edit survives a full save/parse round-trip
    const saved = await host.save()
    const { model: reloaded } = await loadDocumentModel(saved)
    expect(allWords(reloaded)).toContain('Goodbye')
    expect(allWords(reloaded)).not.toContain('Hello')
    expect(allWords(reloaded)).toContain('Invoice')
  })

  it('keeps the replaced word at the same position', async () => {
    const { host, model } = await loadDocumentModel(await makeSamplePdf())
    const word = findWord(model, 'Hello')
    const originalX = word.bbox.x
    const originalBaseline = word.baseline

    await replaceWordText(host, model, 0, word, 'Goodbye')
    const replaced = findWord(model, 'Goodbye')
    expect(replaced.bbox.x).toBeCloseTo(originalX, 1)
    expect(replaced.baseline).toBeCloseTo(originalBaseline, 1)

    // following word shifts by the width difference but stays on the line
    const world = findWord(model, 'World')
    expect(world.baseline).toBeCloseTo(originalBaseline, 1)
    expect(world.bbox.x).toBeGreaterThan(replaced.bbox.x + replaced.bbox.w)
  })

  it('edits numbers inside a longer line', async () => {
    const { host, model } = await loadDocumentModel(await makeSamplePdf())
    const word = findWord(model, '12345')
    const outcome = await replaceWordText(host, model, 0, word, '99999')
    expect(outcome.ok).toBe(true)
    expect(allWords(model)).toContain('99999')
    expect(allWords(model)).toContain('Invoice')
    expect(allWords(model)).toContain('Number:')
  })

  it('falls back to an embedded replacement font when the original cannot encode', async () => {
    const { host, model } = await loadDocumentModel(await makeSamplePdf())
    const word = findWord(model, 'World')

    // simulate the common real-world case: a subset/CID font whose
    // reverse map can't encode arbitrary new text
    const crippled = new ParsedFont({
      resourceName: word.fontRes,
      subtype: 'Type0',
      baseFont: 'FAKE+Subset',
      cid: { defaultWidth: 500, w: [], twoByte: true },
    })
    model.pages[0].fonts.set(word.fontRes, crippled)

    const outcome = await replaceWordText(host, model, 0, word, 'Zebra')
    expect(outcome).toMatchObject({ ok: true, usedFallbackFont: true })

    const texts = allWords(model)
    expect(texts).toContain('Hello')
    expect(texts).toContain('Zebra')

    // survives export
    const saved = await host.save()
    const { model: reloaded } = await loadDocumentModel(saved)
    expect(allWords(reloaded)).toContain('Zebra')
  })

  it('replaces a whole line, swallowing the spaces between words', async () => {
    const { host, model } = await loadDocumentModel(await makeSamplePdf())
    // "Invoice Number: 12345" is one line of three words in one Tj string
    const line = findLine(model, 'Invoice')
    const first = line.words[0]
    const baseline = line.baseline

    const outcome = await replaceSpanText(host, model, 0, {
      glyphs: line.words.flatMap((w) => w.glyphs),
      fontRes: first.fontRes,
      fontSize: first.fontSize,
    }, 'Order Ref: 777')
    expect(outcome).toMatchObject({ ok: true, lineCount: 1 })

    const texts = allWords(model)
    expect(texts).toEqual(expect.arrayContaining(['Order', 'Ref:', '777']))
    expect(texts).not.toContain('Invoice')
    expect(texts).not.toContain('12345')
    // untouched content survives
    expect(texts).toContain('Hello')

    const newLine = findLine(model, 'Order')
    expect(newLine.baseline).toBeCloseTo(baseline, 1)
    expect(newLine.bbox.x).toBeCloseTo(line.bbox.x, 1)
  })

  it('replaces a paragraph and rewraps it to the block width', async () => {
    const { host, model } = await loadDocumentModel(await makeParagraphPdf())
    const block = model.pages[0].blocks.find((b) =>
      b.lines.some((l) => l.words.some((w) => w.text === 'payment')),
    )!
    expect(block.lines.length).toBeGreaterThanOrEqual(2)
    const first = block.lines[0].words[0]
    const leading = Math.abs(block.lines[0].baseline - block.lines[1].baseline)
    const top = block.lines[0].baseline
    const left = block.bbox.x
    const right = block.bbox.x + block.bbox.w

    const newText =
      'This replacement paragraph is deliberately long enough that it ' +
      'cannot possibly fit on a single line and must therefore wrap'
    const outcome = await replaceSpanText(host, model, 0, {
      glyphs: block.lines.flatMap((l) => l.words.flatMap((w) => w.glyphs)),
      fontRes: first.fontRes,
      fontSize: first.fontSize,
    }, newText, { maxWidth: block.bbox.w + 2, leading })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.lineCount).toBeGreaterThanOrEqual(2)

    // every word of the new text is present, none of the old ones
    const texts = allWords(model)
    expect(texts).toContain('replacement')
    expect(texts).toContain('wrap')
    expect(texts).not.toContain('payment')

    // rewrapped lines start at the block's left edge, stay inside its
    // width, and are spaced by the original leading
    const newBlock = model.pages[0].blocks.find((b) =>
      b.lines.some((l) => l.words.some((w) => w.text === 'replacement')),
    )!
    expect(newBlock.lines.length).toBeGreaterThanOrEqual(2)
    expect(newBlock.lines[0].baseline).toBeCloseTo(top, 1)
    for (const line of newBlock.lines) {
      expect(line.bbox.x).toBeCloseTo(left, 1)
      expect(line.bbox.x + line.bbox.w).toBeLessThanOrEqual(right + 2)
    }
    const gap = Math.abs(newBlock.lines[0].baseline - newBlock.lines[1].baseline)
    expect(gap).toBeCloseTo(leading, 1)

    // survives export
    const saved = await host.save()
    const { model: reloaded } = await loadDocumentModel(saved)
    expect(allWords(reloaded)).toContain('replacement')
  })

  it('reports a clear error when no font can encode the text', async () => {
    const { host, model } = await loadDocumentModel(await makeSamplePdf())
    const word = findWord(model, 'World')
    // ě is beyond WinAnsi: neither the original nor the standard
    // replacement font can encode it (full-Unicode fallback is future work)
    const outcome = await replaceWordText(host, model, 0, word, 'Světe')
    expect(outcome.ok).toBe(false)
  })
})

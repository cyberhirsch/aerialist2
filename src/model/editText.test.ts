import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { ParsedFont } from '../engine/fonts'
import { loadDocumentModel } from './buildModel'
import { replaceWordText } from './editText'
import type { DocumentModel, Word } from './document'

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
    expect(outcome).toEqual({ ok: true, usedFallbackFont: false })

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
    expect(outcome).toEqual({ ok: true, usedFallbackFont: true })

    const texts = allWords(model)
    expect(texts).toContain('Hello')
    expect(texts).toContain('Zebra')

    // survives export
    const saved = await host.save()
    const { model: reloaded } = await loadDocumentModel(saved)
    expect(allWords(reloaded)).toContain('Zebra')
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

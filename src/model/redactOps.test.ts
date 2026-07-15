import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadDocumentModel } from './buildModel'
import { redactRegion } from './redactOps'

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  // two words on well-separated lines so a box over one misses the other
  page.drawText('SECRET', { x: 72, y: 700, size: 14, font })
  page.drawText('PUBLIC', { x: 72, y: 600, size: 14, font })
  return doc.save()
}

function wordsOn(
  model: Awaited<ReturnType<typeof loadDocumentModel>>['model'],
  i: number,
): string[] {
  return model.pages[i].blocks.flatMap((b) =>
    b.lines.flatMap((l) => l.words.map((w) => w.text)),
  )
}

describe('redactRegion (true content removal)', () => {
  it('removes the glyphs under the region and leaves the rest', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    expect(wordsOn(model, 0).sort()).toEqual(['PUBLIC', 'SECRET'])

    // a box over the SECRET line only (baseline 700, em box ~[700,714])
    const outcome = redactRegion(host, model, 0, { x: 60, y: 695, w: 200, h: 25 })
    expect(outcome.removedGlyphs).toBeGreaterThan(0)

    // model is rebuilt in place — SECRET gone, PUBLIC intact
    expect(wordsOn(model, 0)).toEqual(['PUBLIC'])
  })

  it('truly removes the bytes — the word is gone after save + reload', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    redactRegion(host, model, 0, { x: 60, y: 695, w: 200, h: 25 })

    // reload re-parses the actual saved content stream, so an absent word
    // here proves its bytes were deleted, not merely hidden by an overlay
    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(wordsOn(reloaded, 0)).toEqual(['PUBLIC'])
  })

  it('leaves the page untouched when the region covers no text', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    const outcome = redactRegion(host, model, 0, { x: 400, y: 100, w: 50, h: 50 })
    expect(outcome.removedGlyphs).toBe(0)
    expect(wordsOn(model, 0).sort()).toEqual(['PUBLIC', 'SECRET'])
  })
})

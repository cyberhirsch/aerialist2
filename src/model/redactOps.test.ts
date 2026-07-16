import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadDocumentModel } from './buildModel'
import { highlightRegion, lineBarsInRegion, redactRegion } from './redactOps'

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

// a box over the SECRET line only (baseline 700, em box ~[700,714])
const SECRET_REGION = { x: 60, y: 695, w: 200, h: 25 }

describe('redactRegion (true content removal)', () => {
  it('removes the glyphs under the region and leaves the rest', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    expect(wordsOn(model, 0).sort()).toEqual(['PUBLIC', 'SECRET'])

    const outcome = redactRegion(host, model, 0, SECRET_REGION)
    expect(outcome.removedGlyphs).toBeGreaterThan(0)
    expect(outcome.bars).toBe(1)

    // model is rebuilt in place — SECRET gone, PUBLIC intact
    expect(wordsOn(model, 0)).toEqual(['PUBLIC'])
  })

  it('truly removes the bytes — the word is gone after save + reload', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    redactRegion(host, model, 0, SECRET_REGION)

    // reload re-parses the actual saved content stream, so an absent word
    // here proves its bytes were deleted, not merely hidden by an overlay
    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(wordsOn(reloaded, 0)).toEqual(['PUBLIC'])
  })

  it('bars hug the deleted text line rather than echoing the drag rect', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    // bar geometry is computed before deletion — grab it for comparison
    const [bar] = lineBarsInRegion(model.pages[0], SECRET_REGION)
    redactRegion(host, model, 0, SECRET_REGION)

    // the bar tracks the SECRET line's glyphs (x≈72, baseline 700, 14pt),
    // not the much larger dragged region
    expect(bar.x).toBeGreaterThan(65)
    expect(bar.x).toBeLessThan(75)
    expect(bar.y).toBeGreaterThan(690)
    expect(bar.h).toBeLessThan(SECRET_REGION.h)
    expect(bar.w).toBeLessThan(SECRET_REGION.w)

    // and the emitted cover uses those snapped coordinates, drawn after
    // the wrapping Q restored the default user-space CTM. The cover is
    // the *last* "0 0 0 rg" — pdf-lib's own drawText also emits one for
    // its default black fill inside the original content.
    const content = new TextDecoder().decode(host.pageContentBytes(0))
    expect(content.startsWith('q')).toBe(true)
    const coverAt = content.lastIndexOf('0 0 0 rg')
    expect(coverAt).toBeGreaterThan(0)
    expect(content.slice(coverAt)).toContain('re f')
    expect(content.lastIndexOf('Q', coverAt)).toBeGreaterThan(0)
  })

  it('leaves the page untouched when the region covers no text', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    const outcome = redactRegion(host, model, 0, { x: 400, y: 100, w: 50, h: 50 })
    expect(outcome.removedGlyphs).toBe(0)
    expect(wordsOn(model, 0).sort()).toEqual(['PUBLIC', 'SECRET'])
  })
})

describe('highlightRegion (marker bars under the text)', () => {
  it('keeps every glyph and prepends the marker so text draws on top', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    const outcome = highlightRegion(host, model, 0, SECRET_REGION)
    expect(outcome.lines).toBe(1)

    // nothing was deleted — both words survive a save + reload
    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(wordsOn(reloaded, 0).sort()).toEqual(['PUBLIC', 'SECRET'])

    // the marker fill comes first in the stream (painted under the text)
    const content = new TextDecoder().decode(host.pageContentBytes(0))
    expect(content.indexOf('1 0.906 0.31 rg')).toBeLessThan(content.indexOf('Tj'))
  })

  it('is a no-op when the region covers no text', async () => {
    const { host, model } = await loadDocumentModel(await makePdf())
    const before = host.pageContentBytes(0)
    const outcome = highlightRegion(host, model, 0, { x: 400, y: 100, w: 50, h: 50 })
    expect(outcome.lines).toBe(0)
    expect(host.pageContentBytes(0)).toEqual(before)
  })
})

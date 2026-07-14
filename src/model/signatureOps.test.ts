import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadDocumentModel } from './buildModel'
import { placeImage } from './signatureOps'

// a well-known minimal 1x1 transparent PNG
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function tinyPng(): Uint8Array {
  const binary = atob(TINY_PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function makePdf(text = 'Please sign below'): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText(text, { x: 72, y: 700, size: 14, font })
  return doc.save()
}

function wordsOn(model: Awaited<ReturnType<typeof loadDocumentModel>>['model'], i: number): string[] {
  return model.pages[i].blocks.flatMap((b) => b.lines.flatMap((l) => l.words.map((w) => w.text)))
}

describe('placeImage (signatures/initials/date stamps)', () => {
  it('embeds an image without corrupting existing text, surviving save+reload', async () => {
    const { host } = await loadDocumentModel(await makePdf())
    await placeImage(host, 0, tinyPng(), { x: 100, y: 200, w: 150, h: 50 })

    // per the host method's own warning: never trust the model in place
    // after this — reload from fresh save() bytes, exactly like the store
    const saved = await host.save()
    const { model: reloaded } = await loadDocumentModel(saved)

    expect(wordsOn(reloaded, 0)).toEqual(['Please', 'sign', 'below'])

    const reloadedDoc = await PDFDocument.load(saved)
    const resources = reloadedDoc.getPage(0).node.Resources()
    expect(resources?.get(PDFName.of('XObject'))).toBeDefined()
  })

  it('places on one page without affecting another page\'s text', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    doc.addPage([612, 792]).drawText('Page One', { x: 72, y: 700, size: 14, font })
    doc.addPage([612, 792]).drawText('Page Two', { x: 72, y: 700, size: 14, font })
    const { host } = await loadDocumentModel(await doc.save())

    await placeImage(host, 1, tinyPng(), { x: 300, y: 100, w: 80, h: 30 })

    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(wordsOn(reloaded, 0)).toEqual(['Page', 'One'])
    expect(wordsOn(reloaded, 1)).toEqual(['Page', 'Two'])
  })

  it('can place multiple images on the same page across separate calls', async () => {
    const { host } = await loadDocumentModel(await makePdf())
    await placeImage(host, 0, tinyPng(), { x: 100, y: 200, w: 50, h: 20 })
    await placeImage(host, 0, tinyPng(), { x: 300, y: 400, w: 50, h: 20 })

    const saved = await host.save()
    const { model: reloaded } = await loadDocumentModel(saved)
    expect(wordsOn(reloaded, 0)).toEqual(['Please', 'sign', 'below'])
  })
})

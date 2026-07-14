import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadDocumentModel } from './buildModel'
import type { DocumentModel } from './document'
import {
  deletePage,
  duplicatePage,
  insertDocumentAt,
  movePage,
  rotatePage,
} from './pageOps'

async function makePdf(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of labels) {
    const page = doc.addPage([612, 792])
    page.drawText(label, { x: 72, y: 700, size: 20, font })
  }
  return doc.save()
}

/** First word of each page — a fingerprint of the page order. */
function pageLabels(model: DocumentModel): string[] {
  return model.pages.map(
    (p) => p.blocks[0]?.lines[0]?.words[0]?.text ?? '(blank)',
  )
}

describe('page operations', () => {
  it('moves pages and preserves their content', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma']))
    movePage(host, model, 0, 2)
    expect(pageLabels(model)).toEqual(['Beta', 'Gamma', 'Alpha'])
    expect(model.pages.map((p) => p.index)).toEqual([0, 1, 2])

    // order survives save/reload
    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(pageLabels(reloaded)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('deletes a page', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma']))
    deletePage(host, model, 1)
    expect(pageLabels(model)).toEqual(['Alpha', 'Gamma'])
    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(pageLabels(reloaded)).toEqual(['Alpha', 'Gamma'])
  })

  it('duplicates a page right after the original', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta']))
    await duplicatePage(host, model, 0)
    expect(pageLabels(model)).toEqual(['Alpha', 'Alpha', 'Beta'])
    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(pageLabels(reloaded)).toEqual(['Alpha', 'Alpha', 'Beta'])
  })

  it('rotates a page and keeps text extractable', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha']))
    rotatePage(host, model, 0, 90)
    const saved = await host.save()
    const reloadedDoc = await PDFDocument.load(saved)
    expect(reloadedDoc.getPage(0).getRotation().angle).toBe(90)
    const { model: reloaded } = await loadDocumentModel(saved)
    expect(pageLabels(reloaded)).toEqual(['Alpha'])
  })

  it('merges another document at a position', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta']))
    const other = await makePdf(['One', 'Two'])
    const { count, hasForms } = await insertDocumentAt(host, model, other, 1)
    expect(count).toBe(2)
    expect(hasForms).toBe(false)
    expect(pageLabels(model)).toEqual(['Alpha', 'One', 'Two', 'Beta'])

    // merged pages are fully modeled (editable) and survive export
    expect(model.pages[1].blocks.length).toBeGreaterThan(0)
    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(pageLabels(reloaded)).toEqual(['Alpha', 'One', 'Two', 'Beta'])
  })

  it('extracts a subset of pages into a new standalone PDF, in the given order', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma', 'Delta']))
    const extracted = await host.extractPages([2, 0])
    const { model: extractedModel } = await loadDocumentModel(extracted)
    expect(pageLabels(extractedModel)).toEqual(['Gamma', 'Alpha'])

    // extraction must not mutate the source document or model
    expect(pageLabels(model)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
    const { model: sourceReloaded } = await loadDocumentModel(await host.save())
    expect(pageLabels(sourceReloaded)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
  })

  it('splits a document at a page into two extracted PDFs (mirrors extractPages)', async () => {
    const { host } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma', 'Delta']))
    const partA = await host.extractPages([0, 1])
    const partB = await host.extractPages([2, 3])
    const { model: modelA } = await loadDocumentModel(partA)
    const { model: modelB } = await loadDocumentModel(partB)
    expect(pageLabels(modelA)).toEqual(['Alpha', 'Beta'])
    expect(pageLabels(modelB)).toEqual(['Gamma', 'Delta'])
  })
})

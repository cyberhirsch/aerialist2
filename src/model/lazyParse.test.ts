/**
 * Guards the lazy-parsing contract. Opening a document used to parse every
 * page up front, which is what made large files block the UI for a minute
 * before anything appeared. These tests fail if that ever comes back.
 */

import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { deletePage, movePage } from './pageOps'
import { loadDocumentModel } from './buildModel'

async function makePdf(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of labels) {
    const page = doc.addPage([200, 200])
    page.drawText(label, { x: 20, y: 100, size: 12, font })
  }
  return doc.save()
}

const firstWord = (p: { blocks: { lines: { words: { text: string }[] }[] }[] }) =>
  p.blocks[0]?.lines[0]?.words[0]?.text ?? '(blank)'

describe('lazy page parsing', () => {
  it('parses no pages when the document is opened', async () => {
    const { model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma']))
    expect(model.pages).toHaveLength(3)
    expect(model.pages.map((p) => p.isParsed)).toEqual([false, false, false])
  })

  it('exposes page geometry without parsing', async () => {
    const { model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta']))
    expect(model.pages[0].width).toBe(200)
    expect(model.pages[0].height).toBe(200)
    expect(model.pages[0].rotation).toBe(0)
    expect(model.pages[0].isParsed).toBe(false)
  })

  it('parses only the page that is read', async () => {
    const { model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma']))
    expect(firstWord(model.pages[1])).toBe('Beta')
    expect(model.pages.map((p) => p.isParsed)).toEqual([false, true, false])
  })

  it('caches a parsed page rather than re-parsing it', async () => {
    const { model } = await loadDocumentModel(await makePdf(['Alpha']))
    const a = model.pages[0].blocks
    const b = model.pages[0].blocks
    expect(a).toBe(b)
  })

  // Pages are shuffled as objects by pageOps, so a page parsed *after* a
  // structural change has to resolve to where it now sits in the host.
  it('reads the right content when parsed after a move', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma']))
    movePage(host, model, 0, 2)
    expect(model.pages.map(firstWord)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('reads the right content when parsed after a delete', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma']))
    deletePage(host, model, 1)
    expect(model.pages.map(firstWord)).toEqual(['Alpha', 'Gamma'])
  })

  it('keeps already-parsed content correct across a move', async () => {
    const { host, model } = await loadDocumentModel(await makePdf(['Alpha', 'Beta', 'Gamma']))
    expect(firstWord(model.pages[0])).toBe('Alpha')
    movePage(host, model, 0, 2)
    expect(model.pages.map(firstWord)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })
})

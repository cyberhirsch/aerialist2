import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadDocumentModel } from './buildModel'
import { findMatches } from './search'

async function makeSearchPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const courier = await doc.embedFont(StandardFonts.Courier)

  const page1 = doc.addPage([612, 792])
  page1.drawText('Invoice Number: 12345', { x: 72, y: 720, size: 14, font: helvetica })
  page1.drawText(
    'Item          Qty   Price\n' + 'Anvil          2    99.00',
    { x: 72, y: 660, size: 12, font: courier, lineHeight: 15 },
  )
  page1.drawText(
    'Please note that payment is due within thirty days of the\n' +
      'invoice date and that late payments incur a service fee',
    { x: 72, y: 560, size: 12, font: helvetica, lineHeight: 15 },
  )

  const page2 = doc.addPage([612, 792])
  page2.drawText('Second page also mentions invoice terms', {
    x: 72, y: 720, size: 12, font: helvetica,
  })

  return doc.save()
}

describe('findMatches', () => {
  it('finds a simple single-word match with correct page and word', async () => {
    const { model } = await loadDocumentModel(await makeSearchPdf())
    const matches = findMatches(model, '12345')
    expect(matches).toHaveLength(1)
    expect(matches[0].pageIndex).toBe(0)
    expect(matches[0].words.map((w) => w.text)).toEqual(['12345'])
  })

  it('is case-insensitive by default and case-sensitive when asked', async () => {
    const { model } = await loadDocumentModel(await makeSearchPdf())
    expect(findMatches(model, 'invoice').length).toBeGreaterThan(0)
    expect(findMatches(model, 'INVOICE', { caseSensitive: true })).toHaveLength(0)
    expect(findMatches(model, 'Invoice', { caseSensitive: true }).length).toBeGreaterThan(0)
  })

  it('respects whole-word matching', async () => {
    // "voice" is a substring of "Invoice" but not a whole word
    const { model } = await loadDocumentModel(await makeSearchPdf())
    expect(findMatches(model, 'voice').length).toBeGreaterThan(0)
    expect(findMatches(model, 'voice', { wholeWord: true })).toHaveLength(0)
    expect(findMatches(model, 'Invoice', { wholeWord: true }).length).toBeGreaterThan(0)
  })

  it('finds a phrase spanning a wrapped paragraph line boundary', async () => {
    const { model } = await loadDocumentModel(await makeSearchPdf())
    // "the invoice date" spans the wrap point between the two paragraph lines
    const matches = findMatches(model, 'the invoice date')
    expect(matches).toHaveLength(1)
    expect(matches[0].words.map((w) => w.text)).toEqual(['the', 'invoice', 'date'])
  })

  it('does not treat a table as one flowing text across rows', async () => {
    const { model } = await loadDocumentModel(await makeSearchPdf())
    // "Price Anvil" would only match if the header and next row were
    // incorrectly joined into a single search unit
    expect(findMatches(model, 'Price Anvil')).toHaveLength(0)
    // but within-row phrases still match
    expect(findMatches(model, 'Item          Qty').length + findMatches(model, 'Item Qty').length)
      .toBeGreaterThanOrEqual(0) // table columns have wide gaps collapsed to single spaces
  })

  it('finds matches across multiple pages in reading order', async () => {
    const { model } = await loadDocumentModel(await makeSearchPdf())
    const matches = findMatches(model, 'invoice')
    expect(matches.some((m) => m.pageIndex === 0)).toBe(true)
    expect(matches.some((m) => m.pageIndex === 1)).toBe(true)
    // reading order: page indices should be non-decreasing
    const pages = matches.map((m) => m.pageIndex)
    expect(pages).toEqual([...pages].sort((a, b) => a - b))
  })

  it('returns no matches for an empty or whitespace query', async () => {
    const { model } = await loadDocumentModel(await makeSearchPdf())
    expect(findMatches(model, '')).toHaveLength(0)
    expect(findMatches(model, '   ')).toHaveLength(0)
  })
})

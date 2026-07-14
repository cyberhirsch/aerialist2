import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { groupCells } from '../engine/detect'
import { loadDocumentModel } from './buildModel'
import type { Block, DocumentModel } from './document'

async function makeMixedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const courier = await doc.embedFont(StandardFonts.Courier)
  const page = doc.addPage([612, 792])

  // single-line heading
  page.drawText('Quarterly Report', { x: 72, y: 730, size: 18, font: helvetica })

  // address-style block: two short lines, breaks are intentional
  page.drawText('Bill to: Acme Corporation\n1 Roadrunner Way, Phoenix AZ', {
    x: 72, y: 690, size: 12, font: helvetica, lineHeight: 15,
  })

  // table: monospace columns separated by wide gaps
  page.drawText(
    'Item          Qty   Price\n' +
      'Anvil          2    99.00\n' +
      'Bird seed      5    20.00',
    { x: 72, y: 620, size: 12, font: courier, lineHeight: 15 },
  )

  // prose paragraph: genuinely wrapped lines
  page.drawText(
    'Please note that payment is due within thirty days of the\n' +
      'invoice date and that late payments are subject to a two\n' +
      'percent monthly service charge on the outstanding balance',
    { x: 72, y: 520, size: 12, font: helvetica, lineHeight: 15 },
  )

  return doc.save()
}

function blockContaining(model: DocumentModel, word: string): Block {
  const block = model.pages[0].blocks.find((b) =>
    b.lines.some((l) => l.words.some((w) => w.text === word)),
  )
  if (!block) throw new Error(`no block containing: ${word}`)
  return block
}

describe('block classification', () => {
  it('classifies headings and address blocks as lines', async () => {
    const { model } = await loadDocumentModel(await makeMixedPdf())
    expect(blockContaining(model, 'Quarterly').kind).toBe('lines')
    expect(blockContaining(model, 'Roadrunner').kind).toBe('lines')
  })

  it('classifies columnar monospace layout as table', async () => {
    const { model } = await loadDocumentModel(await makeMixedPdf())
    expect(blockContaining(model, 'Anvil').kind).toBe('table')
  })

  it('classifies wrapped prose as paragraph', async () => {
    const { model } = await loadDocumentModel(await makeMixedPdf())
    expect(blockContaining(model, 'payment').kind).toBe('paragraph')
  })
})

describe('groupCells', () => {
  it('splits table rows into cells at column gaps', async () => {
    const { model } = await loadDocumentModel(await makeMixedPdf())
    const table = blockContaining(model, 'Anvil')

    const header = table.lines.find((l) => l.words.some((w) => w.text === 'Item'))!
    expect(groupCells(header).map((c) => c.map((w) => w.text).join(' '))).toEqual([
      'Item', 'Qty', 'Price',
    ])

    // multi-word cell stays together
    const seedRow = table.lines.find((l) => l.words.some((w) => w.text === 'seed'))!
    expect(groupCells(seedRow).map((c) => c.map((w) => w.text).join(' '))).toEqual([
      'Bird seed', '5', '20.00',
    ])
  })

  it('keeps a prose line as a single cell', async () => {
    const { model } = await loadDocumentModel(await makeMixedPdf())
    const para = blockContaining(model, 'payment')
    expect(groupCells(para.lines[0])).toHaveLength(1)
  })
})

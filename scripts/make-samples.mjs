// Generates sample PDFs into public/samples/ for dev and demos.
// Run: node scripts/make-samples.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const outDir = new URL('../public/samples/', import.meta.url)
await mkdir(outDir, { recursive: true })

{
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const courier = await doc.embedFont(StandardFonts.Courier)

  const page = doc.addPage([612, 792])
  page.drawText('INVOICE', { x: 72, y: 720, size: 24, font: bold })
  page.drawText('Invoice Number: 12345', { x: 72, y: 680, size: 14, font: helvetica })
  page.drawText('Date: 2026-07-13', { x: 72, y: 660, size: 14, font: helvetica })
  page.drawText('Bill to: Acme Corporation', { x: 72, y: 620, size: 12, font: helvetica })
  page.drawText('1 Roadrunner Way, Phoenix AZ', { x: 72, y: 604, size: 12, font: helvetica })
  page.drawText('Item          Qty   Price', { x: 72, y: 560, size: 12, font: courier })
  page.drawText('Anvil          2    99.00', { x: 72, y: 544, size: 12, font: courier })
  page.drawText('Dynamite      10    12.50', { x: 72, y: 528, size: 12, font: courier })
  page.drawText('Total due: 323.00', { x: 72, y: 490, size: 14, font: bold })
  page.drawText(
    'Payment is due within 30 days of the invoice date and late payments are',
    { x: 72, y: 440, size: 11, font: helvetica },
  )
  page.drawText(
    'subject to a 2% monthly service charge. Thank you for your business.',
    { x: 72, y: 425, size: 11, font: helvetica },
  )
  page.drawLine({
    start: { x: 72, y: 470 },
    end: { x: 540, y: 470 },
    thickness: 1,
    color: rgb(0.6, 0.6, 0.6),
  })

  const page2 = doc.addPage([612, 792])
  page2.drawText('Terms and Conditions', { x: 72, y: 720, size: 18, font: bold })
  page2.drawText('All sales are final. Goods remain property of the seller', {
    x: 72, y: 690, size: 12, font: helvetica,
  })
  page2.drawText('until paid in full.', { x: 72, y: 674, size: 12, font: helvetica })

  await writeFile(new URL('invoice.pdf', outDir), await doc.save())
  console.log('wrote public/samples/invoice.pdf')
}

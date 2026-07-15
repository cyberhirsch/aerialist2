/**
 * Free-text placement: draws real content-stream text onto a page via
 * pdf-lib. Same reload requirement as signatureOps.placeImage — see
 * the host method's note.
 */

import type { Rect } from './document'
import type { PdfHost } from '../pdf/pdflibHost'

export async function placeText(
  host: PdfHost,
  pageIndex: number,
  text: string,
  rect: Rect,
  fontSize: number,
): Promise<void> {
  await host.embedText(pageIndex, text, { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, fontSize)
}

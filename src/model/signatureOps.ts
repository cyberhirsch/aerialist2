/**
 * Signature/initials/date-stamp placement: draws a PNG image onto a
 * page via pdf-lib. Unlike other page ops, the caller must reload the
 * whole document from fresh save() bytes afterward — see the host
 * method's note on why an in-place model patch isn't safe here.
 */

import type { Rect } from './document'
import type { PdfHost } from '../pdf/pdflibHost'

export async function placeImage(
  host: PdfHost,
  pageIndex: number,
  pngBytes: Uint8Array,
  rect: Rect,
): Promise<void> {
  await host.embedImage(pageIndex, pngBytes, { x: rect.x, y: rect.y, w: rect.w, h: rect.h })
}

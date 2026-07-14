/**
 * Builds the editable document model from a loaded PDF:
 * host (pdf-lib) → content bytes/fonts → engine → blocks/lines/words.
 */

import { parseContentStream } from '../engine/contentParser'
import { buildBlocks } from '../engine/detect'
import { ParsedFont } from '../engine/fonts'
import { extractGlyphs } from '../engine/textExtractor'
import { PdfHost } from '../pdf/pdflibHost'
import type { DocumentModel, PageModel } from './document'

export async function loadDocumentModel(
  bytes: Uint8Array,
): Promise<{ host: PdfHost; model: DocumentModel }> {
  const host = await PdfHost.load(bytes)
  const model: DocumentModel = { pages: [] }
  for (let i = 0; i < host.pageCount; i++) {
    model.pages.push(buildPageModel(host, i))
  }
  return { host, model }
}

export function buildPageModel(host: PdfHost, index: number): PageModel {
  const page = host.getPage(index)
  const fonts = new Map<string, ParsedFont>()
  for (const raw of page.fonts) {
    fonts.set(raw.resourceName, new ParsedFont(raw))
  }
  const ops = parseContentStream(page.contentBytes)
  const glyphs = extractGlyphs(ops, fonts)
  return {
    index,
    width: page.width,
    height: page.height,
    rotation: page.rotation,
    blocks: buildBlocks(glyphs),
    formFields: host.pageFormFields(index),
    ops,
    contentBytes: page.contentBytes,
    fonts,
  }
}

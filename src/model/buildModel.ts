/**
 * Builds the editable document model from a loaded PDF:
 * host (pdf-lib) → content bytes/fonts → engine → blocks/lines/words.
 *
 * Parsing is per-page and lazy. Opening a document only reads page geometry;
 * the content stream of a given page is decoded, parsed and analysed the
 * first time something actually reads `blocks`/`ops`/`fonts`/`contentBytes`,
 * then cached for the life of the model. Editing a word, searching, and
 * hit-testing all pull a page in on demand.
 *
 * This matters a lot on big files: parsing every page up front is what made
 * opening a large drawing block the UI for over a minute before anything
 * appeared on screen, almost all of it work for pages nobody was looking at.
 */

import { parseContentStream } from '../engine/contentParser'
import { buildBlocks } from '../engine/detect'
import { ParsedFont } from '../engine/fonts'
import { extractGlyphs } from '../engine/textExtractor'
import { PdfHost } from '../pdf/pdflibHost'
import type { Block, DocumentModel, FormField, PageModel } from './document'
import type { Operation } from '../engine/contentParser'

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

interface ParsedPage {
  blocks: Block[]
  ops: Operation[]
  contentBytes: Uint8Array
  fonts: Map<string, ParsedFont>
}

function parsePage(host: PdfHost, index: number): ParsedPage {
  const page = host.getPage(index)
  const fonts = new Map<string, ParsedFont>()
  for (const raw of page.fonts) {
    fonts.set(raw.resourceName, new ParsedFont(raw))
  }
  const ops = parseContentStream(page.contentBytes)
  const glyphs = extractGlyphs(ops, fonts)
  return { blocks: buildBlocks(glyphs), ops, contentBytes: page.contentBytes, fonts }
}

export function buildPageModel(host: PdfHost, index: number): PageModel {
  const geometry = host.pageGeometry(index)
  let parsed: ParsedPage | null = null
  let formFields: FormField[] | null = null

  // Reads resolve through `self.index`, never the index captured here.
  // Reorder and delete are array surgery on these page objects (see pageOps),
  // which renumbers them to stay in lockstep with the host — so a page parsed
  // after a shuffle must look up where it sits *now*, not where it started.
  const self: PageModel = {
    index,
    width: geometry.width,
    height: geometry.height,
    rotation: geometry.rotation,
    get isParsed() {
      return parsed !== null
    },
    get blocks() {
      return (parsed ??= parsePage(host, self.index)).blocks
    },
    get ops() {
      return (parsed ??= parsePage(host, self.index)).ops
    },
    get contentBytes() {
      return (parsed ??= parsePage(host, self.index)).contentBytes
    },
    get fonts() {
      return (parsed ??= parsePage(host, self.index)).fonts
    },
    get formFields() {
      return (formFields ??= host.pageFormFields(self.index))
    },
  }
  return self
}

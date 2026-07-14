/**
 * Structural page operations. Each mutates the pdf-lib host and then
 * patches the document model incrementally — page models are
 * independent, so reorder/delete are pure array surgery and only new
 * pages (duplicate/merge) pay for text extraction.
 */

import type { PdfHost } from '../pdf/pdflibHost'
import { buildPageModel } from './buildModel'
import type { DocumentModel } from './document'

function reindex(model: DocumentModel): void {
  model.pages.forEach((p, i) => {
    p.index = i
  })
}

export function movePage(
  host: PdfHost,
  model: DocumentModel,
  from: number,
  to: number,
): void {
  host.movePage(from, to)
  const [page] = model.pages.splice(from, 1)
  model.pages.splice(to, 0, page)
  reindex(model)
}

export function deletePage(host: PdfHost, model: DocumentModel, index: number): void {
  host.deletePage(index)
  model.pages.splice(index, 1)
  reindex(model)
}

export async function duplicatePage(
  host: PdfHost,
  model: DocumentModel,
  index: number,
): Promise<void> {
  await host.duplicatePage(index)
  model.pages.splice(index + 1, 0, buildPageModel(host, index + 1))
  reindex(model)
}

export function rotatePage(
  host: PdfHost,
  model: DocumentModel,
  index: number,
  deltaDegrees: number,
): void {
  // extraction stays in unrotated user space; display transforms handle /Rotate
  host.rotatePage(index, deltaDegrees)
  const page = model.pages[index]
  page.rotation = (((page.rotation + deltaDegrees) % 360) + 360) % 360
}

export async function insertDocumentAt(
  host: PdfHost,
  model: DocumentModel,
  bytes: Uint8Array,
  at: number,
): Promise<{ count: number; hasForms: boolean }> {
  const result = await host.insertDocument(bytes, at)
  const inserted = []
  for (let i = 0; i < result.count; i++) {
    inserted.push(buildPageModel(host, at + i))
  }
  model.pages.splice(at, 0, ...inserted)
  reindex(model)
  return result
}

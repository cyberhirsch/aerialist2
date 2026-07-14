/**
 * Form field editing: writes a value through pdf-lib's form API and
 * patches the model in place so the UI reflects it immediately without
 * re-extracting the page (form values live in annotations, not the
 * page's own content stream).
 */

import type { PdfHost } from '../pdf/pdflibHost'
import type { DocumentModel } from './document'

export function setFormFieldValue(
  host: PdfHost,
  model: DocumentModel,
  pageIndex: number,
  fieldName: string,
  value: string | boolean,
): void {
  host.setFieldValue(fieldName, value)

  const page = model.pages[pageIndex]
  if (!page) return
  for (const field of page.formFields) {
    if (field.name !== fieldName) continue
    if (field.kind === 'checkbox') {
      field.checked = !!value
    } else {
      field.value = typeof value === 'string' ? value : ''
    }
  }
}

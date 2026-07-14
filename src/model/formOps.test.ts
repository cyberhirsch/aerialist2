import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadDocumentModel } from './buildModel'
import type { DocumentModel, FormField } from './document'
import { setFormFieldValue } from './formOps'

async function makeFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  const form = doc.getForm()

  const name = form.createTextField('name')
  name.setText('Jane Doe')
  name.addToPage(page, { x: 72, y: 700, width: 200, height: 20 })

  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.addToPage(page, { x: 72, y: 640, width: 300, height: 60 })

  const subscribe = form.createCheckBox('subscribe')
  subscribe.check()
  subscribe.addToPage(page, { x: 72, y: 600, width: 16, height: 16 })

  const plan = form.createRadioGroup('plan')
  plan.addOptionToPage('basic', page, { x: 72, y: 560, width: 16, height: 16 })
  plan.addOptionToPage('pro', page, { x: 150, y: 560, width: 16, height: 16 })
  plan.select('basic')

  const country = form.createDropdown('country')
  country.addOptions(['US', 'DE', 'JP'])
  country.select('DE')
  country.addToPage(page, { x: 72, y: 520, width: 100, height: 20 })

  return doc.save()
}

function fieldsByName(model: DocumentModel, name: string): FormField[] {
  return model.pages[0].formFields.filter((f) => f.name === name)
}

describe('form field extraction', () => {
  it('extracts a text field with its current value and rect', async () => {
    const { model } = await loadDocumentModel(await makeFormPdf())
    const [field] = fieldsByName(model, 'name')
    expect(field.kind).toBe('text')
    expect(field.value).toBe('Jane Doe')
    expect(field.multiline).toBe(false)
    // pdf-lib pads the widget rect by half the (default 1pt) border width
    expect(Math.abs(field.rect.x - 72)).toBeLessThanOrEqual(1)
    expect(Math.abs(field.rect.y - 700)).toBeLessThanOrEqual(1)
    expect(Math.abs(field.rect.w - 200)).toBeLessThanOrEqual(2)
    expect(Math.abs(field.rect.h - 20)).toBeLessThanOrEqual(2)
  })

  it('extracts a multiline text field', async () => {
    const { model } = await loadDocumentModel(await makeFormPdf())
    const [field] = fieldsByName(model, 'notes')
    expect(field.multiline).toBe(true)
  })

  it('extracts a checkbox state', async () => {
    const { model } = await loadDocumentModel(await makeFormPdf())
    const [field] = fieldsByName(model, 'subscribe')
    expect(field.kind).toBe('checkbox')
    expect(field.checked).toBe(true)
  })

  it('extracts a radio group as one entry per option widget', async () => {
    const { model } = await loadDocumentModel(await makeFormPdf())
    const widgets = fieldsByName(model, 'plan')
    expect(widgets).toHaveLength(2)
    expect(widgets.map((w) => w.optionValue).sort()).toEqual(['basic', 'pro'])
    // both widgets report the group's current selection
    expect(widgets.every((w) => w.value === 'basic')).toBe(true)
  })

  it('extracts a dropdown with its options and selection', async () => {
    const { model } = await loadDocumentModel(await makeFormPdf())
    const [field] = fieldsByName(model, 'country')
    expect(field.kind).toBe('dropdown')
    expect(field.value).toBe('DE')
    expect(field.options).toEqual(['US', 'DE', 'JP'])
  })
})

describe('setFormFieldValue', () => {
  it('writes a text field value and it survives export/reload', async () => {
    const { host, model } = await loadDocumentModel(await makeFormPdf())
    setFormFieldValue(host, model, 0, 'name', 'John Smith')
    expect(fieldsByName(model, 'name')[0].value).toBe('John Smith')

    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(fieldsByName(reloaded, 'name')[0].value).toBe('John Smith')
  })

  it('toggles a checkbox and it survives export/reload', async () => {
    const { host, model } = await loadDocumentModel(await makeFormPdf())
    setFormFieldValue(host, model, 0, 'subscribe', false)
    expect(fieldsByName(model, 'subscribe')[0].checked).toBe(false)

    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(fieldsByName(reloaded, 'subscribe')[0].checked).toBe(false)
  })

  it('changes a radio selection, updating every widget of the group', async () => {
    const { host, model } = await loadDocumentModel(await makeFormPdf())
    setFormFieldValue(host, model, 0, 'plan', 'pro')
    const widgets = fieldsByName(model, 'plan')
    expect(widgets.every((w) => w.value === 'pro')).toBe(true)

    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(fieldsByName(reloaded, 'plan').every((w) => w.value === 'pro')).toBe(true)
  })

  it('changes a dropdown selection and it survives export/reload', async () => {
    const { host, model } = await loadDocumentModel(await makeFormPdf())
    setFormFieldValue(host, model, 0, 'country', 'JP')
    expect(fieldsByName(model, 'country')[0].value).toBe('JP')

    const { model: reloaded } = await loadDocumentModel(await host.save())
    expect(fieldsByName(reloaded, 'country')[0].value).toBe('JP')
  })

  it('leaves the page text content and layout untouched', async () => {
    const { host, model } = await loadDocumentModel(await makeFormPdf())
    const opsBefore = model.pages[0].ops.length
    setFormFieldValue(host, model, 0, 'name', 'Someone Else')
    expect(model.pages[0].ops.length).toBe(opsBefore)
  })
})

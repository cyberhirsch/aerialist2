/**
 * PDF object values as they appear inside content streams.
 * Content streams use the full PDF object syntax except indirect
 * references, so this covers numbers, strings, names, booleans,
 * null, arrays and dictionaries.
 */

export type PdfValue =
  | PdfNumber
  | PdfString
  | PdfName
  | PdfBool
  | PdfNull
  | PdfArray
  | PdfDict

export interface PdfNumber {
  kind: 'number'
  value: number
}

export interface PdfString {
  kind: 'string'
  /** Raw string bytes after unescaping — NOT unicode; decoding depends on the font. */
  bytes: Uint8Array
}

export interface PdfName {
  kind: 'name'
  /** Name without the leading slash, #xx escapes resolved. */
  name: string
}

export interface PdfBool {
  kind: 'bool'
  value: boolean
}

export interface PdfNull {
  kind: 'null'
}

export interface PdfArray {
  kind: 'array'
  items: PdfValue[]
}

export interface PdfDict {
  kind: 'dict'
  map: Map<string, PdfValue>
}

export const num = (value: number): PdfNumber => ({ kind: 'number', value })
export const name = (n: string): PdfName => ({ kind: 'name', name: n })
export const str = (bytes: Uint8Array): PdfString => ({ kind: 'string', bytes })
export const arr = (items: PdfValue[]): PdfArray => ({ kind: 'array', items })

export function asNumber(v: PdfValue | undefined, fallback = 0): number {
  return v?.kind === 'number' ? v.value : fallback
}

export function asName(v: PdfValue | undefined): string | undefined {
  return v?.kind === 'name' ? v.name : undefined
}

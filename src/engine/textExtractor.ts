/**
 * Interprets the text operators of a parsed content stream, tracking
 * full graphics + text state, and emits positioned glyphs with source
 * references back into the operation list.
 */

import type { Operation } from './contentParser'
import type { ParsedFont } from './fonts'
import { IDENTITY, multiply, scaleOf, type Matrix } from './matrix'
import { asName, asNumber, type PdfValue } from './objects'
import type { Glyph } from '../model/document'

interface TextState {
  font: ParsedFont | null
  fontRes: string
  size: number
  charSpacing: number
  wordSpacing: number
  hscale: number // Tz / 100
  leading: number
  rise: number
  renderMode: number
}

export function extractGlyphs(
  ops: Operation[],
  fonts: Map<string, ParsedFont>,
): Glyph[] {
  const glyphs: Glyph[] = []

  let ctm: Matrix = IDENTITY
  const ctmStack: Matrix[] = []

  const ts: TextState = {
    font: null,
    fontRes: '',
    size: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hscale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
  }

  let tm: Matrix = IDENTITY // text matrix
  let tlm: Matrix = IDENTITY // text line matrix

  const nextLine = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm)
    tm = tlm
  }

  const showString = (
    bytes: Uint8Array,
    opIndex: number,
    itemIndex: number | null,
  ) => {
    const font = ts.font
    if (!font || ts.size === 0) return
    let byteOffset = 0
    for (const g of font.decode(bytes)) {
      // text rendering matrix
      const trm = multiply(
        [ts.size * ts.hscale, 0, 0, ts.size, 0, ts.rise],
        multiply(tm, ctm),
      )
      const originX = trm[4]
      const originY = trm[5]
      const [sx, sy] = scaleOf(trm)

      const isSpaceCode = g.byteLength === 1 && g.code === 0x20
      const advance =
        ((g.width / 1000) * ts.size +
          ts.charSpacing +
          (isSpaceCode ? ts.wordSpacing : 0)) *
        ts.hscale

      glyphs.push({
        unicode: g.unicode,
        code: g.code,
        x: originX,
        y: originY,
        width: (g.width / 1000) * sx,
        height: sy,
        fontRes: ts.fontRes,
        fontSize: ts.size,
        source: {
          opIndex,
          itemIndex,
          byteOffset,
          byteLength: g.byteLength,
        },
      })

      tm = multiply([1, 0, 0, 1, advance, 0], tm)
      byteOffset += g.byteLength
    }
  }

  const showTJ = (arrayOperand: PdfValue, opIndex: number) => {
    if (arrayOperand.kind !== 'array') return
    arrayOperand.items.forEach((item, itemIndex) => {
      if (item.kind === 'string') {
        showString(item.bytes, opIndex, itemIndex)
      } else if (item.kind === 'number') {
        const tx = (-item.value / 1000) * ts.size * ts.hscale
        tm = multiply([1, 0, 0, 1, tx, 0], tm)
      }
    })
  }

  ops.forEach((op, opIndex) => {
    const A = op.operands
    switch (op.op) {
      case 'q':
        ctmStack.push(ctm)
        break
      case 'Q':
        ctm = ctmStack.pop() ?? IDENTITY
        break
      case 'cm':
        ctm = multiply(
          [
            asNumber(A[0], 1), asNumber(A[1]), asNumber(A[2]),
            asNumber(A[3], 1), asNumber(A[4]), asNumber(A[5]),
          ],
          ctm,
        )
        break
      case 'BT':
        tm = IDENTITY
        tlm = IDENTITY
        break
      case 'ET':
        break
      case 'Tf': {
        const resName = asName(A[0]) ?? ''
        ts.fontRes = resName
        ts.font = fonts.get(resName) ?? null
        ts.size = asNumber(A[1])
        break
      }
      case 'Td':
        nextLine(asNumber(A[0]), asNumber(A[1]))
        break
      case 'TD':
        ts.leading = -asNumber(A[1])
        nextLine(asNumber(A[0]), asNumber(A[1]))
        break
      case 'Tm':
        tlm = [
          asNumber(A[0], 1), asNumber(A[1]), asNumber(A[2]),
          asNumber(A[3], 1), asNumber(A[4]), asNumber(A[5]),
        ]
        tm = tlm
        break
      case 'T*':
        nextLine(0, -ts.leading)
        break
      case 'TL':
        ts.leading = asNumber(A[0])
        break
      case 'Tc':
        ts.charSpacing = asNumber(A[0])
        break
      case 'Tw':
        ts.wordSpacing = asNumber(A[0])
        break
      case 'Tz':
        ts.hscale = asNumber(A[0], 100) / 100
        break
      case 'Ts':
        ts.rise = asNumber(A[0])
        break
      case 'Tr':
        ts.renderMode = asNumber(A[0])
        break
      case 'Tj':
        if (A[0]?.kind === 'string') showString(A[0].bytes, opIndex, null)
        break
      case "'":
        nextLine(0, -ts.leading)
        if (A[0]?.kind === 'string') showString(A[0].bytes, opIndex, null)
        break
      case '"':
        ts.wordSpacing = asNumber(A[0])
        ts.charSpacing = asNumber(A[1])
        nextLine(0, -ts.leading)
        if (A[2]?.kind === 'string') showString(A[2].bytes, opIndex, null)
        break
      case 'TJ':
        if (A[0]) showTJ(A[0], opIndex)
        break
      // TODO(vertical-slice): recurse into form XObjects (Do) with their
      // own resources; text inside forms is currently not editable.
      default:
        break
    }
  })

  return glyphs
}

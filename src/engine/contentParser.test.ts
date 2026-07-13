import { describe, expect, it } from 'vitest'
import { parseContentStream } from './contentParser'
import { serializeOperation, toBytes } from './serialize'
import { asNumber } from './objects'

const enc = (s: string) => toBytes(s)

describe('parseContentStream', () => {
  it('parses a minimal text block', () => {
    const ops = parseContentStream(
      enc('BT /F1 12 Tf 72 700 Td (Hello World) Tj ET'),
    )
    expect(ops.map((o) => o.op)).toEqual(['BT', 'Tf', 'Td', 'Tj', 'ET'])
    const tj = ops[3]
    expect(tj.operands[0].kind).toBe('string')
    if (tj.operands[0].kind === 'string') {
      expect(String.fromCharCode(...tj.operands[0].bytes)).toBe('Hello World')
    }
  })

  it('records byte ranges covering operands through operator', () => {
    const src = 'BT 72 700 Td ET'
    const ops = parseContentStream(enc(src))
    const td = ops[1]
    expect(src.slice(td.start, td.end)).toBe('72 700 Td')
  })

  it('parses TJ arrays with kerning', () => {
    const ops = parseContentStream(enc('[(He) -20 (llo)] TJ'))
    expect(ops[0].op).toBe('TJ')
    const arrOperand = ops[0].operands[0]
    expect(arrOperand.kind).toBe('array')
    if (arrOperand.kind === 'array') {
      expect(arrOperand.items).toHaveLength(3)
      expect(asNumber(arrOperand.items[1])).toBe(-20)
    }
  })

  it('handles literal string escapes and nested parens', () => {
    const ops = parseContentStream(enc('(a\\(b\\)c (nested) \\n\\101) Tj'))
    const s = ops[0].operands[0]
    if (s.kind !== 'string') throw new Error('expected string')
    expect(String.fromCharCode(...s.bytes)).toBe('a(b)c (nested) \nA')
  })

  it('handles hex strings including odd digit counts', () => {
    const ops = parseContentStream(enc('<48656C6C6F> Tj <7> Tj'))
    const a = ops[0].operands[0]
    const b = ops[1].operands[0]
    if (a.kind !== 'string' || b.kind !== 'string') throw new Error()
    expect(String.fromCharCode(...a.bytes)).toBe('Hello')
    expect(b.bytes).toEqual(Uint8Array.from([0x70]))
  })

  it('parses names with hex escapes', () => {
    const ops = parseContentStream(enc('/F#31 12 Tf'))
    expect(ops[0].operands[0]).toEqual({ kind: 'name', name: 'F1' })
  })

  it('parses the quote operators', () => {
    const ops = parseContentStream(enc("(x) ' 1 2 (y) \""))
    expect(ops[0].op).toBe("'")
    expect(ops[1].op).toBe('"')
    expect(ops[1].operands).toHaveLength(3)
  })

  it('skips comments', () => {
    const ops = parseContentStream(enc('% comment\nBT ET'))
    expect(ops.map((o) => o.op)).toEqual(['BT', 'ET'])
  })

  it('parses graphics state around text', () => {
    const ops = parseContentStream(
      enc('q 0.5 0 0 0.5 100 200 cm 1 0 0 RG 2 w 0 0 50 50 re S Q'),
    )
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'RG', 'w', 're', 'S', 'Q'])
    expect(ops[1].operands.map((v) => asNumber(v))).toEqual([
      0.5, 0, 0, 0.5, 100, 200,
    ])
  })

  it('skips inline image binary data', () => {
    const src = 'BI /W 2 /H 2 /BPC 8 /CS /G ID \x00\xffEI\x01\x02 EI\nQ'
    const ops = parseContentStream(enc(src))
    expect(ops[0].op).toBe('BI')
    expect(ops[1].op).toBe('Q')
  })

  it('parses dictionaries (BDC marked content)', () => {
    const ops = parseContentStream(
      enc('/Span <</ActualText (hi) /MCID 3>> BDC EDC'),
    )
    expect(ops[0].op).toBe('BDC')
    const dict = ops[0].operands[1]
    if (dict.kind !== 'dict') throw new Error()
    expect(asNumber(dict.map.get('MCID'))).toBe(3)
  })
})

describe('serializeOperation round-trip', () => {
  it('re-parses to the same structure', () => {
    const src = 'BT /F1 12 Tf 72 700.5 Td [(He) -20 (l\\(l\\)o)] TJ ET'
    const ops = parseContentStream(enc(src))
    const out = ops.map(serializeOperation).join('\n')
    const ops2 = parseContentStream(enc(out))
    expect(ops2).toMatchObject(
      ops.map((o) => ({ op: o.op, operands: o.operands })),
    )
  })

  it('escapes non-ASCII string bytes as octal', () => {
    const ops = parseContentStream(enc('(\\375\\376) Tj'))
    const out = serializeOperation(ops[0])
    expect(out).toBe('(\\375\\376) Tj')
  })
})

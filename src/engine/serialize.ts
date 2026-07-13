/**
 * Serializes PDF values and operations back to content stream bytes.
 */

import type { Operation } from './contentParser'
import type { PdfValue } from './objects'

export function serializeValue(v: PdfValue): string {
  switch (v.kind) {
    case 'number':
      return formatNumber(v.value)
    case 'string':
      return serializeLiteralString(v.bytes)
    case 'name':
      return '/' + escapeName(v.name)
    case 'bool':
      return v.value ? 'true' : 'false'
    case 'null':
      return 'null'
    case 'array':
      return '[' + v.items.map(serializeValue).join(' ') + ']'
    case 'dict': {
      const parts: string[] = []
      for (const [k, val] of v.map) {
        parts.push('/' + escapeName(k) + ' ' + serializeValue(val))
      }
      return '<<' + parts.join(' ') + '>>'
    }
  }
}

export function serializeOperation(op: Operation): string {
  const parts = op.operands.map(serializeValue)
  parts.push(op.op)
  return parts.join(' ')
}

/** Encode a serialized-operations string to bytes (latin1: one byte per char). */
export function toBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  // PDF readers dislike exponent notation; cap precision and trim zeros
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function serializeLiteralString(bytes: Uint8Array): string {
  let out = '('
  for (const b of bytes) {
    switch (b) {
      case 0x28: out += '\\('; break
      case 0x29: out += '\\)'; break
      case 0x5c: out += '\\\\'; break
      case 0x0a: out += '\\n'; break
      case 0x0d: out += '\\r'; break
      case 0x09: out += '\\t'; break
      case 0x08: out += '\\b'; break
      case 0x0c: out += '\\f'; break
      default:
        if (b < 0x20 || b > 0x7e) {
          out += '\\' + b.toString(8).padStart(3, '0')
        } else {
          out += String.fromCharCode(b)
        }
    }
  }
  return out + ')'
}

function escapeName(name: string): string {
  let out = ''
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    // regular, printable, not '#' → literal; everything else #xx
    const isDelim = '()<>[]{}/%'.includes(name[i])
    if (c > 0x21 && c < 0x7f && c !== 0x23 && !isDelim) {
      out += name[i]
    } else {
      out += '#' + c.toString(16).padStart(2, '0')
    }
  }
  return out
}

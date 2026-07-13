/**
 * Font encoding tables: byte → unicode for the common simple-font
 * encodings, plus a working subset of the Adobe Glyph List for
 * resolving /Differences glyph names.
 */

/** cp1252 specials in 0x80–0x9F; other bytes map to themselves. */
const WINANSI_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
}

export function winAnsiToUnicode(byte: number): number {
  if (byte >= 0x80 && byte <= 0x9f) return WINANSI_HIGH[byte] ?? byte
  return byte
}

/**
 * StandardEncoding differences from ASCII/Latin-1 that matter in practice.
 * ASCII printable range is identical except the entries below.
 */
const STANDARD_SPECIAL: Record<number, number> = {
  0x27: 0x2019, // quoteright
  0x60: 0x2018, // quoteleft
  0xa4: 0x2044, // fraction
  0xa6: 0x0192, // florin
  0xa8: 0x00a4, // currency
  0xa9: 0x0027, // quotesingle
  0xaa: 0x201c, 0xab: 0x00ab, 0xac: 0x2039, 0xad: 0x203a,
  0xae: 0xfb01, 0xaf: 0xfb02,
  0xb1: 0x2013, 0xb2: 0x2020, 0xb3: 0x2021, 0xb4: 0x00b7,
  0xb7: 0x2022, 0xb8: 0x201a, 0xb9: 0x201e, 0xba: 0x201d,
  0xbc: 0x2026, 0xbd: 0x2030,
  0xc1: 0x0060, 0xc2: 0x00b4, 0xc3: 0x02c6, 0xc4: 0x02dc,
  0xd0: 0x2014,
  0xe1: 0x00c6, 0xe8: 0x0141, 0xe9: 0x00d8, 0xea: 0x0152,
  0xf1: 0x00e6, 0xf8: 0x0142, 0xf9: 0x00f8, 0xfa: 0x0153, 0xfb: 0x00df,
}

export function standardToUnicode(byte: number): number {
  return STANDARD_SPECIAL[byte] ?? (byte < 0x80 ? byte : 0xfffd)
}

/** Adobe Glyph List subset covering the WinAnsi glyph set + common extras. */
const AGL: Record<string, number> = {
  space: 0x20, exclam: 0x21, quotedbl: 0x22, numbersign: 0x23, dollar: 0x24,
  percent: 0x25, ampersand: 0x26, quotesingle: 0x27, parenleft: 0x28,
  parenright: 0x29, asterisk: 0x2a, plus: 0x2b, comma: 0x2c, hyphen: 0x2d,
  period: 0x2e, slash: 0x2f,
  zero: 0x30, one: 0x31, two: 0x32, three: 0x33, four: 0x34, five: 0x35,
  six: 0x36, seven: 0x37, eight: 0x38, nine: 0x39,
  colon: 0x3a, semicolon: 0x3b, less: 0x3c, equal: 0x3d, greater: 0x3e,
  question: 0x3f, at: 0x40,
  bracketleft: 0x5b, backslash: 0x5c, bracketright: 0x5d,
  asciicircum: 0x5e, underscore: 0x5f, grave: 0x60,
  braceleft: 0x7b, bar: 0x7c, braceright: 0x7d, asciitilde: 0x7e,
  exclamdown: 0xa1, cent: 0xa2, sterling: 0xa3, currency: 0xa4, yen: 0xa5,
  brokenbar: 0xa6, section: 0xa7, dieresis: 0xa8, copyright: 0xa9,
  ordfeminine: 0xaa, guillemotleft: 0xab, logicalnot: 0xac, registered: 0xae,
  macron: 0xaf, degree: 0xb0, plusminus: 0xb1, twosuperior: 0xb2,
  threesuperior: 0xb3, acute: 0xb4, mu: 0xb5, paragraph: 0xb6,
  periodcentered: 0xb7, cedilla: 0xb8, onesuperior: 0xb9,
  ordmasculine: 0xba, guillemotright: 0xbb, onequarter: 0xbc,
  onehalf: 0xbd, threequarters: 0xbe, questiondown: 0xbf,
  Agrave: 0xc0, Aacute: 0xc1, Acircumflex: 0xc2, Atilde: 0xc3,
  Adieresis: 0xc4, Aring: 0xc5, AE: 0xc6, Ccedilla: 0xc7,
  Egrave: 0xc8, Eacute: 0xc9, Ecircumflex: 0xca, Edieresis: 0xcb,
  Igrave: 0xcc, Iacute: 0xcd, Icircumflex: 0xce, Idieresis: 0xcf,
  Eth: 0xd0, Ntilde: 0xd1, Ograve: 0xd2, Oacute: 0xd3, Ocircumflex: 0xd4,
  Otilde: 0xd5, Odieresis: 0xd6, multiply: 0xd7, Oslash: 0xd8,
  Ugrave: 0xd9, Uacute: 0xda, Ucircumflex: 0xdb, Udieresis: 0xdc,
  Yacute: 0xdd, Thorn: 0xde, germandbls: 0xdf,
  agrave: 0xe0, aacute: 0xe1, acircumflex: 0xe2, atilde: 0xe3,
  adieresis: 0xe4, aring: 0xe5, ae: 0xe6, ccedilla: 0xe7,
  egrave: 0xe8, eacute: 0xe9, ecircumflex: 0xea, edieresis: 0xeb,
  igrave: 0xec, iacute: 0xed, icircumflex: 0xee, idieresis: 0xef,
  eth: 0xf0, ntilde: 0xf1, ograve: 0xf2, oacute: 0xf3, ocircumflex: 0xf4,
  otilde: 0xf5, odieresis: 0xf6, divide: 0xf7, oslash: 0xf8,
  ugrave: 0xf9, uacute: 0xfa, ucircumflex: 0xfb, udieresis: 0xfc,
  yacute: 0xfd, thorn: 0xfe, ydieresis: 0xff,
  quoteleft: 0x2018, quoteright: 0x2019, quotedblleft: 0x201c,
  quotedblright: 0x201d, quotesinglbase: 0x201a, quotedblbase: 0x201e,
  endash: 0x2013, emdash: 0x2014, bullet: 0x2022, ellipsis: 0x2026,
  dagger: 0x2020, daggerdbl: 0x2021, perthousand: 0x2030,
  guilsinglleft: 0x2039, guilsinglright: 0x203a, trademark: 0x2122,
  Euro: 0x20ac, florin: 0x0192, fraction: 0x2044, minus: 0x2212,
  circumflex: 0x02c6, tilde: 0x02dc, caron: 0x02c7, breve: 0x02d8,
  dotaccent: 0x02d9, ring: 0x02da, ogonek: 0x02db, hungarumlaut: 0x02dd,
  Scaron: 0x0160, scaron: 0x0161, Zcaron: 0x017d, zcaron: 0x017e,
  OE: 0x0152, oe: 0x0153, Ydieresis: 0x0178, Lslash: 0x0141, lslash: 0x0142,
  dotlessi: 0x0131, fi: 0xfb01, fl: 0xfb02,
  nbspace: 0xa0, sfthyphen: 0xad, middot: 0xb7,
}

export function glyphNameToUnicode(glyphName: string): number | undefined {
  if (glyphName.length === 1) {
    const c = glyphName.charCodeAt(0)
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) {
      return c
    }
  }
  if (glyphName in AGL) return AGL[glyphName]
  // uniXXXX / uXXXX(XX) forms
  let m = /^uni([0-9A-Fa-f]{4})/.exec(glyphName)
  if (m) return parseInt(m[1], 16)
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(glyphName)
  if (m) return parseInt(m[1], 16)
  return undefined
}

/* ── Standard-14 metrics (AFM widths, 1/1000 em, chars 32–126) ── */

// prettier-ignore
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

// prettier-ignore
const TIMES_WIDTHS = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
]

/**
 * Width in 1/1000 em for a standard-14-ish base font with no /Widths array.
 * Unknown fonts and codes fall back to sensible defaults.
 */
export function standardFontWidth(baseFont: string, unicode: number): number {
  const name = baseFont.toLowerCase()
  if (name.includes('courier') || name.includes('mono')) return 600
  const table = name.includes('times') || name.includes('serif')
    ? TIMES_WIDTHS
    : HELVETICA_WIDTHS
  if (unicode >= 32 && unicode <= 126) return table[unicode - 32]
  return 556 // rough average for unlisted codes
}

/**
 * On-demand Google Fonts loader for the sign pane's "type" mode.
 *
 * The app is otherwise fully offline (see icons.tsx's self-hosted
 * icon subset) — these decorative script fonts are the one deliberate
 * exception, fetched from Google Fonts only if the user opens the
 * type-a-signature composer. Import and draw modes need no network.
 */

export const SIGNATURE_FONTS = [
  'Mr De Haviland',
  'Ms Madi',
  'Meddon',
  'Bilbo',
  'Licorice',
  'Mr Bedfort',
  'Mr Dafoe',
] as const

export type SignatureFont = (typeof SIGNATURE_FONTS)[number]

const requested = new Set<string>()

/** Inject the family's stylesheet (once) and wait for it to be usable. */
export async function ensureSignatureFont(family: SignatureFont): Promise<void> {
  if (!requested.has(family)) {
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
    requested.add(family)
  }
  await document.fonts.load(`80px "${family}"`)
}

/** A random font, optionally distinct from the current selection. */
export function randomSignatureFont(exclude?: SignatureFont): SignatureFont {
  const pool = exclude ? SIGNATURE_FONTS.filter((f) => f !== exclude) : SIGNATURE_FONTS
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Raw font-file bytes for embedding a typed signature as real PDF text
 * (see PdfHost.embedText's customFontBytes param). Passing `text`
 * requests a glyph-subsetted file from Google Fonts — besides being a
 * far smaller download, it collapses the response to a single
 * @font-face rule (the full-family CSS splits into several
 * unicode-range blocks), and in practice comes back as a plain TTF
 * rather than WOFF2, which fontkit parses directly either way.
 */
export async function fetchSignatureFontBytes(
  family: SignatureFont,
  text: string,
): Promise<Uint8Array> {
  const params = `family=${encodeURIComponent(family).replace(/%20/g, '+')}&text=${encodeURIComponent(text)}&display=swap`
  const css = await (await fetch(`https://fonts.googleapis.com/css2?${params}`)).text()
  const match = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css)
  if (!match) throw new Error(`could not resolve a font file for "${family}"`)
  const res = await fetch(match[1])
  return new Uint8Array(await res.arrayBuffer())
}

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

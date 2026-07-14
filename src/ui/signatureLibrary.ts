/**
 * Reusable signatures/initials saved in the browser (not part of any
 * document) so the user doesn't have to redraw them each time.
 */

export type SignatureKind = 'signature' | 'initials'

export interface SavedSignature {
  id: string
  kind: SignatureKind
  label: string
  /** PNG data URL. */
  dataUrl: string
  /** width / height, for placing at a sane default size. */
  aspect: number
}

const STORAGE_KEY = 'aerialist2.signatures.v1'

export function loadSignatureLibrary(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSignatureLibrary(list: SavedSignature[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // storage full/unavailable — the library just won't persist
  }
}

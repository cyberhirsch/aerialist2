/**
 * Bridge to the Chrome extension shell (extension/background.ts), when
 * this app is running as the extension's own page rather than the
 * plain website/dev server. Every export here is a no-op outside an
 * extension context.
 */

/** True when running as this Chrome extension's own page. */
export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id
}

/**
 * Ask the background service worker which PDF (if any) this tab was
 * redirected here for — see background.ts for why the URL travels via
 * message rather than a query string.
 */
export function requestRedirectedPdfUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isExtensionContext()) {
      resolve(null)
      return
    }
    chrome.runtime.sendMessage({ type: 'GET_PDF_URL' }, (response: { url: string | null } | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      resolve(response?.url ?? null)
    })
  })
}

/** Best-effort filename from a URL's last path segment. */
export function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop()
    return last ? decodeURIComponent(last) : 'document.pdf'
  } catch {
    return 'document.pdf'
  }
}

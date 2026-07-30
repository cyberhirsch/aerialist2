/**
 * Aerialist2 extension background service worker.
 *
 * Redirects PDF navigations to the extension's own viewer instead of
 * Chrome's built-in PDF viewer, via two complementary mechanisms:
 *
 * 1. declarativeNetRequest — instant, no-flicker redirect for URLs
 *    that end in .pdf. Registered as a *dynamic* rule (not a static
 *    rules.json) because the redirect target embeds chrome.runtime.id,
 *    which is only known at runtime.
 * 2. webRequest.onHeadersReceived — non-blocking observation (MV3
 *    dropped blocking webRequest for third-party extensions) that
 *    catches PDFs served without a .pdf suffix by checking the
 *    Content-Type header, then navigates the tab itself. This causes
 *    a brief flash of the original response before the redirect —
 *    an accepted tradeoff, since DNR alone can't see response headers.
 *
 * The original URL is deliberately NOT passed as a query string on the
 * redirect target: DNR's regexSubstitution embeds the match raw and
 * unencoded, and most real PDF URLs contain their own ?/& (signed S3
 * links, Drive links, download endpoints) which would corrupt the
 * outer query string. Instead, webNavigation.onBeforeNavigate records
 * {tabId → originalUrl} here, and the viewer page asks for it by
 * message once it loads — sender.tab.id identifies the right entry
 * with no encoding involved at all.
 *
 * Third-party extensions cannot register as a true OS/browser-level
 * MIME handler the way Chrome's own bundled PDF.js viewer does
 * (chrome.mimeHandlerPrivate is restricted to component extensions) —
 * this redirect approach is the standard technique real third-party
 * PDF-viewer-replacement extensions use.
 */

const DNR_RULE_ID = 1
const PDF_SUFFIX = /\.pdf(\?.*)?$/i

const pdfByTab = new Map<number, string>()

async function registerRedirectRule(): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [
      {
        id: DNR_RULE_ID,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
          redirect: { url: chrome.runtime.getURL('index.html') },
        },
        condition: {
          // top-level navigations only — never touch our own fetch() of
          // the PDF bytes from inside the viewer, which uses resourceType
          // "xmlhttprequest", not "main_frame"
          regexFilter: '^https?://.*\\.pdf(\\?.*)?$',
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
        },
      },
    ],
  })
}

chrome.runtime.onInstalled.addListener(() => {
  void registerRedirectRule()
})
chrome.runtime.onStartup.addListener(() => {
  void registerRedirectRule()
})

// record the pre-redirect URL for the DNR-handled (.pdf-suffix) path
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return
  if (PDF_SUFFIX.test(details.url)) pdfByTab.set(details.tabId, details.url)
})

// content-type fallback for PDFs served without a .pdf suffix
const redirectedTabs = new Set<number>()

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== 'main_frame' || details.tabId < 0) return
    if (redirectedTabs.has(details.tabId)) return
    if (details.url.startsWith(chrome.runtime.getURL(''))) return
    if (PDF_SUFFIX.test(details.url)) return // already handled by DNR

    const contentType = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === 'content-type',
    )?.value
    if (!contentType?.toLowerCase().startsWith('application/pdf')) return

    redirectedTabs.add(details.tabId)
    pdfByTab.set(details.tabId, details.url)
    void chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('index.html') })
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['responseHeaders'],
)

chrome.tabs.onRemoved.addListener((tabId) => {
  redirectedTabs.delete(tabId)
  pdfByTab.delete(tabId)
})

// the viewer page asks "what PDF was I opened for?" once it mounts
chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  if (message?.type !== 'GET_PDF_URL') return
  const tabId = sender.tab?.id
  const url = tabId !== undefined ? (pdfByTab.get(tabId) ?? null) : null
  if (tabId !== undefined) pdfByTab.delete(tabId)
  sendResponse({ url })
})

// toolbar icon: open a fresh, empty editor tab
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})

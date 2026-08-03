# Chrome Web Store listing — Aerialist2

Everything below is written to paste directly into the Developer Dashboard.
Assets referenced are in this same `docs/store/` folder.

## Store listing tab

**Extension name** (max 75 chars)
```
Aerialist2 — PDF Editor
```

**Summary / short description** (max 132 chars — this one is 113)
```
Edit PDF text right in your browser — real content-stream editing, not overlays. 100% client-side, no uploads.
```

**Category**
```
Productivity
```

**Language**
```
English (United States)
```

**Detailed description** (paste as plain text — Chrome Web Store doesn't render markdown)
```
Aerialist2 is a browser-native PDF editor with true text editing — it parses and rewrites the PDF's actual content stream instead of drawing a text box on top of the page like most "PDF editors" do. The edit is real PDF text: selectable, searchable, and reflowing like it always belonged there.

100% client-side. There is no backend, no upload, no account. Every PDF you open stays on your device from start to finish, and the app keeps working offline after the first load.

WHAT YOU CAN DO
• Edit text in place — click a word, line, table cell, or paragraph. Auto mode picks the right granularity: paragraphs reflow, tables edit per cell, everything else edits per line.
• Fill forms — AcroForm fields render as real, fillable native inputs positioned over the page.
• Sign — draw, type, or import a signature (or generate a date stamp), then place and resize it. Typed signatures are placed as real embedded-font text, never rasterized. Save signatures for reuse.
• Organize pages — reorder, rotate, delete, duplicate, extract, or split with a right-click. Drop another PDF onto the page grid to merge it in.
• Search across the whole document with highlighting, and speed-read the extracted text in the built-in RSVP pane.
• Highlight, redact, and add comments.
• A Blender-style workspace: split any pane, reassign what it shows, and the layout persists across reloads.

WHY IT'S DIFFERENT
Most browser PDF tools place an invisible text box over the page and hope it lines up. Aerialist2 actually parses the content stream — the text operators, fonts, and layout — through a proper document model, and rewrites that same stream on export. Nothing is rasterized. Nothing is faked.

INSTALL AS YOUR DEFAULT PDF VIEWER
Once installed, Aerialist2 can replace Chrome's built-in PDF viewer: open any .pdf link (local or remote) and it opens directly in Aerialist2 instead. This is entirely optional to rely on — you can also just open the extension from the toolbar and drop a file in.

PRIVACY
No analytics, no tracking, no data collection of any kind. Full privacy policy: https://cyberhirsch.github.io/aerialist2/privacy.html

Source: https://github.com/cyberhirsch/aerialist2
```

## Graphic assets tab

| Asset | File | Size |
|---|---|---|
| Store icon | `extension/icons/128.png` | 128×128 |
| Screenshot 1 (hero) | `screenshots/01-text-edit.png` | 1280×800 |
| Screenshot 2 | `screenshots/02-forms.png` | 1280×800 |
| Screenshot 3 | `screenshots/03-workspace.png` | 1280×800 |
| Screenshot 4 | `screenshots/04-sign.png` | 1280×800 |
| Small promo tile | `promo/small-tile.png` | 440×280 |
| Marquee promo tile | `promo/marquee.png` | 1400×560 |

Screenshot captions (optional, shown under each image in the listing):
1. `Click any word, line, or paragraph and edit real PDF text in place — not an overlay.`
2. `AcroForm fields render as real, fillable native inputs.`
3. `A Blender-style workspace — split any pane, reassign what it shows.`
4. `Type, draw, or import a signature. Typed signatures place real embedded-font text.`

## Privacy practices tab

**Single purpose description**
```
Aerialist2 lets people view and edit PDF files directly in the browser, with the option to open as the default handler for .pdf links instead of Chrome's built-in viewer.
```

**Permission justifications** (paste one per permission field in the dashboard)

| Permission | Justification |
|---|---|
| `declarativeNetRequest` | Redirects top-level navigations to a `.pdf` URL to the extension's own viewer page instead of Chrome's built-in PDF viewer. |
| `webRequest` | Read-only inspection of response headers to detect PDFs served without a `.pdf` file extension (via `Content-Type: application/pdf`), so those also redirect to the viewer. No request or response bodies are read or modified. |
| `webNavigation` | Records the URL a tab was about to navigate to (in memory only) so the viewer page knows which PDF to fetch after the redirect completes. |
| `tabs` | Updates a tab's URL to the extension's viewer page after a PDF is detected, and opens a new tab when the toolbar icon is clicked. |
| Host permission: `http://*/*`, `https://*/*` | Needed to fetch the actual PDF bytes from whatever URL served them, so they can be rendered and edited. The bytes are read into the page only — never sent anywhere else. |
| Host permission: `file:///*` | Lets the extension read local PDF files opened via `file://` URLs (requires the user to separately enable "Allow access to file URLs" in `chrome://extensions`, since Chrome never grants this automatically). |

**Are you using remote code?**
```
No
```

**Data collection** — for every category Chrome asks about (personally identifiable info, health info, financial info, authentication info, personal communications, location, web history, user activity, website content), answer:
```
No, this extension does not collect this type of data.
```

**Certifications** (dashboard checkboxes)
```
☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
☑ I do not use or transfer user data for purposes unrelated to the item's single purpose.
☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.
```

**Privacy policy URL**
```
https://cyberhirsch.github.io/aerialist2/privacy.html
```
This is `public/privacy.html` in the repo — it ships with the normal `npm run build` and goes live at that URL once deployed via the existing GitHub Pages workflow. Deploy (or confirm it's already deployed) before submitting, or the URL will 404.

## Pre-submission checklist

- [ ] `npm run build:extension` run recently, `dist-extension/` is current
- [ ] `public/privacy.html` deployed and reachable at the URL above (push to `master` → GitHub Pages redeploys)
- [ ] Zip `dist-extension/` contents (not the folder itself) for upload — see `docs/store/README.md`
- [ ] Screenshots and promo tiles above uploaded in the Graphic assets tab
- [ ] Store listing text pasted from this file
- [ ] Privacy practices tab filled in from this file
- [ ] Developer account's public-facing email/support contact set (dashboard → Account)

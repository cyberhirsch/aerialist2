# Task plan

Working plan for Aerialist2, ordered by phase. Each task carries a suggested
Claude model — the split is by *kind* of work, not by size:

| Model | Use for |
| --- | --- |
| **Opus 5** | Architecture, the PDF engine, async/performance work, anything touching content streams or the document model |
| **Sonnet 5** | Self-contained feature work, UI components, tests against a settled design |
| **Haiku 4.5** | Mechanical edits, asset chores, doc formatting, dependency bumps |

Rule of thumb: if getting it wrong corrupts a PDF or freezes the UI, use Opus 5.

---

## Phase 1 — Loading architecture

The one structural problem. Opening a document currently parses the file three
times (pdf-lib, the engine, pdf.js) and the engine parse walks **every page
synchronously on the main thread**. On a 38 MB drawing that froze the UI for
~88 seconds before a single pixel appeared.

| # | Task | Model |
| --- | --- | --- |
| 1.1 | ~~Make the engine parse lazy and per-page~~ **done** — `buildPageModel` returns lazy getters, memoised per page, resolved through the page's live index | Opus 5 |
| 1.2 | ~~Separate *view* from *edit*~~ **done** — opening a document parses no pages; 38 MB drawing now opens in 345 ms (was ~88 s) | Opus 5 |
| 1.3 | Defer `PdfHost.load` (pdf-lib) until a document operation actually needs it — merge, rotate, page ops, save | Opus 5 |
| 1.4 | ~~RSVP pulls its word stream in the background~~ **done** — feed builds one page per event-loop turn; the status bar word count does the same | Sonnet 5 |

**Status:** 1.1, 1.2 and 1.4 are done — opening the 38 MB reference drawing went
from ~88 s of blocked UI to **345 ms**, with zero pages parsed up front. Parsing
page 1 on demand still costs ~9.7 s on the main thread, which is what phase 2 is
for. 1.3 remains.

## Phase 2 — Get heavy work off the main thread

`src/engine/` is pure TypeScript with no DOM dependencies, which makes it the
right thing to move into a worker. (pdf.js's *display* layer is not — it needs
`document.createElement`, SVG filters and `document.baseURI`, so rendering has
to stay on the main thread. This was tried and reverted.)

| # | Task | Model |
| --- | --- | --- |
| 2.1 | Move the engine parse into a dedicated worker; stream per-page results back as they complete | Opus 5 |
| 2.2 | Progressive whole-document work (search index, RSVP stream) built page-by-page in that worker | Opus 5 |
| 2.3 | Surface real progress in the status bar — parsing page *n* of *m* — instead of a single `[WORKING]` | Sonnet 5 |

## Phase 3 — Behave well on pathological documents

Some files are simply hostile: page 1 of the reference CAD drawing is 5.3 M
drawing operators, and ~13 s of that is pdf.js building the display list before
any rasterisation starts. That cost cannot be optimised away with a Canvas2D
renderer — the goal is to stop *pretending* it can and degrade honestly.

| # | Task | Model |
| --- | --- | --- |
| 3.1 | Cheap complexity probe (content-stream byte length, page count) to classify a document before committing to a full parse | Opus 5 |
| 3.2 | View-only mode for pages above the threshold, with an explicit notice and an opt-in override | Sonnet 5 |
| 3.3 | Skip or defer thumbnails for heavy pages — six thumbnails is six extra full replays | Sonnet 5 |
| 3.4 | Cache rendered page bitmaps so page flips and zoom don't re-rasterise | Opus 5 |
| 3.5 | Visible in-progress indicator for slow renders, so a long wait never reads as a hang | Sonnet 5 |

## Phase 4 — Verification

The engine is pure functions over bytes: the most testable code in the project
and currently the least protected. Rendering can't be checked headlessly, but
parsing and timing can.

| # | Task | Model |
| --- | --- | --- |
| 4.1 | Vitest coverage for the engine — largely in place (11 files, 77 tests); extend to glyph extraction and block detection edge cases | Sonnet 5 |
| 4.2 | Round-trip tests — edit, save, reload, assert the change survives | Opus 5 |
| 4.3 | ~~Lazy-parse regression guards~~ **done** (`src/model/lazyParse.test.ts`) — still to add: timing budgets against fixtures | Sonnet 5 |
| 4.4 | Fixture set of small, redistributable PDFs (scanned, CJK, forms, vector-heavy) | Haiku 4.5 |

## Phase 5 — Feature roadmap

Tracked in detail in [README.md](README.md#roadmap). Near-term candidates:

| # | Task | Model |
| --- | --- | --- |
| 5.1 | Shapes, underline, freehand drawing | Sonnet 5 |
| 5.2 | Watermarks, headers/footers, page numbers | Sonnet 5 |
| 5.3 | Metadata editing | Sonnet 5 |
| 5.4 | Font style controls (bold/italic/size) on edited runs | Opus 5 |
| 5.5 | Standalone image insertion, anywhere on the page | Opus 5 |
| 5.6 | Password protection | Opus 5 |

## Phase 6 — Chrome extension

| # | Task | Model |
| --- | --- | --- |
| 6.1 | ~~Add `'wasm-unsafe-eval'` to the extension CSP~~ **done** — shipped in 0.1.2 | Haiku 4.5 |
| 6.2 | Store listing upkeep: screenshots, description, version bumps | Haiku 4.5 |

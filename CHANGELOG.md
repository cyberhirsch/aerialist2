# Changelog

Notable changes to Aerialist2. The web app ships continuously from `master`;
version numbers below track the Chrome extension.

## Unreleased

### Fixed

- **Scanned PDFs rendered as blank pages.** PDF.js was never told where its WASM
  image decoders live, so every JBIG2 and JPEG2000 image failed with
  `JpxError: OpenJPEG failed to initialize` and pages came out white. The
  decoders now ship in `public/pdfjs-wasm/` and are passed as an absolute
  `wasmUrl` — absolute because the fetch happens inside PDF.js's worker, which
  would otherwise resolve a relative path against its own script location.
- **Glyphs rendering as placeholder boxes.** Fonts a document doesn't embed had
  no data to fall back on. Standard font data (`public/pdfjs-fonts/`) and CMaps
  for CID/CJK encodings (`public/pdfjs-cmaps/`) are now bundled and configured.
- **Fit-page and fit-width stopped tracking resizes.** The editor pane's
  `ResizeObserver` was attached in a mount-once effect, but its scroll container
  only exists once a document is open — so it observed nothing and never
  retried. Fit modes silently froze at whatever zoom they were first set to.
  Most visible on landscape pages, where height is usually the binding
  constraint. Now uses a callback ref, so it attaches whenever the container
  mounts.

### Added

- **Zoom preset dropdown** in the editor pane header (25%–400%), alongside the
  existing fit-page and fit-width controls. Falls back to showing the current
  value when zoom doesn't match a preset.
- **Ctrl/Cmd + scroll wheel zooms the document** when the pointer is over the
  page, instead of zooming the browser UI. Uses an exponential step so a mouse
  flick and a trackpad drag both feel proportional.
- `testing pdfs/` — a gitignored folder for local test files, served by the dev
  server at `/testing-pdfs/<name>.pdf` so they can be opened with
  `?sample=/testing-pdfs/<name>.pdf` without copying anything into `public/`.
- [task.md](task.md) — phased work plan.

### Changed

- README documents the tools that had shipped without being written up:
  redaction, fill, comments, highlight, compression, and the sign pane's
  import-and-trace workflow.
- oxlint no longer scans `public/`, `dist/`, or `dist-extension/`, which had
  started reporting warnings from vendored PDF.js assets.

### Known issues

- Very large vector documents are slow to open. Opening currently parses a file
  three times over and walks every page synchronously on the main thread; a
  38 MB CAD drawing blocks the UI for roughly 88 seconds before first paint.
  Separately, page 1 of that file is 5.3 M drawing operators, ~13 s of which is
  PDF.js building its display list before any rasterisation begins. Addressed by
  phases 1–3 of [task.md](task.md).

## 0.1.1 — Chrome extension

### Fixed

- `icons/48.png` was corrupt — a bad IDAT CRC and a zlib stream that failed to
  inflate. The PNG header was valid, so the file passed casual inspection and
  uploaded fine, but Chrome could not decode it and the extension refused to
  install with `Could not decode image: '48.png'`. Regenerated from the intact
  128px icon.

## 0.1.0 — Chrome extension

### Added

- Initial Chrome Web Store release. Manifest V3 extension that replaces Chrome's
  built-in PDF viewer: navigating to any `.pdf`, local or remote, opens it in
  Aerialist2. Published at
  [chromewebstore.google.com](https://chromewebstore.google.com/detail/eolpdeagjjcofgdnpjoohmolfpchggbo).
- Print and download toolbar buttons.
- Sign pane: signature slots, centreline tracing, import/draw/type composer,
  typed signatures set in a real embedded font, manual stroke split/connect and
  trace-by-hand over a reference image.
- Marker tools: line-snapped redaction bars, highlight, inline fill.
- Redaction as true content removal — glyph bytes deleted from the content
  stream, not a black box drawn on top.
- Image recompression and reduction passes for shrinking file size.
- Per-pane edit mode, page-fit modes, scroll paging.
- AcroForm fields rendered as native inputs over the page.
- Page organiser: reorder, multi-select, extract, split, merge.

# Aerialist2

A browser-native PDF editor with **true text editing** — it parses and rewrites PDF content streams instead of drawing overlay text on top of the page.

100% client-side. No backend, no uploads, no accounts. Everything runs in your browser and works offline after the first load.

Live at: https://cyberhirsch.github.io/aerialist2/

## What makes this different

Most browser-based PDF "editors" place a text box over the page and hope it looks right. Aerialist2 parses the actual PDF content stream, understands the text operators, fonts, and layout, lets you edit through a proper document model (Document → Page → Block → Line → Word → Glyph), and rewrites the content stream on export. The edit is real PDF text — selectable, searchable, and reflowing like it always belonged there.

## Interface

A Blender-style workspace: the layout is a tree of resizable panes, and each pane's function is switchable from its own header dropdown.

- **editor** — click a word, line, table cell, or paragraph to edit it in place. Auto mode picks the right granularity: paragraphs reflow, tables edit per cell, everything else edits per line. AcroForm fields render as real, fillable native inputs positioned over the page. Cross-page find with highlighting lives in the toolbar.
- **organizer** — a responsive thumbnail grid for the whole document. Drag to reorder pages, multi-select with ctrl/shift-click, right-click to duplicate/rotate/delete/extract/split, drop another PDF onto it to merge at that position.
- **rsvp** — speed-reading pane fed directly from the extracted word stream, with an ORP-style pivot display.

`[ sign ]` opens a dialog to draw, type, or upload a signature (or generate a date stamp), then drag/resize it before it's embedded into the page. Signatures and initials can be saved for reuse across documents.

Split, close, or reassign any pane; the layout persists across reloads. Full undo/redo, keyboard shortcuts, and a right-click context menu throughout. Aesthetic is deliberately minimal: monospace, greyscale, no color accents, terminal-style chrome.

## Commands

```
npm install
npm run dev      # start the dev server
npm run build    # typecheck (tsc -b) + production build
npm run lint     # oxlint
npx vitest run   # test suite
```

## Architecture

- `src/engine/` — the differentiator, all custom TypeScript: content stream lexer/parser, text-state interpreter, font/encoding/CMap decoding, word/line/block detection, layout (wrapping), content stream rewriter. No third-party PDF logic lives here.
- `src/model/` — the editable document model. The single API the UI talks to; wraps the engine and the pdf-lib host together.
- `src/pdf/` — adapters over third-party libraries, kept behind the model: PDF.js for rendering, pdf-lib for document assembly (merge, split, rotate, page ops, save).
- `src/ui/` — React components and the Zustand store, including the pane-workspace system.

Full product spec: [docs/PRD.md](docs/PRD.md).

## Roadmap

### P0 — Core differentiator

- [x] PDF parser
- [x] Content stream parser
- [x] Font parser
- [x] Text extraction
- [x] Word detection
- [x] Line detection
- [x] Block detection
- [x] Editable document model
- [x] Layout engine
- [x] Content stream writer
- [x] Export valid PDF

### P1 — Core editing features

- [x] Edit existing text
- [x] Add text *(via edit; standalone text insertion still open)*
- [x] Delete text
- [x] Font editing *(fallback-font substitution; style controls still open)*
- [x] Images *(via signature/stamp placement; general insert-anywhere still open)*
- [ ] Shapes
- [ ] Highlight
- [ ] Underline
- [ ] Drawing
- [ ] Sticky notes
- [x] Signatures *(draw/type/upload, save for reuse, initials, date stamp)*
- [x] Fill forms
- [x] Search
- [x] Page reorder
- [x] Rotate pages
- [x] Delete pages
- [x] Merge PDFs
- [x] Split PDFs

### P2 — Productivity features

- [ ] Watermarks
- [ ] Headers & footers
- [ ] Page numbers
- [ ] Metadata editing
- [ ] Password protection
- [ ] Compression
- [ ] Backgrounds
- [ ] Batch operations

### P3 — Future

- [ ] OCR
- [ ] Scanned PDF editing
- [ ] Form creation
- [ ] Digital signatures
- [ ] AI-assisted layout repair
- [ ] DOCX export
- [ ] Accessibility/tagged PDF editing

## License

[MIT](LICENSE)

# Aerialist2

Browser-native PDF editor with **true text editing** — it parses and rewrites PDF content streams instead of drawing overlays. 100% client-side static site; no backend, no uploads. Full spec: [docs/PRD.md](docs/PRD.md).

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — typecheck (`tsc -b`) + production build (static site)
- `npm run build:extension` — typecheck + build the Chrome extension into `dist-extension/`
- `npm run lint` — oxlint

## Architecture

- `src/engine/` — the differentiator, all custom TypeScript. Content stream lexer/parser, text-state interpreter, font decoding, word/line/block detection, layout, content stream rewriter. **No third-party PDF logic in here.**
- `src/model/` — the editable document model (Document → Page → Block → Line → Word → Glyph). This is the single API the UI talks to.
- `src/pdf/` — adapters wrapping third-party libs: PDF.js (rendering only) and pdf-lib (document assembly: merge/split/rotate/forms/save). These stay hidden behind the model; the UI must never import them directly.
- `src/ui/` — React components, Zustand stores.
- `src/platform/chromeExtension.ts` — bridge to the extension shell (below); every export is a no-op when running as the plain website.
- `extension/` — Chrome extension shell: `manifest.json` (MV3) and `background.ts`, the service worker that redirects `.pdf` navigations to the app instead of Chrome's built-in viewer. Built via `vite.extension.config.ts` (the app) + `vite.background.config.ts` (the worker) + `scripts/build-extension.mjs` (orchestrates both, copies manifest/icons) into `dist-extension/`. Same app, same rules above — the extension is a second packaging of the identical static site, not a fork.

## Rules

- Text edits must land in the content stream — never as overlay text drawn on top.
- Commodity PDF ops (merge, split, rotate, forms) go through pdf-lib in `src/pdf/`; don't hand-roll them.
- UI aesthetic: minimalist greyscale TUI. Monospace fonts only, pure grey palette, **no color accents**, 1px borders, terminal-like chrome. Theme tokens live in `src/index.css`.
- Never rasterize pages on export.

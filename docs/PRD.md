# Aerialist2 — Browser-Based PDF Editor (Static Website)

Product Requirements Document (PRD)
Version: 1.0
Platform: Browser (Static Website)
Deployment: GitHub Pages / Cloudflare Pages / Netlify / Vercel
Backend: None
Storage: Browser only (IndexedDB + File System Access API where available)

## Vision

Build a browser-native PDF editor capable of true PDF text editing by understanding and rewriting PDF content streams instead of drawing overlays.

The application runs entirely in the browser, never uploads documents, works offline after the initial load, and includes all of the features users expect from a modern PDF editor.

## Core Principles

- 100% client-side
- No backend
- No document uploads
- Privacy-first
- Offline capable
- Static website
- Modular architecture
- Extensible PDF engine

## Product Differentiator

Unlike traditional browser PDF editors that place new text on top of existing PDFs, this application will edit the underlying PDF objects.

### Editing Pipeline

```text
PDF Parser
      ↓
Text Object Extraction
      ↓
Word Detection
      ↓
Line Detection
      ↓
Block Detection
      ↓
Editable Document Model
      ↓
Layout Engine
      ↓
Content Stream Rewriter
      ↓
Export PDF
```

This engine is the foundation of the entire product.

## Product Architecture

```text
                    React UI
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
   PDF Viewer     Editor Layer     Tool Layer
        │               │               │
        └───────────────┼───────────────┘
                        │
                 Document Model
                        │
       ┌────────────────┼─────────────────┐
       ▼                ▼                 ▼
 PDF Parser      Layout Engine     Font Manager
       │                │                 │
       └────────────────┼─────────────────┘
                        ▼
             Content Stream Writer
                        │
                        ▼
                 Download PDF
```

## Internal Document Model

```text
Document
 ├── Page
 │     ├── Block
 │     │      ├── Line
 │     │      │      ├── Word
 │     │      │      │      ├── Glyph
 │
 ├── Images
 ├── Shapes
 ├── Annotations
 ├── Forms
 └── Signatures
```

Every editing operation modifies this document model. The PDF is regenerated from this model during export.

## Module 1 — PDF Engine (Highest Priority)

### Goal

Provide true editing of existing PDF text.

### Responsibilities

- Parse PDF objects
- Parse page tree
- Parse resource dictionaries
- Parse fonts
- Parse content streams
- Parse transformations
- Parse colors
- Parse text operators

### Text Extraction

Extract: glyphs, Unicode, font, font size, color, position, bounding box, transform matrix, character spacing, word spacing.

### Word Detection

Group glyphs into words. Detection based on: character spacing, font, baseline, transform.

### Line Detection

Group words into lines. Detection based on: baseline, vertical alignment, font, reading direction.

### Block Detection

Group lines into paragraphs or logical text blocks. Detection heuristics: common left edge, common font, vertical spacing, alignment, paragraph spacing.

### Editable Document Model

The parser converts the PDF into Document → Pages → Blocks → Lines → Words → Glyphs. Editing occurs on this model instead of directly on the PDF.

### Layout Engine

Whenever text changes:

- Recalculate word positions
- Recalculate line widths
- Perform wrapping
- Preserve alignment
- Preserve block dimensions where possible

The layout engine only affects the edited block.

### Font Manager

Responsibilities:

- Detect embedded fonts
- Detect subset fonts
- Detect system fonts
- Embed replacement fonts when required
- Preserve typography

Fallback strategy: use the embedded font if the glyph exists; otherwise find a compatible font and embed it.

### Content Stream Writer

Serialize the edited document back into a valid PDF.

Rewrite: text operators, font resources, resource dictionaries, content streams.
Preserve: images, vector graphics, metadata, annotations, page dimensions.
Never rasterize pages.

## Module 2 — PDF Viewer

Built using PDF.js.

Features: page navigation, zoom, pan, rotate view, search, text selection, continuous scroll, single page mode, page thumbnails, dark mode, keyboard shortcuts.

## Module 3 — Text Editing

Features: edit existing text, add text, delete text, replace text, change font, font size, font color, bold, italic, underline, alignment, word wrapping, paragraph editing.

## Module 4 — Annotation Tools

- Text: sticky notes, comments, free text
- Review: highlight, underline, strikeout, squiggly
- Shapes: rectangle, circle, arrow, line, polygon
- Drawing: pencil, highlighter, eraser

## Module 5 — Images

Features: insert image, replace image, resize, rotate, crop, opacity, layer ordering.
Supported formats: PNG, JPG, SVG.

## Module 6 — Signatures

Features: draw signature, type signature, upload signature, save reusable signatures, initials, date stamp.

## Module 7 — Page Management

Features: insert page, delete page, duplicate page, rotate page, reorder pages, move pages, extract pages, split PDF, merge PDFs.

## Module 8 — Forms

Support: fill AcroForms, text fields, checkboxes, radio buttons, dropdowns, signature fields.
Future: form creation.

## Module 9 — Search

Features: find, highlight results, next/previous, case sensitive, whole word. Replace (future).

## Module 10 — Metadata

Edit: title, author, subject, keywords.
View: fonts, PDF version, page size, encryption.

## Module 11 — Export

Supported: PDF, PNG, JPG.
Future: SVG, DOCX, HTML.

## Module 12 — Compression

Features: image compression, font optimization, remove unused objects, remove duplicate objects, optimize streams.

## Module 13 — Security

Support: password-protected PDFs, remove passwords, encrypt PDFs, permission settings.
Future: digital signatures, certificates.

## Module 14 — Document Utilities

Common PDF tools: merge PDFs, split PDFs, compress PDFs, rotate pages, watermarks, page numbers, headers & footers, backgrounds, Bates numbering.

## OCR (Future)

Image PDF → OCR → editable text layer → document model → content stream writer. Not part of the MVP.

## Technology Stack

- Frontend: React, TypeScript, Vite
- Rendering: PDF.js
- PDF Engine: custom parser, layout engine, and content stream writer (pure TypeScript; WASM only if profiling later demands it)
- UI: Tailwind CSS, Radix UI, Zustand
- Browser APIs: IndexedDB, File System Access API, Web Workers, OffscreenCanvas

## User Workflow

Open PDF → Parse PDF → Extract Text → Build Document Model → Render Viewer → User Edits → Update Document Model → Recalculate Layout → Rewrite PDF Content Streams → Download PDF

## Feature Priorities

### P0 — Core Differentiator

PDF parser, content stream parser, font parser, text extraction, word detection, line detection, block detection, editable document model, layout engine, content stream writer, export valid PDF.

### P1 — Core Editing Features

Edit existing text, add text, delete text, font editing, images, shapes, highlight, underline, drawing, sticky notes, signatures, fill forms, search, page reorder, rotate pages, delete pages, merge PDFs, split PDFs.

### P2 — Productivity Features

Watermarks, headers & footers, page numbers, metadata editing, password protection, compression, backgrounds, batch operations.

### P3 — Future

OCR, scanned PDF editing, form creation, digital signatures, AI-assisted layout repair, DOCX export, accessibility/tagged PDF editing.

## Success Metrics

The MVP is successful if users can:

- Open standard digital PDFs locally.
- Edit existing text (without overlays).
- Preserve layout with minimal drift.
- Add annotations, signatures, images, and shapes.
- Merge, split, rotate, reorder, and extract pages.
- Fill interactive forms.
- Export a searchable, editable PDF.
- Complete all processing entirely within the browser.

## Guiding Principle

This product should feel like Figma for PDFs, but remain faithful to the PDF format. The application is not an annotation tool — it is a browser-native PDF editing engine capable of parsing, understanding, editing, and rewriting PDF documents entirely on the client side.

---

## Amendments (decided 2026-07-13)

- **Engine tech:** pure TypeScript (no Rust/WASM initially).
- **Library policy:** pragmatic — custom code only for the differentiator; PDF.js renders, pdf-lib handles commodity ops behind the unified document model API.
- **Milestone 1:** vertical slice — open → click text → edit → export with the edit in the content stream.
- **Aesthetic:** minimalist greyscale TUI style — monospace type, pure greys, no color accents, terminal-like chrome.

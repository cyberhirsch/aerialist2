# Chrome Web Store submission assets

Everything the Developer Dashboard needs, generated from the running app —
see `listing.md` for the text to paste and the exact permission justifications.

```
docs/store/
  listing.md               ← paste this into the dashboard
  screenshots/             ← 1280×800 PNGs, real app screenshots
  promo/                   ← small tile (440×280) + marquee (1400×560)
  README.md                ← this file
```

## Packaging the extension for upload

The dashboard wants a ZIP of `dist-extension/`'s *contents*, not the folder itself
(zipping the folder puts everything one level too deep and the manifest won't be found).

```bash
npm run build:extension
cd dist-extension
zip -r ../aerialist2-extension.zip .
cd ..
```

On Windows PowerShell, instead of `zip`:

```powershell
npm run build:extension
Compress-Archive -Path dist-extension\* -DestinationPath aerialist2-extension.zip -Force
```

Upload `aerialist2-extension.zip` in the dashboard's "Package" tab.

## Regenerating the screenshots / promo tiles

These were captured with a temporary `puppeteer-core` install (driving the
already-installed Chrome, not downloading its own) so the repo's real
dependencies stay untouched:

```bash
npm install --no-save puppeteer-core
npm run dev   # in another terminal — screenshots hit localhost:5173
```

Then drive it with a short script (see git history around when these assets
were added for the exact ones used) — navigate to the app with a `?sample=`
query param, interact via `page.click`/`page.type`, and `page.screenshot()`
at `{ width: 1280, height: 800 }`. The promo tiles are static HTML files in
`promo/*.html`, rendered the same way via a `file://` URL.

`puppeteer-core` is not a project dependency — it's installed on demand with
`--no-save` and never touches `package.json`.

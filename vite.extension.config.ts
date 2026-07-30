import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Builds the app (index.html) for the Chrome extension target.
// Served from chrome-extension://<id>/ — relative asset paths, no
// GitHub Pages base prefix. Run alongside vite.background.config.ts
// (see scripts/build-extension.mjs), which builds the service worker
// into the same dist-extension/ output without wiping this pass.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-extension',
  },
})

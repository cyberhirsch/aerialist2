import { defineConfig } from 'vite'

// Builds the background service worker as a single unhashed ES module
// (manifest.json references it by the fixed name "background.js").
// Run after vite.extension.config.ts, with emptyOutDir left off so it
// doesn't wipe the app build already sitting in dist-extension/.
export default defineConfig({
  build: {
    outDir: 'dist-extension',
    emptyOutDir: false,
    lib: {
      entry: 'extension/background.ts',
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
})

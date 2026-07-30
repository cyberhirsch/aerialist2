// Builds the Chrome extension into dist-extension/:
//  1. the app (index.html) via vite.extension.config.ts
//  2. the background service worker via vite.background.config.ts
//  3. copies manifest.json + icons alongside them
// Run: node scripts/build-extension.mjs
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const outDir = new URL('../dist-extension/', import.meta.url)
const extDir = new URL('../extension/', import.meta.url)

await build({ configFile: fileURLToPath(new URL('../vite.extension.config.ts', import.meta.url)) })
await build({ configFile: fileURLToPath(new URL('../vite.background.config.ts', import.meta.url)) })

copyFileSync(new URL('manifest.json', extDir), new URL('manifest.json', outDir))

const iconsOut = new URL('icons/', outDir)
if (!existsSync(iconsOut)) mkdirSync(iconsOut, { recursive: true })
const iconsSrc = new URL('icons/', extDir)
if (existsSync(iconsSrc)) {
  for (const file of readdirSync(iconsSrc)) {
    copyFileSync(new URL(file, iconsSrc), new URL(file, iconsOut))
  }
}

console.log('extension built → dist-extension/')

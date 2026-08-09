import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Dev only: serve the gitignored `testing pdfs/` folder at /testing-pdfs/ so
 * real-world files can be loaded with ?sample=/testing-pdfs/<name>.pdf
 * without copying them into public/. Never part of a production build.
 */
function testPdfs() {
  const dir = path.resolve(__dirname, 'testing pdfs')
  return {
    name: 'a2-testing-pdfs',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use((req: { url?: string }, res: NodeJS.WritableStream & { statusCode?: number; setHeader?: (k: string, v: string) => void }, next: () => void) => {
        const url = req.url ?? ''
        if (!url.startsWith('/testing-pdfs/')) return next()
        const name = decodeURIComponent(url.slice('/testing-pdfs/'.length).split('?')[0])
        const file = path.join(dir, name)
        if (!file.startsWith(dir) || !fs.existsSync(file)) return next()
        res.setHeader?.('Content-Type', 'application/pdf')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // served at https://<user>.github.io/aerialist2/ — asset URLs need the repo prefix
  base: process.env.GITHUB_PAGES ? '/aerialist2/' : '/',
  plugins: [react(), tailwindcss(), testPdfs()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
})

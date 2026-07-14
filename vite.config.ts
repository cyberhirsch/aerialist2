import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // served at https://<user>.github.io/aerialist2/ — asset URLs need the repo prefix
  base: process.env.GITHUB_PAGES ? '/aerialist2/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
})

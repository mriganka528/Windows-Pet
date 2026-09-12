import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'nudge-release-html',
      transformIndexHtml: (html) => html.replaceAll('__NUDGE_VERSION__', version)
    }
  ],
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 850 }
})

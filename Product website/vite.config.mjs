import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const release = JSON.parse(readFileSync(new URL('./src/release.json', import.meta.url), 'utf8'))
const escapeAttribute = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
const downloadUrl =
  release.downloadMode === 'local' ? `./${release.downloadUrl}` : release.downloadUrl

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'nudge-release-html',
      transformIndexHtml: (html) =>
        html
          .replaceAll('__NUDGE_VERSION__', release.version)
          .replaceAll('__NUDGE_DOWNLOAD_URL__', escapeAttribute(downloadUrl))
    }
  ],
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  // Shared artwork outside this root must use the website's React installation.
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: 'dist', chunkSizeWarningLimit: 850 }
})

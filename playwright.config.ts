import { defineConfig } from '@playwright/test'

// Electron smoke tests. These require a built app (`electron-vite build`) and a
// real display — they run on Windows/CI, not in a headless-less sandbox.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  projects: [
    { name: 'electron', testMatch: 'overlay.spec.ts' },
    {
      name: 'renderer',
      testMatch: 'renderer.spec.ts',
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        baseURL: 'http://127.0.0.1:4175',
        viewport: { width: 800, height: 600 }
      }
    }
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js preview --outDir out/renderer --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: !process.env.CI
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000
})

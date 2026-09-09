import { defineConfig } from '@playwright/test'

// Electron smoke tests. These require a built app (`electron-vite build`) and a
// real display — they run on Windows/CI, not in a headless-less sandbox.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000
})

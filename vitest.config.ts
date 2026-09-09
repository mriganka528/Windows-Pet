import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Unit tests only here; Playwright e2e runs via its own runner.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node'
  }
})

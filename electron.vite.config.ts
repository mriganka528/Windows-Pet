import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite splits the build into three isolated bundles: main (Node),
// preload (Node w/ contextBridge), and renderer (browser/React). Each gets its
// own Vite config below.
//
// NOTE: the config file MUST be named `electron.vite.config.ts`. electron-vite
// ignores a plain `vite.config.ts`. Getting this wrong produces a confusing
// "An entry point is required" error.
export default defineConfig({
  main: {
    // externalizeDepsPlugin keeps `dependencies` (e.g. electron-store) external
    // instead of bundling them — they're require()'d from node_modules at runtime.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Second renderer entry: the Settings window (opened from the tray).
          // Emitting it here produces out/renderer/settings.html alongside
          // index.html; in dev it's served at /settings.html.
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})

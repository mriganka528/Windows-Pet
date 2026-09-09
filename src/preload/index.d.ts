import type { NudgeApi } from './index'

// Augment the renderer's global Window with the API exposed via contextBridge.
// This file is included by tsconfig.web.json so the renderer sees `window.nudge`.
declare global {
  interface Window {
    nudge: NudgeApi
  }
}

export {}

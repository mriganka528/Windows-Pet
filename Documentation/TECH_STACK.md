# Tech Stack — Desktop Companion

## Application Shell
- **Electron** — cross-process desktop shell, window/tray management. (Matches your existing experience.)
- **electron-builder** — packaging/installer (NSIS installer for Windows), code-signing hook, auto-update artifact generation.
- **electron-updater** — auto-update delivery once you're distributing beyond your own machine.
- **electron-store** — simple local JSON settings persistence, no DB needed for v1.

## UI / Rendering
- **React** — settings window UI (standard DOM/React, no special constraints).
- **For the overlay sprite itself**, pick one:
  - **PixiJS** (recommended) — WebGL-accelerated 2D sprite rendering, best performance for a window that must sit idle at near-0% CPU/GPU and animate smoothly; good sprite-sheet + tinting support (useful for the color-theme feature via runtime palette swaps).
  - Alternative: plain **Canvas2D** with hand-rolled sprite-sheet animation — simpler dependency footprint, fine given the sprite is small and simple; slightly more manual work for recoloring (draw to offscreen canvas + `globalCompositeOperation` tinting, or pre-baked color variant sprite sheets).
  - Alternative: **Lottie** (`lottie-web`/`lottie-react`) if you'd rather animate in After Effects/Rive and export vector animations — great for smooth expressive motion with less frame-by-frame art, but recoloring at runtime is more limited (usually need separate exported color variants).
  - Recommendation for a solo builder: start with **pre-baked sprite sheets + Canvas2D**, move to PixiJS only if you find performance or tinting genuinely painful.
- **XState** — explicit state machine for companion behavior (Idle/Wander/Alert/Travel/Interact/Dragging). Keeps behavior logic testable and out of tangled component state as features grow.

## Notification Detection & Interaction (Windows-native)
- **C#/.NET 8 (self-contained single-file publish)** — the Native Notification Watcher process.
  - `System.Windows.Automation` (UIAutomationClient/UIAutomationTypes) for reading the notification UI tree.
  - `SendInput` via P/Invoke (`user32.dll`) for simulated clicks — more reliable and lower-level than `SendMessage`/`PostMessage` tricks, which many modern UWP-hosted surfaces ignore.
  - Communicates with Electron over a **named pipe**, newline-delimited JSON (no extra serialization library needed — `System.Text.Json` built in).
- On the Node/Electron side: a small named-pipe client (e.g. `node:net` with Windows named pipe path support built into Node's `net.connect({ path: '\\\\.\\pipe\\...' })` — no extra dependency needed).

> Why not do this in pure Node? There's no mature, actively maintained Node/native-addon binding for Windows UI Automation. Wrapping raw `user32.dll`/`UIAutomationCore.dll` via `ffi-napi`/`node-ffi` is fragile (COM interop for UIA is painful outside .NET/C++). A small dedicated C# helper is the path of least resistance and is a very standard pattern for Electron apps needing deep OS integration (VS Code, Discord, and others ship native helper binaries for exactly this reason).

## Build / Dev Tooling
- **Vite** (via `electron-vite` or similar) for fast renderer dev/build — much faster iteration than webpack for the sprite/animation work you'll be doing a lot of.
- **TypeScript** across main, renderer, and preload — worth it given the IPC message contracts between three processes; catches a whole class of "sent the wrong shape" bugs early.
- **ESLint + Prettier** — standard.
- **electron-builder** targets: `nsis` installer for Windows x64 (and arm64 if you want to support Windows-on-ARM later).

## Testing
- **Vitest** for renderer/state-machine unit tests (XState machines are very testable in isolation).
- **Playwright** (via `@playwright/test` electron support) for smoke-testing the Electron app launches, tray exists, settings persist.
- Manual test matrix for the notification watcher (hardest part to automate) — a checklist of common notification sources (Windows system toasts, Outlook/Teams, Chrome web notifications, a manually-triggered test toast) to click through after any UIA-adapter change.

## Distribution
- **Code signing certificate** (EV or standard OV) — strongly recommended before any public distribution, given the app simulates input and reads UI trees; unsigned + that behavior profile is a near-guaranteed SmartScreen/AV flag.
- Installer via electron-builder NSIS target; auto-update feed hosted on GitHub Releases or S3 (electron-updater supports both generically).

## Summary Table

| Layer | Choice |
|---|---|
| Shell | Electron + electron-builder + electron-store |
| UI framework | React (settings), Canvas2D/PixiJS (overlay sprite) |
| Behavior logic | XState |
| Notification detection/click | C#/.NET 8 + UI Automation + SendInput, via named pipe |
| Language | TypeScript (JS side), C# (native helper) |
| Build tooling | Vite / electron-vite |
| Testing | Vitest, Playwright |
| Packaging | electron-builder (NSIS), electron-updater, code signing |

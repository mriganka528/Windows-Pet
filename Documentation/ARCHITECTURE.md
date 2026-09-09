# Architecture Document — Desktop Companion

## 1. High-Level Overview

Three cooperating processes:

```
┌──────────────────────────────┐        IPC (named pipe /        ┌───────────────────────────────┐
│  Electron Main Process        │◄──── localhost WebSocket ──────►│  Native Notification Watcher   │
│  (Node.js)                    │                                  │  (C# .NET, background service) │
│  - window/tray management     │                                  │  - UI Automation tree watcher  │
│  - settings persistence       │                                  │  - detects toast appear/close  │
│  - orchestrates companion FSM │                                  │  - reports bounding boxes       │
└──────────────┬─────────────────┘                                  │  - simulates clicks (SendInput) │
               │ IPC (contextBridge)                                └───────────────────────────────┘
               ▼
┌──────────────────────────────┐
│  Renderer Process (React)     │
│  - transparent overlay window │
│  - companion sprite + FSM UI  │
│  - settings window (separate  │
│    BrowserWindow)              │
└──────────────────────────────┘
```

## 2. Components

### 2.1 Electron Main Process
- Creates the **overlay BrowserWindow(s)**: `transparent: true`, `frame: false`, `alwaysOnTop: true` (screen-saver level), `skipTaskbar: true`, one per display if multi-monitor is supported.
- Manages **click-through**: uses `setIgnoreMouseEvents(true, { forward: true })` by default, and toggles it off dynamically only within the animal's current hitbox (renderer tells main "mouse is over me" via IPC, main flips the flag) — this is the standard pattern for "overlay window that's mostly click-through except one region."
- Owns the **companion state machine** (or delegates it to the renderer — see 2.2) and the **settings store** (e.g. `electron-store`, JSON on disk).
- Owns the **tray icon** and its menu.
- Bridges messages between the Native Notification Watcher (via IPC) and the renderer.
- Spawns/monitors the Native Notification Watcher as a **child process** on startup, restarts it if it crashes, and treats its absence as "notification features unavailable" rather than fatal.

### 2.2 Renderer (React) — Overlay
- Renders the sprite (Canvas2D/PixiJS/Lottie — see Tech Stack doc) and drives frame-by-frame animation.
- Owns the **movement/behavior FSM**: `Idle → Wander → Alert → Travel → Interact → Wander`. Recommend a small explicit state machine (e.g. XState) rather than ad hoc flags, since this will grow (drag state, mood modifiers, notification queue).
- Listens for events from main process: `notification:appeared { x, y, width, height, appId, isInteractive }`, `notification:closed { id }`.
- Emits intents back to main: `notification:requestAutoClose { id }` (only in auto-close mode) — **main process, not renderer, is the one that ultimately tells the native watcher to click**, keeping the "can this app click things" trust boundary out of the renderer/web-content layer.
- Handles drag interaction locally (pointer events on the sprite element), and reports "picked up"/"dropped" to main only if position needs to persist across restarts.

### 2.3 Renderer (React) — Settings Window
- Separate, normal (non-transparent, non-click-through) `BrowserWindow`, opened from tray.
- Reads/writes the same settings store via IPC (`settings:get`, `settings:set`).
- Live-pushes changes to the overlay window via main (no restart required).

### 2.4 Native Notification Watcher (C#/.NET)
This is the piece that can't live in Node/Electron directly.
- Uses `System.Windows.Automation` (UIA) to subscribe to window-open events for the known notification host window classes and walk the element tree to find: the notification's root bounding rectangle, whether it contains interactive controls (input fields, buttons beyond dismiss — used to skip auto-close), and the close button element specifically.
- Reports detected notifications over IPC to the Electron main process as JSON messages.
- Exposes a `closeNotification(id)` command (called only when Electron main forwards an explicit, allowlisted auto-close request) which re-locates the close button fresh (never trusts stale coordinates) and issues a `SendInput` click.
- Runs as a lightweight always-on background process, started/stopped by the Electron app; communicates via a local named pipe (preferred over TCP/WebSocket for a purely-local, no-network-surface design) using simple newline-delimited JSON messages.
- Packaged as a self-contained single-file .NET executable so end users never need the .NET runtime installed separately.

## 3. Data Flow — Notification Nudge (MVP path)
1. Watcher detects new toast → sends `{"type":"notification_appeared","id":"...","bounds":{...},"interactive":false}` over the pipe.
2. Main process receives it, forwards to overlay renderer via `webContents.send`.
3. Renderer FSM transitions `Wander → Alert → Travel`, animates the sprite toward `bounds` (converted from screen coords to overlay-window-local coords).
4. On arrival, plays `Interact (nudge)` animation loop until watcher sends `notification_closed` (user dismissed it) or a timeout elapses.
5. FSM transitions back to `Wander`.

## 4. Data Flow — Auto-Close (v1.1, opt-in)
Same as above through step 3, but at "Interact": renderer requests auto-close from main → main checks the app is on the user's allowlist AND `interactive:false` → main sends `close_notification` command to watcher → watcher re-verifies the element and bounds still match, then clicks → watcher confirms success/failure → main relays to renderer to play "success" or "couldn't reach it" animation.

## 5. Persistence
- Local JSON settings file (via `electron-store`) — character, size, color theme, mood default, behavior mode, per-app allowlist, monitor selection, start-with-Windows flag.
- No cloud sync, no telemetry in v1 (privacy-sensitive given the app inherently sees notification metadata).

## 6. Process Lifecycle & Resilience
- Native Watcher failing to start/crashing repeatedly → app falls back to "wander only" mode, no notification features, surfaced quietly in settings (see UI/UX §5), not via intrusive dialogs.
- Main process supervises the watcher child process with exponential backoff restart (cap retries to avoid runaway restart loops).
- Auto-updater (e.g. `electron-updater`) recommended once distributing outside dev machine, to push fixes quickly when Windows updates break the UIA adapter.

## 7. Security Considerations
- The Native Watcher runs with standard user privileges — no admin elevation should be required for UI Automation reads/clicks on foreground UI elements. Avoid requesting elevation; it's both unnecessary and a bad trust signal to users.
- Never log or persist notification *content* (title/body text) — only geometry/metadata needed for interaction, and only transiently in memory.
- Treat the IPC channel between Electron and the Watcher as a trusted-local-only boundary (named pipe with default OS ACLs restricting to the current user session is sufficient; no need for auth tokens for a purely local single-user pipe).

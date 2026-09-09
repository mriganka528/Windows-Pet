# Implementation Plan — Desktop Companion

Phased so each phase produces something runnable/demoable, given this is likely a solo/small build. Notification auto-close is deliberately pushed late since it's the highest-risk, most fragile piece.

## Phase 0 — Project Setup
- Scaffold Electron + Vite + React + TypeScript project (`electron-vite` template is the fastest path).
- Set up ESLint/Prettier, basic CI (build check on push) if desired.
- Confirm you can produce a transparent, frameless, always-on-top, click-through window that shows a static placeholder sprite and does nothing else. This is the riskiest *simple* thing to get right on Windows (transparency + click-through interaction) — validate it before building anything else on top.
- **Exit criteria**: a see-through overlay window sits on top of all apps, a placeholder square is visible, and you can click "through" the transparent area to whatever app is beneath it.

## Phase 1 — Companion Core (Wander + Drag)
- Build the sprite rendering pipeline (Canvas2D to start) with a placeholder animal (even a simple geometric "dog" is fine initially — swap real art later).
- Implement the XState behavior machine: `Idle ↔ Wander`, plus `Dragging` (pointer down/move/up).
- Implement basic wander logic: random walk along the screen edge/taskbar line, idle pauses, direction-based sprite flipping.
- Implement drag: pick up on mousedown over sprite, follow cursor, drop with a small "land" animation.
- **Exit criteria**: the companion wanders convincingly, and you can grab and reposition it anywhere on screen.

## Phase 2 — Tray, Settings, Persistence
- Add tray icon + menu (Pause/Resume, Settings, Quit).
- Build the Settings window (separate BrowserWindow) with the fields from the UI/UX doc §2.4, wired to `electron-store`.
- Wire live settings updates into the overlay (size/color/mood change without restart).
- Add start-with-Windows toggle (`app.setLoginItemSettings`).
- **Exit criteria**: you can fully customize the companion's look via Settings, quit/relaunch, and it remembers your choices.

## Phase 3 — Real Art & Mood/Expression System
- Replace placeholder geometry with actual sprite sheets (commission or self-draw) for at least: idle, walk, drag/react, and 2–3 mood variants.
- Implement recoloring (palette-swap sprite variants, or shader/compositing tint if using Pixi).
- Implement mood-driven animation speed/expression swaps.
- **Exit criteria**: the companion looks and feels charming, not placeholder-y; size/color/mood settings visibly change its appearance.

## Phase 4 — Native Notification Watcher (Detection Only)
- Build the standalone C# console/service app: subscribe to UIA window-open events, identify toast notification windows, extract bounding rects, log detected notifications to console for now (no Electron integration yet).
- Iterate against real notifications (Windows system toasts, an email client, a chat app) until detection is reliable.
- Add basic classification: does this notification contain interactive controls beyond a close button? (flag `interactive: true/false`).
- **Exit criteria**: running the watcher standalone and triggering various real notifications reliably prints correct bounding boxes and interactivity flags.

## Phase 5 — Wire Watcher into the App (Nudge Mode)
- Implement the named-pipe protocol both sides (C# server, Node client) with a minimal message schema (`notification_appeared`, `notification_closed`).
- Spawn/supervise the watcher from Electron main; handle its absence/crash gracefully (fallback to wander-only).
- Extend the XState machine: `Wander → Alert → Travel → Interact(nudge) → Wander`, driven by watcher events.
- Convert global screen coordinates from the watcher into per-overlay-window-local coordinates (important once multi-monitor is in play).
- **Exit criteria**: trigger a real notification anywhere on screen; the companion notices, travels to it, and reacts — without touching/closing it.

## Phase 6 — Auto-Close Mode (opt-in, highest risk — build last)
- Add `closeNotification(id)` to the watcher: re-locate the close button fresh, verify it still matches expectations, `SendInput` click, report success/failure.
- Add the per-app allowlist UI in Settings, and the trust-boundary logic in main (only forward auto-close requests for allowlisted, non-interactive notifications).
- Add "success"/"couldn't reach it" animations in the renderer.
- Test heavily against edge cases: notifications that self-dismiss mid-approach, stacked/grouped notifications, notifications from apps not in the allowlist (must be left alone).
- **Exit criteria**: for allowlisted apps, the companion visibly reaches and closes the notification most of the time, and never touches non-allowlisted or interactive notifications in testing.

## Phase 7 — Packaging, Signing, Polish
- Configure `electron-builder` for NSIS Windows installer, bundling the C# watcher's self-contained published executable as an extra resource.
- Get a code-signing certificate; sign both the Electron installer and the native watcher executable.
- Set up `electron-updater` + a release channel (GitHub Releases is the simplest to start).
- Final performance pass: confirm idle CPU/RAM targets from the PRD are met; profile the wander animation loop and the watcher's UIA polling/event overhead.
- Write onboarding/first-run flow explaining what the companion does and does not do (especially the auto-close permission model), per UI/UX transparency principle.

## Suggested Order of Attack for This Repo
When you hand this to Claude (Code or chat) to actually scaffold, the highest-leverage order is: **Phase 0 → Phase 1 → Phase 2**, get a genuinely fun-to-use "dog that wanders and can be dragged" app working end-to-end first (this alone is a complete, shippable-feeling toy), *then* layer in the notification pieces in Phases 4–6, since that's a self-contained sub-system you can build and test independently via the standalone C# console app before ever wiring it into Electron.

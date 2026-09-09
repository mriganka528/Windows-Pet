# Nudge — a desktop companion for distraction avoidance (Windows)

A cartoon animal (default: a dog) that lives on your desktop, wanders freely over all your open windows, and can be dragged anywhere. When a notification pops up, it walks over and reacts to it — optionally closing it for you, for apps you explicitly allow.

## Why
Desktop notifications are a constant source of context-switching. Instead of another "Do Not Disturb" toggle, this gives you a visible, low-effort companion that handles the small stuff so you don't have to consciously engage with every toast.

## Status
Early-stage / pre-alpha. See `IMPLEMENTATION_PLAN.md` for the current build phase.

## Features
- Free-roaming animated companion, always-on-top, click-through everywhere except its own sprite.
- Drag-and-drop repositioning.
- Fully customizable: character, size, color theme, and mood/expression.
- Notification-aware: nudges you toward new notifications by default.
- Optional, per-app opt-in auto-close for notifications (never for notifications that require interaction).
- Lives quietly in the system tray — pause, resume, or quit anytime.

## Documents in this repo
| File | Purpose |
|---|---|
| `PRD.md` | Product requirements — problem, goals, feature scope, risks |
| `UI_UX.md` | Design principles, surfaces, visual style, states |
| `ARCHITECTURE.md` | System design — Electron/React overlay + native Windows notification watcher, IPC, data flow |
| `TECH_STACK.md` | Concrete libraries/tools and why each was chosen |
| `IMPLEMENTATION_PLAN.md` | Phased build plan from empty repo to packaged installer |

## Tech Stack (short version)
Electron + React + TypeScript for the app shell and overlay UI, a small native C#/.NET helper process for Windows UI Automation (notification detection) and simulated clicks, communicating over a local named pipe. Full detail in `TECH_STACK.md`.

## Platform
Windows 10/11 only for v1 (the notification-interaction feature depends on Windows-specific UI Automation APIs).

## Getting Started (once scaffolded)
```bash
# install dependencies
npm install

# run in development
npm run dev

# build the native notification watcher (separate .NET project)
cd native/watcher
dotnet publish -c Release -r win-x64 --self-contained

# package the Windows installer
npm run build
```
*(Exact scripts will depend on the scaffold chosen during Phase 0 — see `IMPLEMENTATION_PLAN.md`.)*

## Privacy
The companion only ever reads notification *geometry* (position/size) and basic metadata (source app, whether it looks interactive) needed to react to or close it — never notification text/content, and nothing is logged or sent anywhere. Everything runs locally.

## License
TBD.

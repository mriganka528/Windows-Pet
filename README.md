# Nudge

A customizable illustrated animal desktop companion for **Windows**. It roams
across all your windows on a transparent, click-through overlay, can be **petted
and dragged**, and — when you let it — **reacts to real Windows notifications**:
it trots or waddles over to the toast, and in auto-close mode swats it shut with
its paw before wandering off again.

Preview the redesigned [animal roster](art-preview/storybook-roster.png) and
[expressions](art-preview/storybook-expressions.png).

To create an installer other people can use, follow [the Windows installer guide](INSTALLER.md).
Run `npm.cmd run dist:win` on your Windows build machine; the expected output is
`dist/Nudge-Setup-0.1.1-x64.exe`.

The first installed launch shows a short notification setup tip. It explains
that Windows **Do not disturb** (Windows 10 **Focus assist**) can hide banners,
and should be turned off if you want the pet to interact with them. Choose
**Settings → Behavior → Close them for me** for Auto-close. The tip closes after
25 seconds, pauses while you interact, and can be dismissed immediately. Reopen
it from the system tray's **Notification setup…** menu.

---

## ⚠️ Read this first: notifications need a native build

**The single most common "it's not working" problem:** the pet roams and can be
petted, but it **completely ignores notifications** — it never rushes over, never
closes anything.

That happens because reacting to toasts is not something Electron can do on its
own. A small, separate **C# / .NET 8** program (`native/NudgeWatcher`) watches for
toasts via Windows UI Automation and streams their position to the app. **If that
program has not been compiled, Nudge silently falls back to "wander-only"** — every
part of the app still works _except_ noticing notifications, so nothing looks
broken. It just quietly does nothing when a toast appears.

**To make notifications work you need the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
installed, and the watcher compiled.** As of now `npm run dev` **compiles it for
you automatically** (see below), so in most cases you just need the SDK present.

**How to tell in 5 seconds whether the watcher is live:**

- **Tray menu / tooltip.** If it shows **"⚠ Notifications unavailable —
  wander-only"**, the watcher did **not** build or start — you're in wander-only
  mode and the pet will ignore every toast. Fix that first (usually: install the
  .NET 8 SDK, then `npm run watcher:build`).
- **The debug badge** (top-left of the overlay in dev) normally reads
  `Nudge · wander · … · click-through`. When a toast is actually detected, the
  middle word changes to **`alert` → `travel` → `interact`** as the pet reacts. If
  it never leaves `wander`/`idle` when a toast pops, detection isn't reaching the
  app.

---

## Prerequisites

| Requirement             | Why                                                                                                                 | Check                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Windows 10 or 11**    | The overlay + the watcher call Windows-only APIs.                                                                   | —                               |
| **Node.js 18+ and npm** | Builds and runs the Electron app.                                                                                   | `node --version`                |
| **.NET 8 SDK**          | Compiles the native notification watcher. **Without it, notifications are disabled** (everything else still works). | `dotnet --version` → want `8.x` |

No administrator rights are required. The watcher runs as a standard user
(`asInvoker`); UIA reads on foreground UI don't need elevation.

---

## Quick start

```powershell
cd "D:\Window pet"
npm install          # installs Node deps (do this on Windows)
npm run dev          # auto-builds the C# watcher, then launches Nudge
```

`npm run dev` runs a `predev` step (`scripts/build-watcher.mjs`) that compiles the
watcher **best-effort**:

- **.NET 8 SDK present** → the watcher is built and notifications work.
- **.NET SDK missing / build fails** → you get a friendly one-line note in the
  console, and **dev still launches** — just in wander-only mode. Nudge never
  refuses to start because of the watcher.
- **Nothing changed since last build** → the step is skipped so startup stays fast.

That means: install the .NET 8 SDK once, run `npm run dev`, and notifications just
work. If you started the app _before_ installing the SDK, install it and run
`npm run dev` again (or `npm run watcher:build`).

---

## Using it

- **Move it around** — drag the animal anywhere; drop it and it resumes roaming.
- **Pet it** — a quick click/tap (no drag) makes it happy.
- **Storybook characters** — all 15 animals share a soft, rounded design inspired
  by the supplied character sheet: fuller cheeks, glossy eyes, shaded fur,
  padded paws, and cozy curled sleeping poses. Cats, dogs, and foxes trot and
  bound; the panda has a stocky upright gait. Smiles and the seven mood faces
  follow the new head proportions. All existing coat choices still apply.
- **Put it to sleep** — right-click the animal. It runs to the **top-left corner
  by default** and curls up. Choose any of the four corners in **Settings →
  Movement & sleep → Sleeping position**; changing it while asleep moves the pet
  to its new bed. The position stays inside the taskbar's work area. Notifications,
  music, and webcam activity leave it asleep. Left-click to wake it and resume
  roaming; you can also cancel the walk to bed with a left-click. The tray's
  separate Pause setting still applies after waking.
- **Varied movement** — the pet explores random destinations across the usable
  screen, mixing short strolls and longer trips with varied pacing. It sometimes
  turns to face you while roaming. Rabbits and frogs hop; birds waddle. Movement
  eases in and out, with longer strides for faster trips.
- **Wandering speed** — use the **25–200% slider** in Settings → Movement & sleep.
  It changes normal roaming live and saves your choice. Notification trips and
  the trip to bed keep their quick pace independently of this control.
- **Notification reactions** — the pet shows a stronger angry glare while a
  notification is active and faces front to dismiss it. Once it closes, anger
  and its particles clear immediately and the face returns to the selected
  default mood, with a brief front-facing pause before roaming again.
- **Front-facing moments** — dancing faces the viewer; webcam reactions finish
  with a front-facing wave and a cute expression. Species have appropriate tails,
  including short tails for rabbits and bears; adult frogs and koalas stay tailless.
- **Dance to music** — enabled by default. Nudge reads playback levels from
  Windows' audio meter, without starting screen sharing, audio recording, or
  microphone capture. This avoids the screen-sharing trigger for Do Not Disturb.
  The existing native helper must be rebuilt once for this update (`npm run dev`
  does that automatically). Turning dancing off, pausing, or sleeping stops the
  meter. An explicit Off chosen after this update stays saved on later launches.
- **Coat choices** — Settings offers 15 colors per animal: its original natural
  coat, three animal-specific variants, and eleven shared colors. For example,
  the fox has Arctic white, Silver fox, and Sandy fox variants. Changes preview
  immediately and save with the existing preferences.
- **Distinct moods** — the mood picker shows face previews: Happy smiles,
  Excited has bright eyes and an open grin, Curious tilts its head with uneven
  brows, Alert watches with wide eyes, Chill has relaxed lids, Sleepy closes its
  eyes, and Grumpy wears a clear pout. Both front and side views use these faces.
- **Tray icon** — right-click for: pick your animal, appearance/mood, **Pause**
  (freezes all behavior and reactions), notification **mode**, and the live
  notification status line described above.
- **Notification modes:**
  - **Nudge (default)** — when a toast appears the pet walks over and reacts
    (looks/points), but does **not** touch the notification.
  - **Auto-close** — the pet walks over and **swats the toast closed** with its
    paw, then returns to roaming. Scope is **"close everything"**: it closes every
    toast it can, including interactive ones.
  - **Pause** overrides both — while paused nothing reacts.

Closing is done by invoking the toast's _own_ dismiss control through UI
Automation (the same thing the OS does when you click the ✕) — **not** by faking
mouse clicks at screen coordinates. It's DPI-safe and can't click the wrong thing.

---

## npm scripts

| Script                                   | What it does                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                            | Auto-build the watcher (`predev`), then launch the app in dev.                                                                         |
| `npm run watcher:build`                  | Compile the native watcher explicitly (Debug), with full error output. Use this to see _why_ a build failed.                           |
| `npm run watcher:build:release`          | Same, Release configuration.                                                                                                           |
| `npm run build`                          | Type-check + build the Electron app for packaging.                                                                                     |
| `npm run typecheck`                      | `tsc --noEmit` for both the node and web TS projects.                                                                                  |
| `npm run lint`                           | ESLint (zero warnings allowed).                                                                                                        |
| `npm test`                               | Vitest unit suites (motion, machine, coords, transport, notifications).                                                                |
| `npm run test:e2e -- --project=renderer` | Browser interaction checks against a built renderer (Chrome required).                                                                 |
| `npm run test:e2e -- --project=electron` | Native overlay smoke checks using a temporary settings profile.                                                                        |
| `node scripts/preview-characters.mjs`    | Generate an animated roster gallery in `test-results/characters/index.html`. Add `--screenshot` to export light/dark PNGs with Chrome. |

> **Force a watcher rebuild** regardless of freshness:
> `FORCE_WATCHER_BUILD=1 npm run dev`.
> **Point at a prebuilt exe** (skip building entirely — handy for a packaged or
> shared binary): set `NUDGE_WATCHER_EXE` to its full path. The app checks that
> override first, then a packaged `resources/watcher/NudgeWatcher.exe`, then the
> dev build under `native/NudgeWatcher/bin/{Debug,Release}/net8.0-windows10.0.19041.0/`.

---

## Troubleshooting

**The pet ignores notifications / never walks over to a toast.**
In order of likelihood:

1. **The watcher wasn't built.** Check the tray line — if it says "⚠ Notifications
   unavailable — wander-only", that's the cause. Make sure the **.NET 8 SDK** is
   installed (`dotnet --version`), then run `npm run watcher:build` and restart the
   app. This is by far the most common cause.
2. **You're paused, or in the wrong mode.** Pause suppresses everything. In _Nudge_
   mode the pet reacts but won't close toasts; only _Auto-close_ closes them.
3. **Detection misses your specific toast.** Toast detection via UIA is heuristic
   and varies by app and Windows build, so it can miss until tuned. The debug badge
   staying on `wander` when a toast is clearly visible points here. Tuning is a
   one-file job — see `native/NudgeWatcher/README.md` → "If detection doesn't work:
   tuning" (`ToastHeuristics.cs`), and use `dotnet run -- --scan --verbose` from
   `native/NudgeWatcher/` while a toast is on screen to see what the watcher sees.

**`npm run dev` prints a `[build-watcher]` note about dotnet.** That's expected and
harmless when the .NET SDK isn't installed — dev still runs, just wander-only.
Install the .NET 8 SDK to enable notifications.

---

## Privacy

The watcher is built so it **cannot leak notification content**. It emits only
geometry (position/size) plus a couple of metadata flags and a best-effort host
process name — **never** the title or body. It reads some control _labels_ while
classifying (e.g. a button named "Reply", to set the `interactive` flag), but those
never leave the process, and even `--verbose` diagnostics redact text. This mirrors
`Documentation/ARCHITECTURE.md` §7.

---

## Project layout

| Path                        | What's there                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/`                 | Electron main process: overlay window, tray, settings, and the notification-watcher supervisor (`notificationWatcher.ts`) + trust-boundary IPC (`index.ts`). |
| `src/preload/`              | The single, minimal `window.nudge` bridge (context-isolated).                                                                                                |
| `src/renderer/`             | The overlay UI + the companion: XState locomotion machine, pure mood reducer, and the Canvas2D sprite (`companion/`).                                        |
| `src/shared/`               | Types + helpers shared across processes (settings, coordinate conversion).                                                                                   |
| `native/NudgeWatcher/`      | The C# / .NET 8 notification watcher. Has its own detailed README.                                                                                           |
| `scripts/build-watcher.mjs` | The best-effort `predev` watcher build.                                                                                                                      |
| `Documentation/`            | The phase-by-phase design docs and architecture notes.                                                                                                       |
| `PHASE_NOTES.md`            | Running build log: what was built per phase and how it was verified.                                                                                         |

---

## A note on verifying changes

Parts of this repo are developed with assistance from a Linux sandbox that can run
`tsc` and lint but **cannot** run `electron-vite`, Vitest, or `dotnet` (Windows-only
native deps + no registry access). So the authoritative checks — `npm test`,
`dotnet build`, and the live GUI run — happen **on Windows**. See `PHASE_NOTES.md`
for the per-phase verification status and the exact Windows commands.

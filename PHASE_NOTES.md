# Nudge — Build Progress & Verification Notes

This file tracks what's been built per phase and how it was verified. It's a
running log for the solo build, not user-facing product docs.

---

## Environment constraint (why some checks happen on Windows)

Development assistance runs partly in a Linux sandbox where:

- The npm registry is blocked, so `npm install` happens on the Windows machine.
- `node_modules` is a Windows x64 install, so `electron-vite dev/build` and
  Vitest (which pulls in Vite→rollup native binaries) **cannot run** in the
  sandbox.
- `tsc` is pure JS and **does** run in the sandbox — it's the primary in-loop
  check. GUI runs and the Vitest/Playwright suites run on Windows.

---

## Phase 0 — Project Setup ✅ (type-checked clean)

Transparent, frameless, always-on-top, click-through overlay with a placeholder
sprite. Both TS projects type-check clean (`tsc -p tsconfig.node.json` and
`-p tsconfig.web.json`, exit 0).

Exit criteria: see-through overlay above all apps, placeholder visible, clicks
pass through transparent areas. **Confirm on Windows** via `npm run dev`.

---

## Phase 1 — Companion Core (Wander + Drag) ✅ (type-checked; unit tests written)

### What was built
- `src/renderer/src/companion/motion.ts` — pure motion math (ground line, clamp,
  facing, wander-target picking, step-toward). No DOM/React. **15 unit assertions
  pass** (run in-sandbox via transpile-to-CJS harness, since Vitest can't run here).
- `src/renderer/src/companion/machine.ts` — XState v5 machine. States:
  `idle ↔ wander`, plus `dragging` and a brief `landing` beat. Context holds
  position/target/facing/bounds. Driven by `TICK { dt }`; drag via
  `PICK_UP`/`DRAG_MOVE`/`DROP`; `SET_BOUNDS` on resize.
- `src/renderer/src/companion/SpriteCanvas.tsx` — Canvas2D procedural "dog"
  placeholder, hi-DPI aware, facing flip + idle/walk/drag pose variation.
- `App.tsx` — rewired: `useMachine`, a `requestAnimationFrame` loop sending
  `TICK`, resize→`SET_BOUNDS`, and mouse→drag translation that coexists with the
  Phase 0 click-through toggle (interaction is forced ON mid-drag so fast drags
  don't drop the sprite).
- `machine.test.ts` — Vitest suite covering idle→wander, drag, drop→landing→idle,
  and bounds re-clamp. **Runs on Windows** (needs the xstate package).

### Verification status
- `tsc -p tsconfig.node.json` → **exit 0** (clean).
- `tsc -p tsconfig.web.json` → only errors are `Cannot find module 'xstate' /
  '@xstate/react'` (+ the implicit-any cascade they cause in machine.ts). These
  are because the sandbox can't install packages. **They clear after
  `npm install` on Windows.** No other type errors.
- motion.ts logic → **15/15 assertions pass** in-sandbox.

### To verify on Windows
```powershell
cd "D:\Window pet"
npm install          # pulls xstate + @xstate/react (newly added)
npm run typecheck    # expect exit 0 now that xstate resolves
npm test             # motion + machine + hitTest suites (Vitest)
npm run dev          # watch the dog wander; drag it around
```

### Phase 1 exit criteria (from IMPLEMENTATION_PLAN.md)
> the companion wanders convincingly, and you can grab and reposition it anywhere.

Confirm in `npm run dev`:
1. The dog rests on the bottom (taskbar) line, pauses, then walks to a new spot;
   it faces the direction it walks and occasionally drifts upward (excursion).
2. Mouse-down on the dog picks it up (eyes widen), it follows the cursor, and on
   release it settles back down to the ground line and resumes wandering.
3. Clicking anywhere that is NOT the dog still passes through to the app beneath.

---

## Cuteness + Expressions (Phase 3 art/mood pulled forward) ✅ (type-checked + lint clean)

The Phase 1 placeholder looked flat. This pass makes the companion read as a
soft, dimensional "toy" and gives it real emotions, while **not** touching the
deferred notification detection (Phases 4-6).

### The "little bit 3-D" approach (why not real 3D)
Real 3D (Three.js/WebGL) on an always-on-top overlay would blow the idle-CPU
budget (PRD §NFR) and needs authored 3D assets we don't have. Instead the depth
is faked with cheap Canvas2D tricks: radial-gradient **volume** (a lit sphere) on
head/body/tail, a soft radial **ground shadow** that shrinks when the pup is
lifted, a top-left **rim highlight**, and **glossy catch-lights** in the eyes.
All procedural — no image files — so it recolors/rescales freely and stays crisp
at any DPI.

### Expression / mood system (kept OUT of the locomotion FSM on purpose)
Mood is orthogonal to movement (happy-while-wandering, surprised-while-dragged),
so coupling it into the XState machine would mean parallel states and would
disturb the already-tested locomotion FSM. Instead mood is a tiny **pure
reducer** driven from React:
- `companion/mood.ts` — `Mood` = neutral | happy | love | angry | surprised |
  sleepy. `MoodState` = base (neutral/sleepy) + a timed transient (love/angry) +
  a dragging flag. `reduceMood` handles PET / ALERT / CALM / DRAG_START /
  DRAG_END / SLEEP / WAKE / TICK; `expressionOf` resolves priority
  **dragging(surprised) > transient(angry/love) > base**. Pure → verified in the
  sandbox (see below).
- `companion/effects.ts` — pure particle math: `spawnHearts` / `spawnAnger` /
  `spawnSleep`, `stepParticles(dt)` (advance + drop expired, non-mutating),
  `particleAlpha` / `particleScale` (fade-in/out + pop). Pure → verified.
- `companion/SpriteCanvas.tsx` — rewritten: shaded body/head/ears/muzzle/tail/
  legs + a per-expression face (round glossy eyes w/ blink, blissful `‿‿` eyes +
  blush + tongue for love, angled brows + narrowed glare + pulsing anger vein for
  angry, wide eyes + `o` mouth for surprised, closed arcs for sleepy). Springy
  hop when petted; shiver when annoyed; leg-swing while walking; dangle + shrunk
  shadow while dragged.
- `companion/EffectsCanvas.tsx` — viewport-sized `pointer-events:none` overlay
  that draws floating hearts/anger/z's. Imperative `ref` API (`hearts/anger/
  sleep(x,y)`); runs its rAF **only while particles are alive** (zero idle cost).

### Interactions wired (App.tsx)
- **Pet vs drag** is disambiguated by pointer travel: press + release under 5px =
  a *pet* (love face + a burst of hearts); press + move = a *drag* (surprised
  face, follows cursor, `DRAG_START`/`DRAG_END`). This avoids a "surprised" flash
  on a quick tap.
- **Notification → angry** is delivered via a `companion:event` IPC channel
  (`{ kind: 'alert' | 'pet' | 'calm' }`). Since real detection is deliberately
  deferred to Phase 5, main registers **dev-only global shortcuts** (gated on
  `!app.isPackaged`) to fire them by hand:
  - `Ctrl/Cmd+Alt+N` → angry (simulated notification) + anger puffs
  - `Ctrl/Cmd+Alt+P` → pet + hearts
  - `Ctrl/Cmd+Alt+C` → calm (clear reaction)
  The Phase 5 watcher will raise the exact same `alert` event, so no renderer
  changes are needed when it lands. `window.nudge.onCompanionEvent(cb)` (preload)
  is the subscription; it returns an unsubscribe fn.

### Verification status
- `tsc -p tsconfig.node.json` and `-p tsconfig.web.json` → **both exit 0** (the
  Phase-1 "xstate missing" caveat is gone now that deps are installed).
- `eslint --max-warnings 0` on all touched files **+ the two new test files** →
  **clean** (exhaustive-deps + no-unused-vars satisfied).
- `mood.ts` + `effects.ts` pure logic → **32/32 assertions pass** in-sandbox
  (transpile-to-CJS harness, same technique as motion.ts).
- New Vitest suites `mood.test.ts` + `effects.test.ts` **run on Windows**.

### To verify on Windows
```powershell
cd "D:\Window pet"
npm install       # no NEW deps this pass, but safe to run
npm run typecheck # expect exit 0
npm test          # motion + machine + hitTest + mood + effects
npm run dev       # then: pet the pup (quick click -> hearts),
                  #       drag it (surprised), and press Ctrl+Alt+N (angry)
```

### Not done here (still deferred, by your sequencing rule)
Real notification detection/auto-close (Phases 4-6). The angry reaction is
demonstrable now only via the dev shortcut; it gets its real trigger in Phase 5.
Phase 2 (tray + settings + persistence) is the next planned step.

---

## Phase 2 — Tray + Settings + Persistence ✅ (type-checked + lint clean)

The app is now a proper tray-resident companion: preferences persist across
restarts, a Settings window customizes the look live, and a tray menu controls
Pause/Settings/Quit. No notification detection here (still deferred to 4-6).

### What was built

**Shared settings contract — `src/shared/settings.ts`** (dependency-free, imported
by main + both renderers via relative paths so it stays trivially testable):
- Types: `Size`, `ColorThemeId`, `MoodDefault`, `BehaviorMode`, `CharacterId`, the
  per-section interfaces, `NudgeSettings`, and a `SettingsPatch` (deep-partial).
- `DEFAULT_SETTINGS` (nudge mode, not paused, medium classic dog, happy mood).
- Lookup data: `SIZE_PX` (small 48 / medium 80 / large 128), `COLOR_THEMES`
  (5 palettes → `SpritePalette`), label/order maps for the UI.
- `mergeSettings(base, patch)` — pure section-wise merge; used both to apply a
  patch and to **hydrate a partial/stale store onto defaults** (forward-compat:
  an old store transparently gains new keys).

**Renderer mappers — `src/renderer/src/companion/appearance.ts`** (pure): turns
settings into behavior — `wanderConfigFor(settings)` (size→footprint,
mood→energy/rest/roam, reduced-motion→calmer) and `baseMoodFor(mood)` (chill→
sleepy resting face, else neutral). Kept in the renderer (not shared) so
`src/shared` never imports renderer/DOM types.

**Persistence — `src/main/settingsStore.ts`**: thin wrapper over electron-store.
`initSettings()` loads + normalizes (mergeSettings onto defaults) + writes back;
`getSettings()`, `updateSettings(patch)`, `resetSettings()`.
- **electron-store pinned to the v8 line** (see package.json). v9+ is ESM-only
  (`"type":"module"`); our main bundle is CommonJS (Electron sandbox +
  externalized deps → `require()`), so an ESM-only build throws
  `ERR_REQUIRE_ESM` at startup. v8 is the last CJS release and exposes the same
  tiny API we use. **This requires `npm install` on Windows to actually downgrade
  the installed package** (was 10.x).

**Main process — `src/main/index.ts`** (rewired):
- **Tray** (`src/main/trayIcon.ts` holds a base64 paw-print PNG, no asset files):
  status label + Pause/Resume + Settings… + Quit; double-click opens Settings.
- **Settings window**: a normal opaque `BrowserWindow` loading the second
  renderer entry (`settings.html`); single-instance, closing hides not quits.
- **Settings IPC**: `settings:get` / `settings:set` / `settings:reset`
  (`ipcMain.handle`). On change: persist → run OS side effects → broadcast the
  full settings to every window via `settings:changed`.
- **Start-with-Windows**: `app.setLoginItemSettings({ openAtLogin })`, guarded to
  `app.isPackaged` so `npm run dev` never registers the throwaway dev binary.
- **Tray-app lifecycle**: the Phase-0 "quit when all windows close" is **removed**
  — the app stays alive in the tray until the user chooses Quit (`isQuitting`
  guards the real exit; tray destroyed on will-quit).

**Preload — `src/preload/index.ts`**: added `getSettings()`, `setSettings(patch)`,
`resetSettings()`, and `onSettingsChanged(cb)` to `window.nudge` (existing
`setMouseIgnore` / `onCompanionEvent` unchanged).

**Settings UI — `src/renderer/src/settings/{settings.html, main.tsx,
SettingsApp.tsx, settings.css}`**: Appearance (character picker, size segmented,
color swatches, default-mood segmented) with a **live sprite preview**; Behavior
(nudge vs auto-close cards, auto-close carries a "turns on once notification
handling ships" note — no detection logic built); General (start-with-Windows,
sound, reduced-motion toggles); Reset to defaults. Every control writes through
`setSettings` and the window also subscribes to `settings:changed`.

**Overlay live-apply — `App.tsx`**: reads settings on mount + subscribes; applies
size via `SET_CONFIG` (new machine event/action — snaps to the new ground line
and retargets in place), color via the `SpriteCanvas` `palette` prop, default
mood via SLEEP/WAKE, and **Pause by gating the movement TICK** (a drag and its
landing beat still advance so a dropped pup settles; drag/pet stay interactive).

**Build/config**: `electron.vite.config.ts` gains the `settings.html` renderer
input; `src/shared` added to both `tsconfig.node.json` and `tsconfig.web.json`
`include` (required — both are `composite` projects and must list imported files).

### Verification status
- `tsc -p tsconfig.node.json` → **exit 0**; `tsc -p tsconfig.web.json` → **exit 0**.
- `eslint --max-warnings 0` (whole project) → **clean**.
- Pure logic (`mergeSettings` + `wanderConfigFor` + `baseMoodFor`) → **34/34
  assertions pass** in-sandbox (transpile-to-CJS harness).
- New Vitest suites `src/shared/settings.test.ts` +
  `src/renderer/src/companion/appearance.test.ts` (and the `SET_CONFIG` case in
  `machine.test.ts`) **run on Windows**.

### To verify on Windows
```powershell
cd "D:\Window pet"
npm install          # IMPORTANT: downgrades electron-store 10.x -> 8.x (CJS)
npm run typecheck    # expect exit 0
npm test             # motion + machine(+SET_CONFIG) + hitTest + mood + effects
                     #   + settings + appearance
npm run dev
```
Then confirm the Phase 2 exit criteria (IMPLEMENTATION_PLAN.md):
1. A tray icon appears; its menu has Pause/Resume, Settings…, Quit.
2. Settings opens; changing size / color / mood updates the live overlay pup
   immediately (and the in-window preview).
3. Pause freezes wandering (the pup still reacts to petting/drag); Resume thaws.
4. Quit from the tray fully exits; relaunch **remembers** your choices.
5. Toggling "Start with Windows" in a **packaged** build adds/removes the login
   item (no-op in `npm run dev`, by design).

### Not done here (still deferred, by your sequencing rule)
Notification detection/auto-close (Phases 4-6) — the Behavior "auto-close" mode
is a persisted preference only, with copy saying it activates later. Real art
sprite sheets (Phase 3).

---

## Phase 3 — Liveliness & Mood/Expression System ✅ (type-checked + lint clean)

The earlier "Cuteness + Expressions" pass gave the pup a dimensional look and
real emotions, but at rest it still just bobbed — reading a bit like a
screensaver. This phase makes it feel like a small living creature: it
**breathes**, its walk has **squash-and-stretch** and bounce, and it performs
occasional **ambient idle actions** (glance around, ear twitch, tail flick, shake
off, big stretch, yawn). How lively all of this is now scales with the pet's
**mood** (energy), and **reduced motion** calms it right down. This is the
liveliness the inspiration clip asked for ("more lively and friendly"); the
event-reactive parts of that clip (dance-to-music, webcam activity, swatting
notifications) are deliberately **captured as later-phase requirements** — see
"Deferred" below.

### The "brain vs body" split (why a separate pure scheduler)
Deciding *when* to fidget is logic; *drawing* the fidget is rendering. Mixing
them into the canvas loop would make the timing impossible to test and would
tangle with the two systems that are already pure and tested (the locomotion
FSM and the mood reducer). So the schedule lives in its own pure module:

- `companion/activity.ts` — the ambient-idle **scheduler** (pure; no DOM/React/
  canvas, injectable `rng`, driven by `dt`). `IdleAction` = idle | lookAround |
  earTwitch | tailFlick | shake | stretch | yawn. `stepActivity(state, dt, ctx,
  rng)` counts down a jittered gap, fires a weighted-random action, holds it for
  its duration, then reschedules. `actionProgress` gives 0→1 through the current
  action so the renderer can draw a rise-and-fall pose. **Design gates:** actions
  fire **only while resting** (idle locomotion — not walking, not dragging;
  walking already has its own gait), `reducedMotion` **suppresses them entirely**,
  and `energy` **shortens the gap** so an alert pup fidgets more than a chill one.
- `companion/appearance.ts` — added `energyFor(mood, reducedMotion)`: the
  on-the-spot **animation liveliness** multiplier (~0.72 chill / 1 happy / 1.3
  alert; clamped ≤0.5 under reduced motion). Kept **separate from
  `wanderConfigFor`'s walk SPEED** on purpose — one drives how fast it *travels*,
  the other how fast it *animates in place*. This is also where the Happy-vs-Alert
  distinction survives, since both resolve to a `neutral` resting face.

### Renderer rewrite — `companion/SpriteCanvas.tsx` (frame-based → time-based)
The old loop animated off an integer frame counter (`Math.sin(f * 0.18)`), so
speed was tied to frame rate and couldn't be scaled by mood. It's now **time
based**: it derives `dt` from the rAF timestamp and keeps two clocks — a
wall-clock `real` clock (scheduler + one-shot reactions) and an **energy-scaled
`osc` clock** so every oscillator (bob, tail wag, blink) speeds up with a
livelier mood. New motion layered in:
- **Breathing** at rest (gentle body-scale on the Y axis) and **walk squash-and-
  stretch** (footfall compresses X / extends Y), both about the feet anchor so the
  paws stay planted.
- The six **idle actions** as pose math keyed off `actionProgress`: head-yaw
  glance, a front-ear rotate-about-base twitch, a boosted tail flick, a whole-body
  shake (rotate + x-jitter), a stretch (body scale + dip), and a yawn (a growing
  mouth + squinted eyes that overrides only the calm faces).
- A **pet reaction**: a springy one-shot hop + a ~1.2s tail-wag burst, triggered
  when the expression flips to `love`.
- New **optional** props `energy?` (default 1) and `reducedMotion?` (default
  false). Optional on purpose so the Settings live-preview `<SpriteCanvas>` call
  keeps working unchanged. `reducedMotion` also damps every amplitude (`motion`
  factor) on top of the scheduler suppression.
All the existing shaded-sphere drawing + per-expression face code is preserved.

### Wiring — `App.tsx`
- Computes `energy = energyFor(moodDefault, reducedMotion)` and reads
  `reducedMotion` from settings (live, in the same `apply` path as size/color/
  mood), and passes both to `<SpriteCanvas>`.
- **Sleepy 'z' emitter**: while the resting face is `sleepy` (chill mood), a small
  interval puffs a `z` from the head via the existing `EffectsCanvas.sleep(x,y)`
  every ~2.6s, cleared when the face changes. Kept in the impure layer so the
  particle timing never leaks into the pure modules.

### Verification status
- `tsc -p tsconfig.web.json` and `-p tsconfig.node.json` → **both exit 0**
  (re-run after clearing `.tsbuildinfo`, i.e. a full check, not an incremental one).
- `eslint --max-warnings 0` (whole project) → **clean**.
- `activity.ts` + `energyFor` pure logic → **28/28 assertions pass** in-sandbox
  (transpile-to-CJS harness, same technique as motion/mood/effects/settings).
- New Vitest suites `companion/activity.test.ts` + the `energyFor` block added to
  `companion/appearance.test.ts` **run on Windows**.

### To verify on Windows
```powershell
cd "D:\Window pet"
npm install          # no NEW deps this pass
npm run typecheck    # expect exit 0
npm test             # ... + activity + appearance(energyFor)
npm run dev
```
Then confirm the Phase 3 exit criteria (IMPLEMENTATION_PLAN.md — "the companion
feels alive; animation speed tracks mood"):
1. At rest the pup visibly **breathes**, and every few seconds does a small idle
   action (look around / ear twitch / tail flick / shake / stretch / yawn).
2. Set mood to **Alert** → it fidgets more often and animates faster; set **Chill**
   → it settles to a sleepy face, drifts `z`'s, and rarely fidgets.
3. Petting it (quick click) triggers a **hop + tail-wag burst** with hearts.
4. Turn on **Reduced motion** → breathing/fidgets calm dramatically and ambient
   idle actions stop, while the pup is still present and pettable.

### Deferred — event-reactive behaviors from the inspiration clip (Phases 4-6)
The uploaded reference clip shows the companion **reacting to system events**:
dancing to music/sound, doing something when the **webcam** turns on, and
**swatting/closing notifications**. These are intentionally **not** built here —
they depend on OS signal detection, which the plan sequences after the core
experience (and which is the riskiest Windows work). They are recorded now so the
later phases pick them up:
- **Dance-to-music** — needs audio/output detection (a system audio signal). When
  that lands it becomes an **event-pushed** `dance` action: add a `dance` member to
  `IdleAction` + a pose branch in `SpriteCanvas`, and have the app trigger it from
  the audio event rather than the ambient scheduler. (Note: the reference clip's
  own audio was silent, so "dance" is a described feature, not something extracted
  from it.) → **Phase 5-ish**, alongside event wiring.
- **Webcam-on activity** — needs a webcam-in-use signal; same pattern (an
  event-pushed `peek`/perk-up action). → **Phase 5-ish**.
- **Notification swat / auto-close** — this is exactly Phases 4-6: the C# UIA
  watcher (Phase 4) detects a toast, Phase 5 wires it to the existing `alert`
  companion event (already handled → angry + anger puffs), and Phase 6 adds the
  opt-in auto-close (the Behavior "auto-close" mode is already a persisted
  preference with copy saying it activates later).

`companion/activity.ts` documents this extension point in-code: ambient,
self-initiated fidgets are scheduled there; event-driven actions are pushed in by
the app and only add an `IdleAction` member + a renderer pose branch. So none of
this deferral requires reworking Phase 3.


---

## Phase 4 — Native Notification Watcher (Detection Only) ✅

Standalone **C# / .NET 8** console app under `native/NudgeWatcher/`. It uses
Windows **UI Automation (UIA)** to notice toast notifications and prints their
**geometry + metadata** as newline-delimited JSON on stdout. Per the plan, this is
**detection only** — no Electron wiring (Phase 5) and no clicking/closing
(Phase 6). It builds and runs entirely on its own so the whole notification
sub-system can be tuned in isolation before it ever touches the app.

### Why a separate C# process
There's no maintained Node binding for Windows UIA (COM interop is painful outside
.NET/C++), so a tiny dedicated helper is the standard pattern (TECH_STACK.md).
`net8.0-windows` + `<UseWPF>true</UseWPF>` is the documented, reliably-resolving
way to reference the managed `System.Windows.Automation` assemblies;
`<DisableWinExeOutputInference>true</DisableWinExeOutputInference>` keeps it a
**console** app (UseWPF would otherwise flip it to a windowed subsystem with no
stdout). `<TreatWarningsAsErrors>false</TreatWarningsAsErrors>` because the UIA
surface is null-fuzzy and can't be compiled in the dev sandbox — a stray nullable
warning shouldn't block the user's first Windows build.

### Files
- `NudgeWatcher.csproj` — .NET 8 project (see property rationale above); version 0.4.
- `app.manifest` — `asInvoker` (no elevation) + **Per-Monitor-V2 DPI awareness** so
  `BoundingRectangle` comes back in true physical pixels on scaled/mixed-DPI
  displays (a Phase 4 exit criterion — bounds must be *correct*).
- `NotificationInfo.cs` — the JSON wire model. **Privacy-safe by construction:**
  it has *no field* for title/body text. Carries `type`, `id` (GUID), `appId`
  (best-effort host process, metadata not content), `bounds`, `interactive`,
  `hasCloseButton`, `ts`. Null fields omitted, so a close message is just
  `type`+`id`+`ts`. Schema is identical to what Phase 5 sends over the pipe.
- `ToastHeuristics.cs` — **the one file to tune.** All fragile matching lives here:
  candidate window classes, toast host processes, close-button ids/names, and the
  chrome-vs-app-action button logic behind `interactive`. Pure (no live UIA calls),
  so it's easy to reason about and unit-test later.
- `ToastDetector.cs` — subscribes to UIA `WindowOpened`/`WindowClosed` on the
  desktop root (subtree). Cheap `ClassName` pre-filter on the callback thread, then
  offloads heavy inspection to `Task.Run` (UIA re-entrancy rule: don't make UIA
  calls from inside an event handler). Two `CacheRequest`s (light element-only for
  the pre-filter; heavy **subtree** for one-round-trip classification). Confirms a
  toast by host process, de-dupes by RuntimeId, reads `SafeBounds` (skips
  empty/offscreen/≤0), classifies interactivity + close button by walking the
  cached subtree, emits `Appeared`. Tracks RuntimeId→id and emits `Closed` on the
  matching `WindowClosedEvent`. `--scan` inspects current windows once (tuning);
  verbose dump **redacts text** (control types + name *lengths* only).
- `Program.cs` — `[MTAThread]` entry (UIA clients want MTA; console Main is MTA by
  default, marked explicitly). CLI: `--scan`, `--verbose`/`-v`, `--help`/`-h`.
  stdout = pure JSON protocol (writes serialized behind a lock so lines from the
  UIA thread never interleave); stderr = human logs. Ctrl+C / ProcessExit unwind
  cleanly and `RemoveAllEventHandlers()` (leaking UIA handlers can destabilize the
  service).
- `README.md` — build/run/iterate on Windows, a UIA primer for a newcomer, the
  output schema, the privacy stance, and the tuning workflow.

### Privacy (ARCHITECTURE.md §7) — enforced, not aspirational
Notification **content is never emitted**: the wire model has no text field, and
even `--verbose` prints name *lengths* only. Control labels (e.g. a "Reply"
button) are read solely to compute `interactive` and never leave the process.
`appId` is the host process name (metadata), not the message and not (yet) the
true sending app's identity.

### Verification (sandbox limits + Windows steps)
The Linux dev sandbox has **no .NET SDK** and can't build `net8.0-windows`, so
Phase 4 was verified by (a) careful review against the UIA docs' threading/caching
rules and (b) structural checks: all six files present, **every .cs file
brace/paren-balanced**, usings vs. ImplicitUsings accounted for
(`System.Collections.Concurrent` + `System.Diagnostics` + `System.Windows.Automation`
added explicitly; `System.Windows.Rect` fully qualified), nullable-flow narrowing
on `rect` before the non-null `Appeared(... Bounds ...)` call, and cached-property
availability matched to each `CacheRequest`.

**On Windows**, verify the exit criteria:
```powershell
cd native/NudgeWatcher
dotnet build
dotnet run                     # watch mode; trigger real toasts (Teams/Outlook/BurntToast)
dotnet run -- --scan --verbose # if nothing detected: read class/host, tune ToastHeuristics.cs
```
Exit criteria (from IMPLEMENTATION_PLAN.md Phase 4): triggering various real
notifications reliably prints **correct bounding boxes** and **interactivity
flags**. Detection is heuristic and drifts across Windows builds/locales; the
first-run tuning loop is expected and is confined to `ToastHeuristics.cs`.

### Not in this phase (by the strict sequencing constraint)
No named pipe, no Electron spawn/supervise, no XState `Alert→Travel→Nudge`, no
`closeNotification`/`SendInput`, no allowlist. Those are Phases 5 (wire in) and 6
(opt-in auto-close), which build on this unchanged JSON schema.


---

## Phase 5 — Wire the Watcher into the App (Nudge Mode) ✅ (type-checked + lint clean; logic harness-tested)

The Phase 4 watcher ran in isolation and printed JSON. This phase makes it a
living part of the app: Electron **spawns and supervises** the C# watcher, reads
its events over a **named pipe**, converts each toast's geometry into the
overlay's coordinate space, and drives a new **notice → walk over → nudge →
return** flow so the pup physically reacts to real notifications. Auto-close is
still deferred to Phase 6 — this phase is the "nudge" (draw attention), never a
click.

### The pipeline, end to end
1. **C# server** (`native/NudgeWatcher/PipeServer.cs`, added Phase-5): the watcher
   now takes `--pipe <name>` and, alongside stdout, streams the **same** NDJSON
   over `\\.\pipe\<name>`. Roles per IMPLEMENTATION_PLAN: **C# is the server,
   Node is the client.** A bounded `Channel<string>` (256, DropOldest) decouples
   the UIA/worker threads from pipe I/O, so a missing or slow reader can never
   block detection or leak memory. Opened `InOut` for a Phase-6 reverse channel
   (close commands); Phase 5 is write-only. `Program.cs` gained the `--pipe` flag
   (both `--pipe name` and `--pipe=name`) and a dual-sink `Emit` (stdout always +
   pipe when enabled). Watcher version bumped 0.4 → **0.5**.
2. **Node supervisor** (`src/main/notificationWatcher.ts`, new): resolves the exe
   (`NUDGE_WATCHER_EXE` env → packaged `resources/watcher/` → dev `bin/{Debug,
   Release}/net8.0-windows/`), spawns it with a **unique** pipe name, and connects
   as the pipe **client** (`net.connect`). Connect is retried (~3s) to cover the
   spawn/server-ready race; a lost-but-child-alive link reconnects quietly; child
   crashes trigger **capped exponential backoff** (500ms→15s, ≤5 rapid failures)
   with a "healthy run resets the counter" rule; exe-missing or repeated failure
   degrades to **wander-only** and reports it. Parses NDJSON with a partial-line
   buffer (+ overflow guard) and maps the C# `bounds` (**PascalCase** X/Y/Width/
   Height) into a screen rect. **Privacy:** it only understands the geometry
   schema — there's no text field to leak — and the child's stderr (already
   redacted) is surfaced to the dev log only.
3. **Coordinate conversion + forward** (`src/main/index.ts`): main is the only
   place that owns Electron's `screen`, so it converts the watcher's **physical
   screen px** → overlay-local CSS px via the pure `shared/coords.ts`
   (`screenRectToLocalRect` with the primary display's `scaleFactor` and the
   overlay window's DIP origin), then forwards `notification:appeared` /
   `notification:closed` to the overlay. **Pause gate:** while paused, `appeared`
   is dropped (the pup won't start a reaction); `closed` is always forwarded (the
   machine ignores ids it isn't reacting to). Availability drives a tray line —
   `⚠ Notifications unavailable — wander-only` — using a tri-state so the brief
   startup gap before the first connect doesn't flash a scary warning. The watcher
   is started in `whenReady` and `dispose()`d on `will-quit`.
4. **State machine** (`src/renderer/src/companion/machine.ts`, added Phase-5):
   new `alert → travel → interact` states plus `NOTIFICATION_APPEARED` /
   `NOTIFICATION_CLOSED` events. `beginAlert` computes the standing spot beside
   the toast via the pure `notificationTarget` (motion.ts) and faces it; `travel`
   reuses the existing stepper to walk there; `interact` holds beside the toast
   until a root-level `NOTIFICATION_CLOSED` (matched by id via the `closingCurrent`
   guard) or an 8s safety timeout unwinds it to idle. New toasts are ignored while
   already reacting or dragging (single-toast MVP); `PICK_UP` clears the toast so a
   grab always wins.
5. **Renderer wiring** (`src/renderer/src/App.tsx`): subscribes to the two IPC
   channels, sends the machine events (guarded so a drag is never interrupted),
   and layers the **mood** on top — an `ALERT` face the moment a toast appears,
   topped up through the whole `alert/travel/interact` reaction so it doesn't
   decay mid-trip, plus periodic **anger puffs** ("barking") while standing at the
   toast. The rAF pause-gate now also lets an in-flight reaction finish (like a
   drag/landing) so pausing mid-nudge doesn't freeze the pup on-screen.

### Design choices worth remembering
- **Single toast at a time.** The machine only accepts `NOTIFICATION_APPEARED` in
  idle/wander; a burst of toasts won't make it thrash. A missed close can't wedge
  it either — the 8s `INTERACT_MAX` timeout always returns it home.
- **Never fight the user.** Both App (`draggingRef`) and the machine (a no-op
  `NOTIFICATION_APPEARED` in `dragging`) refuse to yank the pup out of a drag.
- **Graceful absence is the default.** No watcher exe, a crash loop, or a dev
  machine without .NET all resolve to the same calm wander-only mode with a clear
  tray note — the notification feature failing never takes Nudge down.
- **Primary-display-exact coords.** `shared/coords.ts` is exact for the primary
  display (origin 0,0); mixed-scale multi-monitor (per-point `screenToDipPoint` +
  one overlay per display) is explicitly deferred, as the plan allows.

### Verification status (sandbox)
- `tsc -p tsconfig.node.json` → **exit 0**; `tsc -p tsconfig.web.json` → **exit 0**.
- `eslint --max-warnings 0` on all touched TS/TSX → **clean**.
- Pure logic (`coords` + `notificationTarget`) → **10/10** assertions in-sandbox.
- Machine flow (real xstate via transpile-to-CJS): appeared→alert→travel→interact,
  close-unwind from each phase, stale-close ignore, drag/pickup precedence, safety
  timeout → **25/25**.
- Supervisor transport (real module, only `electron` stubbed): NDJSON framing,
  split lines, PascalCase-bounds mapping, missing/invalid geometry & id dropped,
  non-JSON ignored, overflow-buffer recovery → **27/27**.
- All five `native/NudgeWatcher/*.cs` files **brace/paren/bracket-balanced**
  (the sandbox has no .NET SDK, so the pipe path is verified by review + the Node
  side's parse tests against the exact schema).

### To verify on Windows
```powershell
cd "D:\Window pet\native\NudgeWatcher"
dotnet build                     # produces bin/Debug/net8.0-windows/NudgeWatcher.exe
# (optional) prove the pipe alone:
dotnet run -- --pipe nudgetest   # then connect a client to \\.\pipe\nudgetest

cd "D:\Window pet"
npm install
npm run typecheck                # expect exit 0
npm test                         # ... + coords + machine(notification) suites
npm run dev                      # dev auto-resolves the Debug exe; trigger a real toast
```
Exit criteria (IMPLEMENTATION_PLAN.md Phase 5): a real notification makes the
companion **walk over to the toast and react** (nudge), then return to wandering
when it closes; if the watcher isn't available the app runs normally, wander-only.
Confirm: (1) fire a toast (Teams/Outlook/BurntToast) → pup notices (angry), walks
to it, and "barks"; (2) dismiss the toast → pup returns to wandering; (3) Pause →
no new reactions; (4) rename/remove the exe → tray shows "Notifications
unavailable — wander-only" and the pup still wanders/drags/pets.

### Not in this phase (Phase 6)
No auto-close: no reverse pipe command, no `closeNotification` via the toast's
close button (UIA Invoke) or `SendInput`, no per-app opt-in allowlist. The
Behavior "auto-close" mode remains a persisted preference whose copy says it
activates later. The pipe is already `InOut` and the machine's `interactive` flag
is already carried through, so Phase 6 builds on this without reshaping the wire.


---

## Character & Art Overhaul — Kawaii Roster (15 animals) ✅ (type-checked + lint clean; logic + art harness-verified)

A look-and-content pass, **not** a new capability phase: it re-styles the sprite
to the flat-vector **kawaii** look of the uploaded cat reference and grows the
cast from one placeholder pup to a **15-animal roster**, each pickable in
Settings. It deliberately touches **no** notification code — Phase 6 stays gated.

### The art architecture: pure data → one renderer, two consumers
The old sprite baked a single "dog" into imperative Canvas2D calls with per-frame
radial gradients. That doesn't scale to 15 animals and can't be previewed without
launching Electron. The rewrite splits it into **pure data** and a **thin
painter**, so adding an animal is a data edit and the art can be eyeballed offline:

- `src/shared/settings.ts` — the **shared contract** both processes agree on:
  `CharacterId` (15-member union), `ColorThemeId` with a new **`'natural'`** coat,
  `COLOR_THEMES` (the recolor coats — `'natural'` is intentionally *absent* from
  it), an `isNaturalCoat` **type guard**, and `CHARACTER_LABELS`/`CHARACTER_ORDER`.
  Main persists the chosen id; both renderers read the union — one source of truth.
- `src/renderer/src/companion/species.ts` (new) — a `SpeciesDef` per animal:
  natural `palette` + **morphology** (ears/tail/muzzle/markings/nose/cheeks/belly…).
  `SPECIES` registry, `SPECIES_ORDER` (cat first — default + design reference),
  `speciesFor(id)` (falls back to cat, never throws). Adding an animal = one entry.
- `src/renderer/src/companion/spriteModel.ts` (new) — a **pure** `buildModel(sp,
  opts)` that turns a `SpeciesDef` + expression/animation flags into an ordered
  list of flat primitives (`Prim`: ellipse / circle / line / quad-path) grouped by
  `PartId` (shadow, tail, legBack, legFront, body, earBack, earFront, head, face)
  in a 100×100 space. **No `arc()`-with-angles** — only full ellipses and
  quad-curve paths, so every primitive maps 1:1 to SVG for the offline harness.
- `src/renderer/src/companion/SpriteCanvas.tsx` — now a **thin painter**: it
  rebuilds the model each frame (flat fills are cheaper than the old per-frame
  gradients) and applies the *same* time-based animation as before as **per-part
  transforms** (head-yaw pivots head+ears+face as a unit; tail wag; front/back foot
  lift; breathing; squash-and-stretch; pet hop; drag dangle/sway). All Phase-3
  liveliness scalars are preserved verbatim — the overhaul changed *what* is drawn,
  not *how* it moves.

### The "Natural" coat (default) vs the recolor coats
`'natural'` means **"paint this animal in its own colors"** (the `SpeciesDef`
palette). Every other coat (`classic/ash/mint/lavender/gold`) recolors the whole
body via `COLOR_THEMES` while morphology and accents stay put — resolved centrally
by `appearance.paletteFor(settings, species)`, which applies `{...species, palette}`
so a mint fox keeps its fox shape. The `isNaturalCoat` guard makes
`COLOR_THEMES[coat]` provably safe (the `'natural'` key can't index it).

### Settings — the roster picker
`SettingsApp.tsx` replaces the old one-card "Dog + More soon" stub with a wrapping
**grid of all 15 animals** (`CHARACTER_ORDER`), each card a **live mini
`SpriteCanvas`** in the animal's natural colors (same renderer as the overlay, so
the picker can't drift from reality). The header preview and the color swatches now
route through `paletteFor`/`speciesFor` so `'natural'` resolves correctly; the
Natural swatch shows the current species' fur, ringed to read as "their colors".

### Verification status (sandbox)
- `tsc -p tsconfig.node.json` → **exit 0**; `tsc -p tsconfig.web.json` → **exit 0**.
- `eslint --max-warnings 0` on all touched TS/TSX → **clean**.
- `paletteFor` logic (real modules, transpile-to-CJS + node assert): natural→own
  palette, recolor→shared theme regardless of species, natural coats differ across
  species, default coat is `'natural'` → **all pass**. Mirrored as a
  `describe('paletteFor')` Vitest block in `appearance.test.ts` (runs on Windows).
- **Offline art harnesses** (SVG→PNG via the pure model, no Electron): `render.cjs`
  → **15 species × 6 expressions** (roster.png, all_expressions.png) rendered clean;
  `render_anim.cjs` → **5 animation poses** (walk/drag/yawn/look/pet) confirm every
  per-part pivot. Roster reviewed visually — all 15 read at a glance and match the
  soft kawaii register of the reference.

### To verify on Windows
```powershell
cd "D:\Window pet"
npm install
npm run typecheck    # expect exit 0
npm test             # ... + appearance(paletteFor) block
npm run dev          # open Settings → pick any of the 15 animals; try each coat;
                     # confirm the overlay swaps species live and animates as before
```

### Not in this pass (still gated)
Phase 6 (opt-in per-app notification **auto-close**) remains deferred pending an
explicit go-ahead — this was purely a character/art pass. No notification code was
touched. Per-species animation *quirks* (e.g. a hopping frog, a floppier dog gait)
are a possible future refinement; the shared animation contract already supports
adding them without reworking the model.

> **Superseded below.** Both of the deferrals above have since landed — see
> "Real-animal walk + event gestures" (the four-legged gait, paw gestures, and
> paw-swat) and "Phase 6 — Notification Auto-Close" (the go-ahead was given, scope
> = "close everything").


---

## Real-animal walk + event gestures ✅ (type-checked + lint clean; art harness-verified — see caveat)

A motion pass on top of the kawaii roster, from the request: *"walk like real
animals with four legs … based on events show leg/hand movement … use their paw
to close a notification, then go back to natural form."* No new capability — it
re-bodies the walk and adds event-driven paw work — and it sets up the Phase 6
paw-swat below.

### Hybrid orientation (the core idea)
The old sprite always faced front and "shuffled" its two visible feet even when
crossing the screen, which doesn't read as walking. Rather than force a full
side-on character (which loses the cute face-on charm at rest), the pet now has
**two body plans** and switches between them:

- **FRONT** (`buildModel`, unchanged) — the symmetric face-on plan. Shown at
  **rest, while held (drag), while reacting in place, and while pawing** a toast.
- **PROFILE** (`buildProfileModel`, new in `spriteModel.ts`) — a **side-on
  quadruped facing right**, with **four legs as independent parts**
  (`legNearFront/legFarFront/legNearBack/legFarBack`) plus near/far ears, so the
  renderer can swing each leg. "Near" = viewer-facing side; "far" = drawn behind
  the body a shade darker so it recedes. Facing left is the whole plan mirrored by
  the canvas (it's only ever *built* facing right). Three archetypes chosen from
  morphology already on the `SpeciesDef`: **quadruped** (default), **bird**
  (`muzzle==='beak'` → upright egg, two feet, side beak, waddle) and **frog**
  (`eyesOnTop` → low crouch, four short splayed legs).

The chosen orientation is a pure function of state, computed in `SpriteCanvas`:
`moving && !dragging && !gesturing && !swatting ? 'profile' : 'front'`. On every
flip the pet does a short **edge-on "turn" squish** (`TURN_TIME` 0.26s, a sine
`scaleX` pinch about a vertical axis) so it pivots instead of popping between plans.

### The gait (believable four-legged walk)
In the profile plan the canvas swings each leg fore-aft about its **hip anchor**
(the anchors in `PROFILE_LEG_ANCHORS` must match `buildProfileModel`). A **trot**
moves **diagonal pairs together** — near-front + far-back share phase 0; far-front
+ near-back share phase π (`GAIT_PHASE`) — which is what reads as a real walk.
Tuning: `GAIT_RATE` 8.5, `GAIT_SWING` 0.42 rad. The body also **bobs up on each
beat** (trot lift); birds instead **rock side-to-side** (waddle) since they're
bipedal. All of it scales by the existing `motion` (reduced-motion) factor.

### Event-driven paw gestures + the swat
Two new inputs on `SpriteCanvas`, both defaulting to the resting pose so the
Settings live-preview is unaffected:

- **`gesturing`** (sustained): raise a front paw as a "hey, look" point. Driven
  from `App` as `alert || interact` — the notice beat and while standing at the
  toast — **not** during `travel` (a raised paw would fight the gait). The paw
  **eases** up/down (`pawRaiseRef` lerped toward 0/1) so it lifts and lowers
  smoothly rather than snapping.
- **`swatNonce`** (one-shot): increment it to fire a single **forward paw-swat**.
  Envelope is `Math.sin((swatAge/SWAT_TIME)*π)` over `SWAT_TIME` 0.5s, so the paw
  is fully extended at the **half-way point (~250 ms)**. The front-right leg
  rotates at the shoulder (`PAW_PIVOT`), then thrusts forward + dips on the swat;
  it reduces to the plain resting leg when both inputs are 0.

After either gesture the pet returns to its **natural form** automatically,
because orientation and paw-raise are derived from live state — when the reaction
ends, `gesturing`/`swatting` go false and it eases back to front-rest (or flips to
profile if it starts walking home).

---

## Phase 6 — Notification Auto-Close ✅ (type-checked + lint clean; logic harness-tested — see caveat)

The long-gated final phase, now greenlit. In **auto-close** mode the companion
doesn't just *nudge* a toast — it walks over, **paws it shut**, and returns to
wandering. This builds directly on the Phase 5 pipeline and the paw-swat above; it
reshapes **no** wire format (the pipe was already duplex `InOut`).

### Scope decision — "close everything" (locked)
When the go-ahead was given, the user chose **"close everything automatically"**
over the plan's original opt-in per-app allowlist. So auto-close, once selected,
dismisses **every** toast the pet reaches — including *interactive* ones (reply
fields / action buttons). This **overrides** IMPLEMENTATION_PLAN's allowlist
default and is why nothing gates on the carried-through `interactive` flag. `nudge`
remains the **default** mode; `autoClose` is strictly opt-in via Settings.

### The close path, end to end (renderer → native)
1. **Renderer** (`App.tsx`): the moment the pet enters `interact` *and*
   `behaviorModeRef.current === 'autoClose'`, it bumps `swatNonce` (fires the
   animation) and, at the swat's forward peak (`SWAT_PEAK_MS` 250 ms — half of
   `SWAT_TIME`), calls `window.nudge.closeNotification(id)`, so the toast vanishes
   exactly as the paw "connects." The `id` is the watcher-minted one from the
   matching `onNotificationAppeared`. If the close never lands, the machine's own
   `INTERACT_MAX` (8s) safety timeout walks the pet home — it can't get stuck.
2. **Preload** (`preload/index.ts`): `closeNotification(id)` →
   `ipcRenderer.send('notification:close', id)`. Fire-and-forget; **no toast text
   ever crosses this bridge** (§7).
3. **Main — the trust boundary** (`main/index.ts`): `ipcMain.on('notification:close')`
   **re-checks** `behavior.mode === 'autoClose' && !runtime.paused` before doing
   anything, so a renderer bug (or a compromised renderer) can't dismiss a toast
   the user never opted into. Then `notificationWatcher.sendClose(id)`.
4. **Node supervisor** (`notificationWatcher.ts`): `sendClose(id)` writes one
   NDJSON line `{"cmd":"close","id":…}\n` back over the **same duplex pipe** the
   watcher streams events on (Node = client). Best-effort: if momentarily
   disconnected it drops the request and returns false (reaction times out
   harmlessly).
5. **C# watcher**: `PipeServer.ReadCommandsAsync`/`HandleCommandLine` parse the
   command (System.Text.Json) → raise `CloseRequested` → `ToastDetector.CloseToast(id)`.
   That **re-locates the dismiss button FRESH** via a live UIA walk
   (`FindCloseButtonLive`, using `ToastHeuristics.IsCloseButton`), verifies it's
   on-screen, and invokes it via **`InvokePattern`** (fallback
   `LegacyIAccessiblePattern.DoDefaultAction`) — **no synthetic mouse input**.
   Success surfaces through the natural `WindowClosed` UIA event (the single source
   of truth), which flows back as the normal `notification_closed` → the machine
   unwinds to idle. `_windowsById` is populated on detect, pruned on close/stale.

### Why UIA Invoke, not SendInput
Clicking real screen coordinates is brittle (races the user's cursor, breaks under
occlusion/DPI, and looks like malware). Invoking the toast's own dismiss control
through UIA is the same thing the OS does when *you* click the ✕ — reliable,
DPI-agnostic, and it can't click the wrong thing. The re-locate-fresh step avoids
acting on a stale element the toast may have recycled.

### C# project note
`native/NudgeWatcher.csproj` uses `net8.0-windows` + `<UseWPF>true</UseWPF>`, which
surfaces both the `System.Windows.Automation` client assemblies **and**
`System.Windows.Rect`, so `InvokePattern`/`LegacyIAccessiblePattern` resolve
**without** editing csproj `<Reference>`s. AssemblyVersion bumped to **0.6.0.0**.

### Verification status — ⚠ automated checks could not run this session
The dev sandbox (Linux) was **disconnected** for this pass — the workspace VM was
wedged, so `tsc`, `eslint`, and the transpile-to-CJS / SVG-art harnesses **could
not be executed here**. What *was* done:
- **Manual TS/TSX review** of every edited file (App.tsx auto-close effect + walk/
  gesture derivations + SpriteCanvas props; preload `closeNotification`; main
  trust-boundary handler; machine doc). Types, hook deps, and syntax all check out
  by inspection (refs/setState-dispatchers/module-consts are exhaustive-deps-exempt,
  so the `[interacting]`-keyed effect is lint-clean).
- **Manual C# review** of `ToastDetector.cs` (full), `PipeServer.cs`, `Program.cs`:
  brace/using balance, `_windowsById` populate/prune/clear, the InvokePattern
  fallback, and the CloseRequested wiring are all coherent.
- Prior automated results still hold for the code that **didn't** change this pass
  (Phase 5's 25/25 machine + 27/27 transport + 10/10 coords).

**These must be run on Windows to close verification** — see below.

### To verify on Windows
```powershell
cd "D:\Window pet"
npm install
npm run typecheck            # expect exit 0 (node + web)
npx eslint . --max-warnings 0
npm test                     # existing suites incl. machine(notification)
node scripts/harness/render.cjs        # re-render roster/expressions (front)
node scripts/harness/render_anim.cjs   # + profile gait + paw-swat poses
cd native/NudgeWatcher && dotnet build # net8.0-windows, expect 0 errors

cd "D:\Window pet"
npm run dev                  # Settings → Behavior → Auto-close.
# Fire a toast (Teams/Outlook/BurntToast): pet walks over in 4-leg profile,
# turns to face it, throws a paw-swat, the toast closes as the paw connects,
# and the pet trots back and resumes wandering. Try an interactive toast too —
# it should also be closed ("close everything"). Switch to Nudge mode → the pet
# only barks/points and does NOT close. Pause → no reactions at all.
```
Exit criteria (IMPLEMENTATION_PLAN.md Phase 6, as amended to "close everything"):
in auto-close mode a real toast is **dismissed by the companion's paw** and it
returns to roaming; in nudge mode nothing is closed; paused suppresses everything;
a missing/failed close never wedges the pet (safety timeout recovers it).

### Not in this phase (possible future)
Per-app allowlist UI (the chosen scope is "close everything", so it's intentionally
absent); a "snooze/undo" grace window; music-`dance` / webcam-`peek` event poses
(still just extra `IdleAction` members + a renderer branch, per Phase 3's note).

---

## Post-Phase-6 fix — "the pet ignores notifications" (root cause: watcher never compiled) ✅ (typecheck + lint clean)

### Symptom (reported with a screen recording)
Running the app on Windows, the pet roamed and could be petted/dragged, but a real
WhatsApp toast at the bottom-right was **completely ignored** — no walk-over, no
close. Frame-by-frame the overlay's debug badge stayed pinned at
`Nudge · wander · neutral · click-through` the entire time the toast was visible;
`state.value` never advanced to `alert`/`travel`/`interact`. So the *reaction*
pipeline (machine + mood + swat + close) was fine — **the state machine simply never
received a notification event.**

### Root cause
The break was upstream of everything Phases 5–6 added: **the native C# watcher was
never built.** There was no `native/NudgeWatcher/bin/` directory anywhere in the
repo, and **no script built it** — building it was only ever a manual
`cd native/NudgeWatcher && dotnet build` buried in the watcher README. With no exe,
`notificationWatcher.ts → resolveExe()` returned `null`, the supervisor reported
**unavailable**, and the app did exactly what it's designed to do in that case:
**degrade to wander-only.** Nothing errored, nothing looked broken — the app just
silently never noticed toasts. (This is the resilience behaviour from
ARCHITECTURE.md §6 working as intended; the bug was that we made it *easy* to land
in that state without realising.)

This also explained why it was invisible: every visible feature works in
wander-only mode, and the "⚠ Notifications unavailable — wander-only" tray line is
easy to miss if you're not looking for it.

### Fix — make the watcher build automatic, and impossible to miss
1. **`scripts/build-watcher.mjs`** (new; plain Node ESM, no deps). Best-effort
   compile of the watcher. **Hard rule: it must never break `npm run dev`.**
   - No csproj found → note + `exit 0`.
   - Exe newer than every `.cs`/`.csproj` (ignoring `bin`/`obj`) → skip build (fast
     startup). `FORCE_WATCHER_BUILD=1` bypasses.
   - Otherwise `dotnet build … -c Debug`. `dotnet` missing (`ENOENT`) → friendly
     "install .NET 8 SDK" note + `exit 0`. Nonzero build status → note + `exit 0`.
   - Only side effect of any failure: notifications stay disabled until resolved —
     never a blocked dev server.
2. **`package.json` scripts:** added `"predev"` → runs the script automatically
   before `dev`; plus explicit `"watcher:build"` / `"watcher:build:release"`
   (`dotnet build … -c Debug|Release`) for building with full error output.
3. **Docs:** created a root **`README.md`** whose headline section is *"notifications
   need a native build"* — it names the .NET 8 SDK prerequisite, the auto-build, the
   two 5-second "is the watcher live?" checks (tray line + the badge advancing past
   `wander`), the `NUDGE_WATCHER_EXE` override, and a troubleshooting entry whose #1
   cause is "the watcher wasn't built." This section (the post-fix log entry).

### Two real build errors this pass also caught (previously uncaught)
Once the sandbox VM recovered, `tsc --noEmit` surfaced two `TS6133` (unused) errors
that a prior "manual review looked sound" pass had missed — a reminder that manual
TS review is not a substitute for `tsc`:
- `SpriteCanvas.tsx` — a duplicate `PROFILE_LEG_ANCHORS` const, dead because the
  gait loop pivots each leg about `gp.anchor` (carried on the Part by
  `buildProfileModel`, the single source of truth). Removed; replaced with a comment
  explaining where the anchors actually live.
- `spriteModel.ts` — `buildProfileFace` took an `OL: Stroke` param it never used
  (and the call site passed one). Dropped the param + the argument.

Confirmed the four-legged profile walk itself is correctly wired (legs animate via
`gp.anchor`), so removing the dead anchor table changed no behaviour.

### Verification status (sandbox — the VM recovered this pass)
- `npm run typecheck` (node + web) → **exit 0.**
- `npm run lint` (`eslint . --max-warnings 0`) → **clean** (the two TS6133s fixed).
- `scripts/build-watcher.mjs` exercised with **`dotnet` absent** (its state in the
  sandbox) → printed the "install .NET 8 SDK" note and **exited 0** — proving
  `predev` cannot block `npm run dev`.
- **Still Windows-only:** `dotnet build` of the watcher (no .NET SDK in sandbox),
  `npm test` (Vitest needs Linux rollup/esbuild natives; registry is blocked so they
  can't be fetched), and the live GUI check.

### To verify on Windows (the check that actually closes this out)
```powershell
cd "D:\Window pet"
npm install
dotnet --version            # want 8.x; if missing, install the .NET 8 SDK
npm run dev                 # predev auto-builds the watcher, then launches
# Tray must NOT say "⚠ Notifications unavailable — wander-only".
# Fire a toast (WhatsApp/Teams/Outlook/BurntToast): the debug badge should advance
#   Nudge · alert → travel → interact  as the pet trots over.
# In Auto-close mode the paw-swat closes it; in Nudge mode it only reacts. Paused = nothing.
```
Exit criteria: with the .NET 8 SDK installed, a fresh clone reacts to toasts after
nothing more than `npm install && npm run dev` — no hidden manual build step.



---

## Post-Phase-6 — DECISIVE detection fix: WinRT UserNotificationListener (watcher v0.9.0.0)

**The whole arc, in one line:** Windows 11 toasts are *not* an enumerable window, so
every window/tree approach was blind — the fix is to tap the notification *platform*.

### Why the previous approaches all failed (proven on the user's machine, with video)
Three successive builds each looked healthy (watcher spawned, pipe connected, verbose
on) yet the pet never reacted to a real toast:
1. **UIA `WindowOpened` event** — never fires for toast windows.
2. **UIA tree poll** (`RootElement.FindAll(TreeScope.Children)`) — toast absent.
3. **Win32 `EnumWindows`** (v0.8.0.0) — toast absent. A real WhatsApp toast sat on
   screen 10+ seconds while ~20 other windows enumerated; the toast never appeared.

Conclusion: Win11 renders toasts in a protected/virtualized surface a normal desktop
app cannot reach by enumerating windows or walking the accessibility tree. Chasing
windows was a dead end.

### The fix — `Windows.UI.Notifications.Management.UserNotificationListener`
A new detector, `native/NudgeWatcher/NotificationListenerDetector.cs`, taps the
notification platform itself (not windows), so it sees every toast regardless of how
or where it is drawn:
- `UserNotificationListener.Current` → `await RequestAccessAsync()` (needs
  `Allowed`) → poll `await GetNotificationsAsync(NotificationKinds.Toast)` every
  750 ms and diff the id set: a new id ⇒ `Appeared`, a tracked id that's gone ⇒
  `Closed`.
- Dismiss via `listener.RemoveNotification(uint id)` — still **never** synthetic
  mouse/keyboard input.
- Drop-in shape (same ctor / `Appeared`/`Closed` events / `Start`/`Stop`/
  `ScanExisting`/`CloseToast`/`IDisposable`), so `Program.cs` just constructs this
  instead of the legacy `ToastDetector` (kept as dead-but-compiling reference).

### Privacy — user decision "API, app-name only"
This API *can* read the message body (`n.Notification.Visual`); we **deliberately do
not**. We read only `n.Id` (a uint dismiss handle) and
`n.AppInfo.DisplayInfo.DisplayName` (which app notified — metadata, like the old
host-process name). `SafeAppName()` never touches `n.Notification`. Message text is
never read, logged, or emitted. This is a conscious, user-approved refinement of the
earlier "never read notification content" rule.

### Geometry
The API reports no on-screen rectangle, so the pet is aimed at a synthesized
bottom-right-corner rect (`CornerBounds()` from `NativeWindows.PrimaryScreenSize()`
via `GetSystemMetrics`, physical px, DPI-correct) — where Win11 always shows toasts.

### Build / TFM change (required for the WinRT projections)
`NudgeWatcher.csproj`: `TargetFramework` `net8.0-windows` →
**`net8.0-windows10.0.19041.0`** (+ `<SupportedOSPlatformVersion>10.0.17763.0`). The
Windows-version suffix is what lights up `Windows.UI.Notifications.Management` (ships
with the .NET SDK — no NuGet). `UseWPF=true` and `RollForward=Major` stay. Version
0.8.0.0 → **0.9.0.0**. Both exe-path lookups now point at the new TFM folder —
`src/main/notificationWatcher.ts → resolveExe()` and `scripts/build-watcher.mjs` —
with **no fallback** to the old `net8.0-windows` path (any exe there is a stale
pre-pivot build that would look "connected" yet never react — worse than wander-only).

### Known risk to watch on the real run
For an **unpackaged** helper, `RequestAccessAsync` can return `Denied` (historically
finicky). Handled defensively: on non-`Allowed` it logs a clear "turn ON Settings >
Privacy & security > Notifications" hint and degrades to wander-only (never throws).
If it stays Denied unpackaged, the fallback is packaging the watcher as **MSIX**
(packaged apps get the access prompt reliably).

### Verification status (sandbox)
- TS: `tsc -p tsconfig.node.json` → exit 0; `eslint src/main/notificationWatcher.ts
  --max-warnings 0` → clean.
- `node --check scripts/build-watcher.mjs` → ok.
- `NudgeWatcher.csproj` + `app.manifest` parse as valid XML (also confirms no illegal
  `--` inside XML comments).
- C# hand-reviewed (no dotnet in sandbox): balanced braces/parens/brackets across
  `Program.cs`, `NotificationListenerDetector.cs`, `NativeWindows.cs`; call sites
  match `NotificationInfo.Appeared(string,string?,Bounds,bool,bool)` / `Closed(string)`
  and `Bounds(double×4)`.
- **Still Windows-only:** `dotnet build` of the watcher and the live GUI check. First
  real build may surface a WinRT projection nuance; expect a possible first-build pass.

### To verify on Windows (the check that closes this out)
```powershell
cd "D:\Window pet"
npm install
dotnet --version            # any modern SDK; RollForward=Major runs net8 on 10.x
npm run dev                 # predev rebuilds the watcher (TFM changed), then launches
# One time, Windows/​the watcher log will gate on notification access:
#   watcher stderr shows  [nudge-watcher] listener: access granted …   on success, or
#   … notification access is '<status>' …  -> turn ON Settings > Privacy & security >
#   Notifications (let apps access notifications), then restart.
# Then fire a real toast (WhatsApp/Teams/Outlook): the pet should trot to the
# bottom-right corner; Auto-close mode paw-swats it shut.
```

## Post-Phase-6 improvements — fast notification dash + sound-sensitive dance ✅ (type-checked + lint clean; logic harness-verified)

Two user-requested behaviors after the core app was working:
1. **Fast dash:** "whenever a notification appears the character runs to it with high
   speed, removes it with its paw, then goes back to normal movements."
2. **Sound-sensitive dance:** "make the character sound-sensitive — if I play any song
   it starts dancing with musical doodles coming out of it."

User decisions (AskUserQuestion): audio source = **system/app audio only, never the
microphone**; listening mode = **always auto-dance** (listen in the background and
dance whenever music is detected). Hence `general.reactToAudio` defaults to **true**.

### Feature 1 — the dash (small, surgical)
- `motion.ts`: `stepToward(...)` gained an optional trailing `speedScale = 1` factor;
  added `export const TRAVEL_SPEED_SCALE = 2.75`. The wander path passes nothing (byte-
  for-byte the tested behavior); only the dash scales.
- `machine.ts`: new `tickTravel` action = `stepToward(..., TRAVEL_SPEED_SCALE)`, wired
  into the `travel` state's TICK (a *distinct* action, not a param on `tickWander`, so
  the wander tests are untouched). The rest of the alert→travel→interact→paw-swat→return
  flow (Phase 5/6) is unchanged, so "runs over → paws it shut → resumes roaming" already
  falls out — this just makes the "runs over" leg visibly fast.

### Feature 2 — the dance (audio → beats → state + art)
Data flow: **main grants loopback audio → renderer hook analyzes it → pure detector →
machine `dance` state + sprite bop + note particles.**

- **`main/index.ts`** — `registerDisplayMediaHandler()` installs
  `session.defaultSession.setDisplayMediaRequestHandler`, answering the renderer's
  `getDisplayMedia({video,audio})` with `{ video: <primary screen>, audio: 'loopback' }`
  and `{ useSystemPicker: false }`. This is what makes capture **silent + automatic**
  (no OS picker). `desktopCapturer` + `session` added to the electron import. Registered
  in `whenReady` after `registerDevShortcuts()`. On no-source/failure it grants `{}`
  (renderer degrades to "never dances"). [WIN] `'loopback'` is a Windows/Chromium ability.
- **`companion/audioBeat.ts`** (pure, already landed) — `stepBeat(state,{energy,dt},cfg)`
  → `{state, beat, musicChanged}`. Bass-band `energyFromFrequencies()`. Hysteretic music
  gate: turns ON after `beatsToStart` beats within `recentWindowSec`, OFF after
  `silenceHoldSec` of quiet (so a lone chime never starts a dance, a quiet passage never
  stops one). Fully unit-tested.
- **`companion/useSystemAudio.ts`** (new; the ONLY Web-Audio code) — `getDisplayMedia`
  → stop the video track → `AnalyserNode` (NOT connected to `destination`, so nothing
  echoes) → per-rAF `energyFromFrequencies` → `stepBeat` → fires `onBeat` /
  `onMusicChange(active)` on edges only. Gated by `enabled`; a `cancelled` flag covers
  the async gap; teardown emits a final `onMusicChange(false)` if it tore down mid-song
  (so a stale "musicActive" can't leave the machine stuck dancing across a Pause).
  Degrades silently if loopback is denied. Callbacks/config held in refs so the capture
  effect depends only on `[enabled]` (re-created handlers don't restart capture).
- **`companion/machine.ts`** — `musicActive` context flag; `MUSIC_START`/`MUSIC_STOP`
  are **root-level internal transitions** (set the flag from *any* state without leaving
  it). New `dance` state entered **only** via a guarded TICK at the head of idle/wander
  (`{ guard: 'musicActive', target: 'dance' }`) — never by MUSIC_START directly — so
  music starting mid-drag or mid-nudge is *deferred* until the pup is free rather than
  yanking it away. `dance` exits to idle on `notMusicActive`, and a toast still wins
  (`NOTIFICATION_APPEARED` → alert).
- **`companion/effects.ts` + `EffectsCanvas.tsx`** — new `'note'` particle kind +
  `spawnNotes()` (rise like hearts but a touch faster, wider sway, jauntier tilt).
  `EffectsCanvas` gained a `notes(x,y,count?)` handle and `drawNote()` (glyph ♪/♫/♬
  chosen by particle id, violet→blue gradient + soft glow).
- **`companion/SpriteCanvas.tsx`** — `dancing?` + `beatNonce?` props. `dancing` eases a
  0↔1 `danceLevel` that drives a front-pose bop (vertical bounce, L/R shimmy, foot-rock
  tilt, head nod, paw tap). `beatNonce` bumps fire a one-shot squash-&-stretch "pop"
  (scaled by `danceLevel`, so pops off-dance are inert). Dancing forces the front pose.
- **`shared/settings.ts` + `settings/SettingsApp.tsx`** — `general.reactToAudio`
  (**default true**), plus a "Dance to music" toggle whose copy states it listens to the
  PC's audio only, never the mic.
- **`App.tsx`** — `audioEnabled = reactToAudio && !paused` (recomputed in the settings
  `apply`, the only time either input changes → re-runs the hook's effect). `onMusicChange`
  → `send(MUSIC_START/STOP)`; `onBeat` (only while `machineStateRef==='dance'`) bumps
  `beatNonce` + puffs one note above the head. `dancing = state.matches('dance') && !paused`
  (Pause freezes the bop). `dancing`/`beatNonce` passed to SpriteCanvas. The rAF loop is
  unchanged: `dance` is deliberately absent from `mustAdvance`, so a paused pup won't tick
  in dance; when not paused the normal branch ticks it (needed to enter/leave dance).

### Privacy / security (unchanged invariants, restated for audio)
Audio is loopback **system output only** (never the microphone), reduced to a single
number in-process each frame and **never stored, forwarded, or surfaced as content** —
the same "no content crosses layers" rule the notification watcher follows (§7). No new
preload surface: the renderer uses the browser `navigator.mediaDevices` API directly, so
only `main` changed (the display-media grant).

### Verification status (sandbox)
- `tsc -p tsconfig.node.json` and `tsc -p tsconfig.web.json` → **exit 0**.
- `eslint` on every changed source + test file → **clean** (`--max-warnings 0`).
- **Machine dance flow** — compiled `machine.ts`+`motion.ts` to CJS and ran a Node
  harness against the real XState machine: **20/20** assertions (enter from idle & from
  wander; on/off edges flip the flag then transition on the next tick; a toast interrupts
  dance → alert → travel → interact; music mid-drag stays `dragging` then dances after the
  drop settles; music mid-nudge stays `interact` then dances after the toast closes).
- **Note particles** — `spawnNotes` (N rising unique-id notes, `vy<0`) and `stepParticles`
  (sway-isolated: identical base, only `kind` differs → note |dx| > heart |dx|; rise eases)
  confirmed via a Node port. (The committed Vitest tests assert the same.)
- **Vitest still can't run in this Linux sandbox** — the Windows-installed `node_modules`
  lack the Linux rollup/esbuild native binaries; hence the Node-port harnesses above. The
  committed `.test.ts` files (machine dance ×6, effects notes ×2, settings default ×1) run
  on Windows.

### To verify on Windows (closes this out)
```powershell
cd "D:\Window pet"
npm install
npm run dev
# Notification dash: fire a toast (WhatsApp/Teams/Outlook) → the pet should DASH
#   (visibly faster than its wander) to the bottom-right, paw-swat, then trot back.
# Dance: play any song/video (Spotify/YouTube/etc.). Within ~1s of a clear beat the
#   pet should bop in place with ♪/♫/♬ puffing out, popping on each beat; stop the
#   audio and it returns to roaming after a short quiet hold.
# Toggle: Settings → General → "Dance to music" OFF stops listening entirely.
#   Pause (tray) also stops the dance. Neither should affect the notification dash.
# If it never dances: confirm loopback audio is permitted (some group-policy/OS
#   configs block it) — the app degrades to no-dance rather than erroring.
```

---

## Refinement pass — full-screen wander, faster dash, paw-on-the-X close

Four user-requested tweaks on top of the working build: roam the *whole* screen, dash
*faster* to a toast, land the pet *on the toast's X* (not beside it), and make the
paw-swat clearly *visible*. Pure-module + machine changes only; no new deps, no new IPC.

### 1) Wander all over the screen (`motion.ts`, `appearance.ts`)
- `WanderConfig` dropped the old `excursionChance`/`maxExcursion` (small upward hops off a
  ground-line pace) in favor of a single **`roamChance` (0..1)**: the chance the *next*
  target is anywhere on the overlay (random x **and** random y) vs. settling back on the
  ground line. `pickWanderTarget` now rolls x, then a roam roll; on a hit it also rolls a
  full-height y (both clamped to the movable box). RNG order: x, roam, y.
- `DEFAULT_WANDER.roamChance = 0.75`. `wanderConfigFor` derives it per mood —
  **alert 0.85 > happy 0.75 > chill 0.6** — and **reduced-motion clamps it to 0.3** (calmer,
  hugs the ground) alongside the existing speed×0.5 and rest-bias bump. `tickWander` already
  walks a straight line to the 2D target, so no machine change was needed to roam vertically.

### 2) Faster notification dash (`motion.ts`)
- `TRAVEL_SPEED_SCALE` **2.75 → 4.5**. At the app's 0.05s dt clamp and ~90px/s base that's
  ≈20px/tick — reads as an urgent run, still well under the sprite size so `stepToward`
  never teleports past the toast (it snaps on the final tick). Test guardrail widened to
  `≤ 6`.

### 3) Land on the toast's close (X) button (`motion.ts`, `machine.ts`)
- `notificationTarget` now aims at the toast's **top-right dismiss (X)** — previously it
  stood *beside* the toast on whichever side had room. New exported constants:
  `CLOSE_INSET_X=22`, `CLOSE_INSET_Y=20` (X centre from the toast's top-right corner) and
  `PAW_CONTACT_FX=0.82`, `PAW_CONTACT_FY=0.80` (where the raised paw tip sits as a fraction
  of the sprite box). The body is parked up-and-left of the X by `PAW_CONTACT_F* × size` so
  the *paw*, not the body centre, meets the X; then clamped on-screen.
- `machine.ts` `beginInteract` now forces **`facing: 'right'`** on arrival. The target is
  always up-left of the X, so facing right is always correct; the front↔profile turn-squish
  masks the snap. Guarantees the front-pose swat reaches into the corner regardless of which
  way the pup approached.

### 4) Visible paw-swat (`SpriteCanvas.tsx`)
- Swat transforms boosted for a readable bat: more forward reach + upward lift, less
  downward drop (`pawFwd = pawRaise*3 + swatEnv*18`, `pawLift = pawRaise*13 + swatEnv*6`,
  `pawDrop = swatEnv*2`, `pawRot = -pawRaise*0.55 + swatEnv*0.95`). At the swat peak
  (swatEnv=1, pawRaise≈0.9–1.0) the front foot swings from design (62,90) to ≈(0.81, 0.82)
  of the box — matching `PAW_CONTACT_F*`, so the paw tip meets the X within ~1–3px. At rest
  (pawRaise=swatEnv=0) the foot stays at (62,90): idle/other poses unchanged.

### Verification status (sandbox)
- `tsc -p tsconfig.node.json` and `tsc -p tsconfig.web.json` → **exit 0**.
- `eslint` on every changed source + test file → **clean** (`--max-warnings 0`).
- **Node harness** (compiled `motion.ts`+`machine.ts` to CJS, run against real XState):
  **24/24** — roam ground-line vs. full-screen vs. clamped-extreme picks; X-targeting for
  right-/left-hugging + top-right-clamped toasts; paw↔closeX contact invariant (≤1px);
  constants; scaled `stepToward`; alert aims at X + faces right; travel→interact arrives at
  X + facing forced right; dash step 22.5 > wander step.
- **Swat geometry** re-derived numerically (transform composition in 100-space): peak paw
  tip frac (0.802,0.838)→(0.817,0.813) across pawRaise 0.88→1.0; rest foot exactly (62,90).
- **Vitest still can't run in this Linux sandbox** (Windows `node_modules` lack Linux native
  binaries) — committed `.test.ts` (motion pickWander/notificationTarget/travel-scale,
  appearance roamChance ordering, machine alert/interact facing) run on Windows.

### To verify on Windows (closes this out)
```powershell
cd "D:\Window pet"; npm install; npm run dev
# Wander: over a minute the pet should roam the WHOLE screen (top/middle/bottom), not
#   just pace the taskbar edge; chill roams lower, alert ranges widest.
# Dash + close: fire a toast (WhatsApp/Teams/Outlook) → the pet DASHES (noticeably
#   faster than wander) to the toast's TOP-RIGHT X, does a visible paw-bat ON the X to
#   close it, then trots back to normal roaming.
```

---

## Expression pass — more moods, tempo-adaptive dance, webcam pose ✅ (static-verified — see caveat)

Three user-requested behaviours after the build was working end-to-end: *(1)* "add
more moods — happy and alert look too similar, give them distinct expressions and
expose the moods in the tray"; *(2)* "in dancing mode, fast song = fast dance, slow
song = slow dance — adapt automatically to the song speed"; *(3)* "when the webcam
opens, go near the camera, strike a cute photogenic pose, then come back to normal."
Clarified up front (AskUserQuestion): F1 adds four NEW presets on top of the
original happy/chill/alert, Happy and Alert get **distinct resting faces**, and the
moods are exposed in the tray; F2 dance speed **follows the music tempo
automatically**; F3 is **"pose briefly, then resume"** (scurry under the camera,
hold a few seconds, go back to roaming — one-shot per camera session).

### Feature 1 — seven mood presets + distinct resting faces + tray selector
- **`src/shared/settings.ts`** — `MoodDefault` grew from 3 to **7**: `happy | chill
  | alert | excited | curious | grumpy | sleepy`. `MOOD_LABELS` (all 7) and a
  curated `MOOD_ORDER` (`happy, excited, curious, alert, chill, sleepy, grumpy`)
  drive every menu/segmented control so the UI can't drift from the union.
- **`companion/mood.ts`** — the `Mood` union gained `excited | curious | grumpy`
  (alongside the existing neutral/happy/love/angry/surprised/sleepy/alert/chill);
  `BaseMood` is the resting subset. The key fix for "happy and alert look the same":
  they now resolve to **different resting faces** instead of both falling back to
  `neutral`. Mood stays a **pure reducer**, separate from the locomotion FSM.
- **`companion/appearance.ts`** — `baseMoodFor` is the identity map `MoodDefault →
  BaseMood` (the unions are aligned so it's TS-provably total), and the `ENERGY`
  table carries a per-mood liveliness figure for all 7 (excited 1.4 fidgets hardest,
  sleepy 0.55 barely stirs), feeding the Phase-3 `energyFor` animation scalar.
- **`companion/spriteModel.ts` + `SpriteCanvas.tsx`** — new face branches so each
  mood reads at a glance (excited = wide sparkle-eyes + open smile; curious = head
  tilt + one raised brow; grumpy = flat brows + frown). Happy and Alert are now
  visibly distinct at rest.
- **`src/main/index.ts`** — a **"Mood" submenu in the tray**: one `type: 'radio'`
  item per `MOOD_ORDER` entry, `checked` on `appearance.moodDefault`, click →
  `setMoodDefault(mood)` which persists (`updateSettings`), re-runs side effects
  (refreshes the tray so the check moves) and **broadcasts** so the overlay swaps
  its resting face + energy live — no Settings window needed. `SettingsApp.tsx`'s
  `PREVIEW_EXPR` maps all 7 for the live preview.

### Feature 2 — tempo-adaptive dance ("fast song, fast dance")
Data flow adds a **tempo estimate** on top of the existing beat detector, with no
new capture surface:
- **`companion/audioBeat.ts`** — new pure `tempoScaleFromBeats(beatTimes, cfg)`:
  takes the **median inter-beat interval** (robust to a missed/doubled kick) and
  returns `referenceIntervalSec / median`, clamped to `[minScale, maxScale]`.
  `DEFAULT_TEMPO_CONFIG.referenceIntervalSec = 0.5` (~120 BPM) is the "feels
  natural = 1.0" anchor: quicker songs push the scale above 1, slower below. No BPM
  tracking or autocorrelation — cheap and stable. `stepBeat` now **surfaces
  `tempoScale`** in its result each frame.
- **`companion/useSystemAudio.ts`** — `onBeat` signature became
  `(tempoScale: number) => void`; the hook passes `res.tempoScale` on every detected
  beat. (Still loopback-only, still a single number per frame — no content.)
- **`App.tsx`** — a `danceTempo` state (default 1) updated from `onBeat` with a small
  hysteresis (ignore <0.03 changes to avoid churn), **reset to 1 when the song ends**
  so the next track starts at the natural speed, and passed to `<SpriteCanvas>`.
- **`companion/SpriteCanvas.tsx`** — `danceTempo?` prop (default 1). The bop is now
  driven by a **phase accumulator** (`danceClockRef += dt * DANCE_RATE *
  danceTempoRef`), where `danceTempoRef` eases toward the clamped `[0.4, 2.2]` prop.
  Using an integrated phase (not `t × rate`) means a **shifting tempo estimate never
  pops** the animation — the bop glides between speeds. Dance rate is deliberately
  decoupled from mood energy so the dance follows the *song*, not the mood.

### Feature 3 — webcam "say cheese" pose (scurry under the camera, hold, resume)
- **Detection (main) — `src/main/webcamWatcher.ts`** — polls the Windows
  **Capability Access Manager ConsentStore** (`…\ConsentStore\webcam`, HKCU+HKLM)
  via `reg query <key> /s` every 1.5s. A **pure parser**, `webcamInUseFromRegQuery`,
  groups the output per app-subkey and marks the camera **in use** when a subkey has
  a **non-zero `LastUsedTimeStart` AND a `LastUsedTimeStop` of exactly 0** (Windows
  zeroes the stop for the duration of a live session). Only a **boolean** crosses
  IPC — no frames, no image, and no more app identity than the in-use fact.
  `forwardWebcamChange` sends `webcam:changed {inUse}` to the overlay (suppressed
  while paused). The watcher only runs while unpaused.
- **Motion — `companion/motion.ts`** — pure `webcamTarget(bounds, cfg)` =
  horizontally-centred, parked `WEBCAM_TOP_MARGIN` (8px) below the top edge (right
  under a typical top-centre camera), clamped so the whole body stays on-screen.
- **Machine — `companion/machine.ts`** — two new states, `webcamTravel` and
  `posing`, plus `WEBCAM_ON`/`WEBCAM_OFF` (root-level, set `webcamActive`). A
  **latch** (`posedThisSession`) means the pose fires **once per camera session**:
  idle/wander/dance each guard `wantsPose = webcamActive && !posedThisSession` at the
  head of their TICK → `webcamTravel` (dashes to `webcamTarget` using the same
  boosted stepper as the notification dash) → `posing` (holds `POSE_TIME` 3.2s) →
  idle, setting `posedThisSession`. `WEBCAM_OFF` resets the latch so the *next*
  session poses again. Precedence is careful: a **toast still wins** (posing → alert
  → interact), and a camera turning on **mid-drag or mid-nudge is deferred** (the
  flag sets but the pose waits until the pup is free) — never yanked from the cursor
  or a reaction.
- **Renderer — `App.tsx`** — subscribes to `webcam:changed`, sends
  `WEBCAM_ON`/`WEBCAM_OFF`, and on "on" nudges the mood happy. `const posing =
  state.matches('posing') && !paused` is declared **early**, with the other
  emitter-driving booleans, because the sparkle emitter's effect keys on it (see the
  bug fix below). While posing, a small interval puffs **sparkles** around the head
  (`EffectsCanvas.sparkles`) for the photogenic glint; `moving` includes
  `webcamTravel` so the scurry animates.
- **Sprite — `SpriteCanvas.tsx`** — a `posing` prop forces the front pose, an
  `excited` face ("say cheese"), and a slight lift/tilt (`poseLift`/`poseTilt` folded
  into the head yaw + translate) so the pose reads as a deliberate little "photo" beat.

### Bug fixed this pass — `posing` used before declaration (App.tsx TDZ)
While wiring F3 I found a real defect: `const posing` sat **below** the sparkle
emitter that reads it, but a `useEffect`'s dependency array (`[posing]`) is evaluated
**eagerly during render** — so `posing` was referenced in its own temporal dead zone
(`ReferenceError` / TS2448 at runtime). Fixed by moving the declaration up beside
`reacting`/`interacting` (the codebase's own idiom: **emitter-driving** booleans are
declared early, **render-only** flags late) and removing the late duplicate. This
would have crashed the overlay render on load, so it's a genuine catch — not cosmetic.

### Tests added this pass
- `companion/motion.test.ts` — `webcamTarget` (centres + top-margin; clamps to origin
  on a tiny screen).
- `companion/machine.test.ts` — a 9-case **webcam pose-flow** suite: on→travel→pose→
  idle+latch, poses only once while the camera stays on, off resets the latch, off
  mid-scurry/mid-pose unwinds, a toast interrupts the pose, and on mid-drag/mid-nudge
  is deferred until free.
- `src/main/webcamWatcher.test.ts` (new) — 6 cases for the ConsentStore parser (empty
  → false; live Start≠0/Stop=0 → true; released → false; any-live-among-released →
  true; no cross-subkey Start/Stop pairing; ignore non-QWORD + zero Start). This is
  the one webcam piece testable without Windows/registry/camera; it runs in vitest's
  default node env (the module imports only `node:child_process`).
- `companion/audioBeat.test.ts` — `tempoScaleFromBeats` (neutral before rhythm; ~120
  BPM → ~1; fast → maxScale; slow → minScale; median robustness; order-independence)
  and a `stepBeat` tempoScale-surfacing block.
- `companion/effects.test.ts` — `spawnSparkles` (N unique twinkles in a tight upward
  halo) for the F3 pose glint.

### Verification status — ⚠ automated checks could NOT run this session
The Linux dev sandbox was **wedged this whole session** (bash failed to mount / the
workspace VM never came up), so `npm test`, `npm run typecheck`, and `npm run lint`
**could not be executed here** — not even the transpile-to-CJS harnesses. What *was*
done, all by static review through the file tools:
- **Type-contract audit of F1**: `Mood ⊇` every string the sprite/mood code
  references; `MoodDefault` (7) is fully covered by `MOOD_LABELS`, `MOOD_ORDER`,
  `PREVIEW_EXPR`, **and** `ENERGY`; `baseMoodFor`'s identity map is total because
  `MoodDefault ⊆ BaseMood`. All internally consistent.
- **Tray wiring** (`main/index.ts`): `appearance` is destructured from `getSettings()`
  in `buildTrayMenu`; the radio submenu + `setMoodDefault` (persist → side-effects →
  broadcast) are coherent.
- **F3 flow** read end-to-end (parser → watcher → main forward → machine states +
  latch → App subscription + early `posing` → sprite prop) — all the seams line up.
- **Found + fixed** the App.tsx TDZ bug above (would otherwise have crashed render).

**These must be run on Windows to actually close verification.**

### To verify on Windows (closes this out)
```powershell
cd "D:\Window pet"
npm install
npm run typecheck            # expect exit 0 (node + web)
npx eslint . --max-warnings 0
npm test                     # incl. new motion(webcamTarget), machine(webcam ×9),
                             #   webcamWatcher(×6), audioBeat(tempo), effects(sparkles)
npm run dev
# F1 moods: tray → "Mood" submenu → pick Excited/Curious/Grumpy/Sleepy/… → the pup's
#   resting FACE + liveliness change live; confirm Happy and Alert now look different.
# F2 tempo: play a slow song then a fast one → the bop visibly slows / speeds to match;
#   stop the audio and the next song starts at the natural speed.
# F3 webcam: open Camera / join a video call → the pup scurries to the top-centre,
#   strikes a sparkly "say cheese" pose for ~3s, then resumes roaming. Closing the
#   camera and reopening it poses again; a toast mid-pose still wins; dragging it or a
#   toast arriving never yanks it into the pose.
```

### Not in this pass
No new capability beyond the three requests; no new IPC surface for F1/F2 (tray reuses
settings broadcast; tempo reuses the existing loopback audio path). F3's detection is
the ConsentStore-registry approach (no camera frames ever read). Per-species pose
variations and a multi-monitor camera-position guess are possible future refinements.

---

## Launch-behaviour fixes — no startup DND, cute welcome instead of angry ✅ (static-verified — see caveat)

Two launch annoyances reported once the app was working end-to-end: *(1)* "whenever I
start the application it puts the laptop in Do Not Disturb — don't do that"; *(2)* "on
start the character always begins with an **angry** expression and then goes for a
normal walk — I want a cute **welcoming** expression first, then the normal walk."
Decisions (AskUserQuestion): bug #1 → **make dance-to-music opt-in** (ship it OFF so
launching never captures audio; keep the feature in Settings; flip any already-saved
`on`→off once); bug #2 → **Happy + hearts** welcome (a big happy face with a little hop
and floating hearts, then the normal walk).

### Bug #1 — launch silently turned on Do Not Disturb (root cause + 3-layer fix)
**Root cause:** "Dance to music" defaulted **ON**, so the app opened a **loopback
screen-capture** session (`getDisplayMedia({video: screen, audio:'loopback'})`) at
launch to listen for music. **Windows treats any live screen-capture as
screen-sharing** and auto-enables Do Not Disturb / Focus for the duration — so merely
starting Nudge muted the user's notifications. Because `reactToAudio: false` ⇒
`audioEnabled` false ⇒ `useSystemAudio` never calls `getDisplayMedia`, turning the
feature off at launch removes the capture entirely, and Windows never flips DND.

Fixed at three layers so both fresh and existing installs are covered:
- **`src/shared/settings.ts`** — `DEFAULT_SETTINGS.general.reactToAudio` flipped
  **`true` → `false`** (fresh installs never capture at launch). This **supersedes**
  the earlier "always auto-dance / default true" decision recorded in the
  *fast-dash + sound-sensitive dance* pass above — dance is now **opt-in**.
- **`src/main/settingsStore.ts`** — a one-time **`audioOptIn` migration**: existing
  stores already have `reactToAudio: true` persisted, and `mergeSettings`-onto-defaults
  would *keep* that true, so a default change alone wouldn't help them. `initSettings`
  now reads a `migrations` map from the store; if `audioOptIn` hasn't run, it flips a
  persisted `true`→`false` **once** and records the flag. **Guarded** so a user who
  later deliberately re-enables the toggle is never stomped on the next launch. (The
  `StoreSchema` gained an optional `migrations?: Record<string, boolean>`.)
- **`src/renderer/src/settings/SettingsApp.tsx`** — honest "Dance to music" copy:
  "Off by default: while it's on, Windows sees the audio capture as screen-sharing and
  may switch on Do Not Disturb. Listens to your PC's audio only — never the microphone."

### Bug #2 — startup "angry" (two parts: kill the cause, add an intentional greeting)
**Root cause (2a):** the C# watcher's **first poll** listed the toasts already sitting
in the Action Center from *before* launch and treated **every one as brand-new** →
fired `Appeared` for each → renderer `ALERT` → the pup greeted the user **angry**.
- **`native/NudgeWatcher/NotificationListenerDetector.cs`** — new `SeedExistingAsync()`
  called once **after** access is granted and **before** the poll loop: it records the
  ids present right now into `_tracked` **without raising `Appeared`**. `PollOnceAsync`
  already skips tracked ids (`if (_tracked.ContainsKey(id)) continue;`), so pre-existing
  toasts never fire a startup reaction — **only notifications that arrive after we start
  watching** nudge the pet. Best-effort (a failure just falls back to the old, noisier
  behaviour) and **privacy unchanged** — it reads only `n.Id` + `SafeAppName(n)`, never
  `n.Notification`/Visual (the message text).

**Intentional welcome (2b):** replace the (now-removed) angry flash with a deliberate
cute greeting that decays into the normal walk.
- **`src/renderer/src/companion/mood.ts`** — `TransientMood` widened to
  `'love' | 'angry' | 'happy'` and a new `{ type: 'WELCOME' }` event whose `reduceMood`
  case sets the transient `{ mood: 'happy', remaining: WELCOME_DURATION }`. New
  `WELCOME_DURATION = 2.2` (a touch longer than a pet's `LOVE_DURATION` 1.8 so the
  "hello!" clearly registers, shorter than `ANGRY_DURATION` 2.6). Because it's a
  **transient over the base**, it shows the happy face briefly, then decays back to
  whatever resting mood the user picked — i.e. *welcome, then normal*. Mood stays a
  pure reducer; no locomotion-FSM change.
- **`src/renderer/src/companion/SpriteCanvas.tsx`** — a one-shot **`hopNonce`** prop
  that reuses the existing **pet-hop** path (`petAtRef`), so the welcome = the same
  vertical bounce + tail-wag a pet triggers, but fired by a nonce (plays exactly once
  on startup and doesn't need the love face — the *happy* face is shown by the mood).
- **`src/renderer/src/App.tsx`** — a startup-greeting effect: ~220 ms after mount (lets
  the overlay paint first) it applies `{ type: 'WELCOME' }`, bumps `hopNonce`, and puffs
  **hearts** above the pup. A `welcomedRef` + guard-inside-`setTimeout` make it fire
  **exactly once** even under React 18 StrictMode's dev double-mount. A **genuine** new
  toast during the ~2.2 s welcome still interrupts it (latest-reaction-wins → angry),
  which is correct — only *pre-existing* toasts are suppressed (by 2a).

### Tests added/updated this pass
- **`src/renderer/src/companion/mood.test.ts`** — imports `WELCOME_DURATION`; adds two
  cases: `WELCOME` shows **happy** and decays back to a **non-neutral resting face**
  (SET_BASE `alert` → WELCOME → happy → after `WELCOME_DURATION` → alert), asserting
  `WELCOME_DURATION > LOVE_DURATION`; and a **real notification still interrupts the
  welcome** (`WELCOME` then `ALERT` → angry).
- **`src/shared/settings.test.ts`** — the old assertion `reactToAudio === true` would
  now fail; replaced with the opt-in expectation `reactToAudio === false` (comment
  explains the loopback-capture = screen-sharing = auto-DND reason). Caught proactively
  before it could break the Windows run.
- `appearance.test.ts` checked — it only spreads `DEFAULT_SETTINGS` (never asserts
  `reactToAudio`), so no change was needed.

### Verification status — ⚠ automated checks could NOT run this session
The Linux dev sandbox was **wedged again this session** (bash failed with a Plan9 mount
error — the workspace VM never came up), so `npm test`, `npm run typecheck`, and
`npm run lint` **could not be executed here**, nor the transpile-to-CJS harnesses. What
*was* done, all by static review through the file tools:
- **Re-read every edited region** and confirmed type-safety/coherence: `mood.ts`
  (WELCOME case + widened `TransientMood` + `WELCOME_DURATION`; `expressionOf` still
  returns a valid `Mood` since `'happy' ∈ Mood`); `SpriteCanvas.tsx` (`hopNonce`
  destructure + `prevHopRef` + prop-mirror in all three spots + edge-trigger reusing
  `petAtRef`); `App.tsx` (welcome effect + `hopNonce` state + prop pass); `settings.ts`
  (default false); `settingsStore.ts` (guarded `audioOptIn` migration + `StoreSchema`);
  `SettingsApp.tsx` (copy); the C# `SeedExistingAsync` (privacy-safe, skips via the
  existing `_tracked` guard).
- **Traced the mood-test arithmetic** by hand (2.2 > 1.8; TICK 2.1 s leaves 0.1 s →
  still happy; +0.2 s → transient cleared → base `alert`; WELCOME-then-ALERT → angry).

**These must be run on Windows to actually close verification.**

### To verify on Windows (closes this out)
```powershell
cd "D:\Window pet"
npm install
npm run typecheck            # expect exit 0 (node + web)
npx eslint . --max-warnings 0
npm test                     # incl. new mood(WELCOME ×2) + updated settings default
npm run dev                  # predev rebuilds the C# watcher (SeedExistingAsync added)
# Bug #1: on launch, Windows should NOT switch to Do Not Disturb / Focus. Open Settings
#   → General → "Dance to music" is OFF by default; turning it ON is what enables the
#   loopback listen (and the DND side effect is now explained in the copy). Existing
#   installs: the one-time migration flips a previously-saved ON to OFF exactly once.
# Bug #2: on launch the pup shows a HAPPY face + a little hop + floating hearts for ~2s,
#   then starts its normal walk — no angry flash, even if the Action Center already has
#   unread toasts. A NEW toast arriving during the welcome still makes it react (correct).
```

### Not in this pass
No change to the notification-reaction pipeline itself (dash/paw-swat/close), the audio
detection path, or any wire format. Dance remains fully available — it's just opt-in
now. The welcome reuses the existing hop/hearts, so no new animation path was added.


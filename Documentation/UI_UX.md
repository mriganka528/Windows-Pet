# UI/UX Design Document — Desktop Companion

## 1. Design Principles
1. **Invisible until needed.** The app itself has almost no "UI" in the traditional sense — the companion IS the interface. Chrome (settings, tray) should be minimal, calm, and get out of the way fast.
2. **Never block work.** The companion window must never intercept clicks meant for underlying apps. Click-through everywhere except the animal's own hitbox.
3. **Charm over realism.** Simple, expressive, slightly exaggerated 2D animation (think classic Flash-era desktop pets / Shimeji, not 3D realism) — cheaper to produce, more personality per frame.
4. **Transparent about automation.** Any time the companion is about to take an action on the user's behalf (closing a notification), that action should be visually obvious as it happens (walk-over + hand animation), never silent/instant.
5. **Respect the user's exit.** Pausing, hiding, or quitting the companion must always be one click away (tray icon).

## 2. Surfaces

### 2.1 The Companion Overlay (primary surface)
- Full-screen transparent window(s), one per monitor if multi-monitor support is included, layered above all normal windows but below the notification toast layer itself (so the animal never visually covers a toast it hasn't "reached" yet, and always appears to physically arrive at it).
- Animal sprite size options: Small (~48px), Medium (~80px, default), Large (~128px), scalable via settings slider.
- Ground plane: for MVP, animal walks along the taskbar edge / bottom of screen like a classic desktop pet, with occasional "explore" excursions upward. Full free-roam physics is a nice-to-have, not required for MVP charm.
- Drag interaction: mouse-down on the sprite picks it up (animation: dangling/surprised), mouse-up drops it (animation: recover + resume idle/walk).
- Idle click ("pet"): short affectionate animation, optional sound cue.

### 2.2 Notification Reaction States
- **Idle/Wander** → **Alert** (notices notification appear — small exclamation/ear-perk animation, ~200ms) → **Travel** (moves toward the notification's screen position, run-cycle animation) → **Interact** (Nudge: sit-and-point animation next to it; or Auto-Close: reach-and-tap animation on the X) → **Return to Wander**.
- If multiple notifications queue up, companion handles them in order; queue is capped (e.g. max visible reaction backlog of 3) — beyond that, it just returns to wandering to avoid manic back-and-forth.

### 2.3 Tray Menu
Minimal native tray menu:
- Companion name / status ("Buddy is watching 🐾" / "Buddy is paused")
- Pause / Resume
- Open Settings
- Quit

### 2.4 Settings Window
Single non-modal window, tabbed or single-scroll (keep it small — this is not a "dashboard" app):
- **Appearance**: character picker (grid of thumbnails), size slider, color theme swatches, mood default (dropdown or 3 icon buttons: Happy / Chill / Alert).
- **Behavior**: mode toggle — "Nudge only" (default, described plainly: *"Buddy points out notifications but never closes them"*) vs "Auto-close for selected apps" (with the per-app allowlist checklist below it, and a plain-language warning about interactive notifications being skipped).
- **General**: start with Windows, sound on/off, "which monitor(s)" if multi-monitor, reset to defaults.

## 3. Visual Style
- Flat-shaded 2D vector-style sprite sheets (SVG-based or exported PNG sprite sheets) — easiest to recolor for the theme feature (swap fill colors via CSS variables if rendering SVG in a `<canvas>`/DOM layer, or palette-swap shaders if using WebGL/PixiJS).
- Expression set per mood: eyes/eyebrows/tail position/ear position are the primary "read at a glance" signals — keep the body silhouette constant across moods so recoloring/resizing stays simple.
- Animation frame budget: aim for 6–10 frames per cycle (walk, idle, react, drag) to keep the asset pipeline light for a solo/small builder.

## 4. Accessibility & Comfort
- Provide a "reduced motion" mode: slower movement, fewer spontaneous wander triggers, no sudden jumps.
- Provide a full opacity/size-down-to-tiny option and a one-click hide-for-today, for users who want the safety net without the visual presence.
- All settings changes apply live — no "restart app" needed.

## 5. Empty/Error States
- If notification detection fails (e.g. after a Windows update breaks the UIA path), companion silently falls back to pure wandering — no error popups spamming the user. A small tray icon badge or settings-page note can say "Notification detection unavailable — investigating" rather than surfacing a scary error dialog.

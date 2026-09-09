# Product Requirements Document — Desktop Companion (working title: "Nudge")

## 1. Summary
A Windows desktop application that displays a cartoon animal (default: a dog) that roams freely over the user's screen, on top of all other windows. The animal is a lightweight, always-present companion whose core job is **distraction avoidance**: when a system notification (toast) appears, the animal walks/runs to it and interacts with it (nudges or closes it), then resumes wandering. The animal is visually customizable (size, color theme, mood/expression) and can be repositioned by the user via drag.

## 2. Problem Statement
Desktop notification toasts are a major source of context-switching and attention fragmentation. Users either get pulled into checking them or spend willpower ignoring them. A visible, characterful "agent" that proactively handles notifications gives users a lightweight, low-effort way to reduce that friction, while adding a bit of personality/companionship to the desktop — differentiating from purely functional "Do Not Disturb" toggles.

## 3. Goals
- Give users a persistent, charming on-screen presence that reduces the number of times they consciously engage with a notification toast.
- Let users fully customize the companion's appearance and behavior.
- Ship an MVP that is safe by default (never silently discards something the user needed to see) and clearly explains what it's doing.
- Keep resource usage (CPU/GPU/RAM) minimal — this runs 100% of the time in the background.

## 4. Non-Goals (v1)
- Not a notification *manager* / inbox (not replacing Windows Action Center).
- Not cross-platform at launch — Windows 10/11 only.
- Not modifying or reading notification *content* for any purpose beyond locating its close affordance (privacy: no logging/storage of notification text).
- Not a virtual assistant / chatbot — no NLP, no voice.

## 5. Target User
Knowledge workers and students who keep many apps open, get frequent toast notifications (Slack, Teams, email, OS updates), and want a passive, ambient way to reduce interruption — without setting up complex Focus Assist rules.

## 6. Core Feature Set

### 6.1 Roaming Companion (MVP)
- Transparent, click-through, always-on-top overlay window spanning all monitors.
- Animal sprite walks around screen edges/desktop using simple idle/walk/run/drag/react animation states.
- User can click-and-drag the animal to relocate it anywhere.
- Animal reacts to being clicked/petted (short animation + optional sound, mutable).
- Runs at system startup (toggle in settings), lives in system tray, can be paused/hidden from tray icon.

### 6.2 Notification Awareness (MVP)
- App detects when a new Windows toast notification appears (via UI Automation watcher) and its on-screen bounding box.
- Companion interrupts its current wandering path and moves toward the notification.
- **Default behavior = "Nudge"**: the companion sits beside/on the notification and plays a reaction animation, drawing the user's eye to it, without dismissing it. This is the safe default — the user still decides whether to act.
- Companion returns to wandering after N seconds or once the notification is gone (dismissed by user or by OS timeout).

### 6.3 Auto-Close Mode (v1.1 stretch goal, opt-in)
- Per-application allowlist ("Let the companion auto-close notifications from: Windows Update, [chosen apps]").
- When enabled for an app, companion locates the notification's close (X) button via UI Automation and simulates a click on it, then plays a "did it!" animation.
- Global kill switch and a "pause auto-close for 1 hour" quick action from the tray icon.
- Clear onboarding copy explaining this simulates a real mouse click and can occasionally fail or lag behind fast notification volleys — never guaranteed.
- Never auto-closes notifications flagged as high-priority/interactive by the OS (e.g. those with input fields, calls) — detect via UIA control type and skip.

### 6.4 Customization (MVP)
- **Character**: choose from a small starter set of animal types (dog first; cat/bird as stretch).
- **Size**: small / medium / large (scale slider).
- **Color theme**: palette/skin swap (recolor via sprite-sheet variants or shader tint).
- **Mood/expression**: user can set a "default mood" (happy, sleepy, alert) which affects idle animation and speed; mood can also passively shift (e.g. more energetic after being petted, sleepier late at night) — stretch goal, not MVP-blocking.
- Settings persist locally (no account needed for v1).

### 6.5 Settings & Tray
- System tray icon: pause/resume, open settings, quit.
- Settings window (simple, non-modal): character picker, size, color, behavior mode (nudge vs auto-close), per-app allowlist, start-with-Windows toggle.

## 7. Success Metrics
- Idle CPU usage < 2–3% on a typical laptop; idle RAM < 150MB.
- Companion correctly detects and reacts to a Windows toast within ~500ms of it appearing, in ≥90% of cases during internal testing.
- Zero cases in testing of the app dismissing a notification with an interactive input field.
- User can fully customize appearance in under 60 seconds without documentation.

## 8. Risks & Constraints
- **UI Automation fragility**: Microsoft can change the internal notification UI tree across Windows feature updates, breaking detection. Mitigate with a versioned "notification adapter" module that's easy to patch, and graceful degradation (companion just stops reacting to notifications rather than crashing).
- **Simulated clicks are inherently risky**: a misfire could click something other than intended if coordinates are stale. Always re-verify the element still exists and its bounding box hasn't changed immediately before clicking.
- **Antivirus/SmartScreen friction**: unsigned apps that simulate mouse input and watch UI Automation can be flagged by AV heuristics. Plan for code-signing before any public distribution.
- **Windows-only APIs**: UI Automation notification traversal is Windows-specific; no code-sharing path to macOS/Linux for this feature.

## 9. Open Questions
- Should auto-close be off-by-default even after v1.1 ships, given the safety risk? (Recommendation: yes, always opt-in per app.)
- Do we want multi-monitor-aware pathing in MVP, or constrain the companion to the primary display first?
- Sound on by default, or silent by default with an easy toggle?

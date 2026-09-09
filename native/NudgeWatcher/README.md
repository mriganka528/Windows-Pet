# NudgeWatcher — Native Notification Watcher (Phases 4–5)

A small standalone **C# / .NET 8** console app that uses **Windows UI Automation
(UIA)** to notice when a toast notification appears on screen, and prints its
**position, size, and a couple of metadata flags** as newline‑delimited JSON.

**Phase 4** is detection (stdout). **Phase 5** adds a `--pipe <name>` transport so
the Electron app can spawn this watcher and consume the *same* JSON over a named
pipe. It still does *not* click or close anything — that's Phase 6. The Phase‑4
goal remains the testable core: *trigger a real notification, and reliably print a
correct bounding box + an `interactive` flag.*

---

## Privacy stance (please read)

This watcher is deliberately built so it **cannot leak the content of your
notifications**:

- It **never emits** the title or body text of a notification. The JSON it emits
  (on stdout and on the `--pipe` named pipe alike) carries only geometry
  (`bounds`), a best‑effort **host process** name (`appId`, e.g.
  `ShellExperienceHost` — *not* the message), and two booleans (`interactive`,
  `hasCloseButton`).
- It **does** read some control *labels* while classifying (e.g. a button named
  "Reply") — but only to decide `interactive: true/false`. Those labels are UI
  affordances, not the message, and they never leave the process.
- Even `--verbose` output **redacts text**: the element‑tree dump prints control
  types and *name lengths only*, never the names themselves.

This mirrors `Documentation/ARCHITECTURE.md` §7.

---

## Prerequisites

- **Windows 10 (1809+) or 11** (the app targets `net8.0-windows10.0.19041.0` and
  calls Windows‑only APIs, including the WinRT notification platform).
- **.NET 8 SDK** — check with `dotnet --version` (want `8.x`). Get it from
  <https://dotnet.microsoft.com/download/dotnet/8.0> if missing.

No admin rights are needed. The app requests `asInvoker` (standard user) in its
manifest — UIA reads on foreground UI don't require elevation.

---

## Build & run

From this folder (`native/NudgeWatcher/`):

```powershell
# Build
dotnet build

# Watch continuously — prints a JSON line whenever a toast appears/closes.
# Leave it running, then trigger a notification (see "How to trigger a toast").
dotnet run

# Stop with Ctrl+C (it unwinds cleanly and removes its UIA handlers).
```

You'll see human‑readable logs on **stderr** and machine JSON on **stdout**. To
see *only* the JSON protocol (the same bytes Electron consumes over the pipe),
redirect stderr away:

```powershell
dotnet run 2> $null
```

> When launched by the Electron app you won't run this by hand at all — the app
> passes `--pipe <name>` and reads the identical JSON over a named pipe instead of
> stdout (see "Streaming to Electron" below).

### One‑shot scan (best tool for tuning)

```powershell
# Inspect what's on screen right now, report toast-like windows, then exit.
dotnet run -- --scan

# Same, but with a redacted element-tree dump for anything it finds.
dotnet run -- --scan --verbose
```

> The `--` tells `dotnet run` "everything after this goes to my app, not to the
> SDK." When you run the published `.exe` directly (Phase 7), you won't need it:
> `NudgeWatcher.exe --scan --verbose`.

### All flags

| Flag | Meaning |
|------|---------|
| *(none)* | Watch mode: stream events until Ctrl+C. |
| `--scan` | Inspect current windows once, then exit. |
| `--pipe <name>` | Also stream the JSON protocol over `\\.\pipe\<name>` (Electron sets this and connects as the client). `--pipe=<name>` is also accepted. Ignored with `--scan`. |
| `-v`, `--verbose` | Chatty stderr diagnostics + redacted element tree. |
| `-h`, `--help`, `/?` | Usage. |

---

## Streaming to Electron over a named pipe (Phase 5)

In normal use you don't launch this watcher yourself — the Electron app does. When
it spawns the process it adds `--pipe <name>`, and the watcher then emits every
JSON line to **both** stdout **and** a Windows **named pipe** called
`\\.\pipe\<name>`. The wire format is byte‑for‑byte the same; only the transport
is added.

**What's a named pipe?** Think of it as a private, in‑memory channel between two
processes on the same machine — like a socket, but addressed by a name instead of
a network port, and never exposed to the network. It's the standard Windows way
for a parent process and a helper it launched to talk.

**Who is server, who is client?** Slightly counter‑intuitively, the **watcher is
the server** (it *creates* the pipe and waits) and **Electron is the client** (it
*connects* to the pipe). We chose it this way so the pipe's lifetime is tied to the
watcher: if the watcher dies, the pipe vanishes, and Electron's client socket sees
a clean disconnect and can decide whether to restart the watcher.

**How the name is chosen.** Electron generates a fresh random name per launch
(e.g. `nudge-a1b2c3…`) so two runs never collide and nothing else can guess it.
The watcher just uses whatever name it's handed.

**Reconnection & framing.** The channel is resilient by design:

- Electron waits briefly for the pipe to exist after spawning (the server needs a
  moment to create it), retrying a few times before giving up.
- If the watcher crashes, Electron restarts it with a fresh pipe name using
  exponential backoff, and after repeated failures falls back to **wander‑only**
  (the companion still works, it just won't react to toasts).
- Messages are newline‑delimited (NDJSON). The reader buffers partial data and
  only parses on a newline, so a message split across two pipe reads is
  reassembled correctly.

**Backpressure.** The watcher writes into a small bounded queue (drop‑oldest). If
Electron ever stalls reading, the newest toast events win and stale ones are
discarded rather than growing memory without bound — a missed toast is harmless,
an OOM is not.

You can watch the exact bytes Electron would see by running `dotnet run 2> $null`
(stdout carries the same protocol), or exercise the pipe path directly by passing
`--pipe nudge-test` and connecting any named‑pipe client to `\\.\pipe\nudge-test`.

---

## How to trigger a toast (for testing)

- Run `dotnet run` in one terminal, then in another:
  ```powershell
  # Fires a simple Windows system toast.
  New-BurntToast -Text "Nudge test", "hello"   # if you have the BurntToast module
  ```
- Or simpler: send yourself a **Microsoft Teams / Outlook / Slack / Discord**
  message, plug/unplug a USB device, or change volume — anything that raises a
  system toast.
- Or open **Settings → System → Notifications** and use an app that shows a test
  banner.

When a toast appears you should get a line like:

```json
{"type":"notification_appeared","id":"7b2f…","appId":"ShellExperienceHost","bounds":{"X":1520,"Y":880,"Width":360,"Height":110},"interactive":false,"hasCloseButton":true,"ts":"2026-09-08T12:34:56.789Z"}
```

and when it disappears:

```json
{"type":"notification_closed","id":"7b2f…","ts":"2026-09-08T12:35:12.001Z"}
```

---

## If detection doesn't work: tuning

Toast detection via UIA is **inherently heuristic** and drifts across Windows
builds and locales — the window class and the process that hosts toasts have
changed several times between Windows 10 and 11 feature updates. So the very first
time you run this on your machine, detection might miss. That's expected, and
fixing it means editing **one file**: [`ToastHeuristics.cs`](./ToastHeuristics.cs).

Workflow:

1. Trigger a toast and, while it's visible, run `dotnet run -- --scan --verbose`
   in another terminal (toasts linger a few seconds — be quick, or use an app
   whose toast stays up).
2. Read the stderr output. For each top‑level window it prints
   `class=… host=… knownHost=…`. Find the one that corresponds to your toast.
3. Add its **class name** to `CandidateWindowClasses` and its **host process** to
   `ToastHostProcesses` in `ToastHeuristics.cs`.
4. If the `interactive` / `hasCloseButton` flags are wrong, look at the redacted
   tree dump and adjust `CloseButton*` / `Chrome*` / `IsInteractiveControl`.
5. Rebuild and re‑test.

Everything fragile lives in that one file on purpose; the rest of the code reads
values *from* it and shouldn't need changing as you tune.

---

## A quick UIA primer (if you're new to it)

UI Automation is Windows' accessibility framework — the same plumbing screen
readers use. It exposes every app's UI as one big tree of **elements**:

- **`AutomationElement`** — a node in that tree: a window, a button, a text field.
  `AutomationElement.RootElement` is the desktop; everything hangs beneath it.
- **Properties** — each element has `Name`, `ClassName`, `ControlType`,
  `BoundingRectangle`, `ProcessId`, a `RuntimeId`, etc.
- **Events** — you can subscribe to things happening anywhere in the tree. We use
  `WindowOpenedEvent` / `WindowClosedEvent` on the root to hear about every window
  that appears or disappears, then filter down to toasts.
- **`CacheRequest`** — reading a property is a *cross‑process call* and is slow if
  done one at a time. A `CacheRequest` says "when you hand me this element,
  pre‑load these properties (optionally for its whole subtree) in **one**
  round‑trip." We then read `element.Cached.X` with no further calls. This is the
  difference between snappy and janky.
- **`ElementNotAvailableException`** — the element vanished between calls. With
  toasts (which live for seconds) this happens constantly and is treated as
  normal, not an error.

Two rules this code follows that are easy to get wrong:

1. **Don't do heavy UIA work inside an event callback.** Callbacks arrive on a
   UIA‑internal thread and re‑entrant UIA calls there can deadlock. Our
   `WindowOpened` handler does one cheap class check, then hands the real work to
   a `Task` on the thread pool.
2. **UIA client threads should be MTA.** A .NET console `Main` is MTA by default;
   we also mark it `[MTAThread]` so it's explicit.

---

## Output schema (stdout, newline‑delimited JSON)

`notification_appeared`:

| Field | Type | Notes |
|-------|------|-------|
| `type` | string | `"notification_appeared"` |
| `id` | string | GUID we assign; stable for this toast's lifetime; echoed on close |
| `appId` | string? | Best‑effort **host process** name (metadata, not content); omitted if unknown |
| `bounds` | object | `{ X, Y, Width, Height }` in **physical** screen pixels, top‑left origin |
| `interactive` | bool | Has controls a user is meant to act on (reply box, action buttons)? Auto‑close (Phase 6) must skip these |
| `hasCloseButton` | bool | We found a dismiss/close button |
| `ts` | string | ISO‑8601 UTC detection time |

`notification_closed`:

| Field | Type | Notes |
|-------|------|-------|
| `type` | string | `"notification_closed"` |
| `id` | string | Matches the `id` from the earlier appeared event |
| `ts` | string | ISO‑8601 UTC |

(Null fields are omitted, so a close message is just `type` + `id` + `ts`.)

The schema is identical on stdout and on the `--pipe` named pipe — only the
transport differs (stdout → `\\.\pipe\…`). See "Streaming to Electron" above.

---

## Known limitations

- **Heuristic detection.** May miss toasts from some apps / Windows builds until
  `ToastHeuristics.cs` is tuned (see above). This *is* the phase where we iterate
  that in.
- **`appId` is the host process, not the sending app.** Mapping a toast back to
  the true originating app (its AUMID) is a later refinement — and must stay
  content‑free.
- **Closing (Phase 6) is done, scope "close everything."** The watcher can now
  dismiss a toast on request — a reverse `{"cmd":"close","id":…}` line over the
  same pipe triggers a FRESH UIA re-locate of the dismiss control, invoked via
  `InvokePattern` (no synthetic mouse). It acts only when the app is in auto-close
  mode and not paused (Electron main is the trust boundary). There is intentionally
  **no per-app allowlist and no interactive-toast skip** — the chosen scope closes
  every toast it can.
- **DPI:** the manifest declares Per‑Monitor‑V2 so bounds come back in true
  physical pixels on scaled/mixed‑DPI displays. If you ever see bounds that look
  half/double size, suspect DPI awareness first.

---

## File map

| File | Role |
|------|------|
| `Program.cs` | Entry point, CLI (`--scan`/`--pipe`/`-v`/`--help`), lifecycle, dual‑sink emit (stdout + pipe) |
| `ToastDetector.cs` | UIA subscription, candidate filtering, classification, close‑tracking |
| `ToastHeuristics.cs` | **The tunable rules** — class/host/button matching. Edit this to fix detection |
| `NotificationInfo.cs` | The JSON wire model (privacy‑safe by construction) |
| `PipeServer.cs` | Named‑pipe server for `--pipe` (bounded drop‑oldest queue, single client) |
| `NudgeWatcher.csproj` | .NET 8 project (UseWPF pulls in managed UIA assemblies) |
| `app.manifest` | `asInvoker` (no elevation) + Per‑Monitor‑V2 DPI awareness |

---

## What's next

- **Phase 5 — done.** The Electron app spawns this watcher with `--pipe`, reads
  these same JSON messages over the named pipe, converts each toast's geometry to
  overlay‑local pixels, and drives the companion's `Alert → Travel → Nudge`
  behavior. See "Streaming to Electron" above.
- **Phase 6 — done.** `closeNotification(id)` is implemented: on a reverse
  `close` command the watcher re-locates the dismiss control fresh, re-verifies it,
  and fires it through **UIA `InvokePattern`** — **not** `SendInput`. (There is no
  MSAA/`LegacyIAccessible` fallback: that pattern isn't in the managed UIA API, and
  shell toast close buttons expose `InvokePattern` anyway.) Scope is "close
  everything": no per-app allowlist, and interactive toasts are closed too. Success
  surfaces through the normal `WindowClosed` → `notification_closed` event.

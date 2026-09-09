// ---------------------------------------------------------------------------
// build-watcher.mjs — compile the native C# notification watcher (best-effort).
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Nudge reacts to real Windows toasts using a small, separate .NET program in
// native/NudgeWatcher. Electron cannot detect toasts on its own, so if that
// program is not compiled the app still runs but silently falls back to
// "wander-only" — the pet roams and can be petted/dragged, but it never notices
// notifications. That is a confusing first-run experience (everything *looks*
// fine), so we build the watcher automatically as a `predev` step.
//
// HARD RULE: this script must NEVER break `npm run dev`.
//   • No .NET SDK installed?  -> print a friendly note, exit 0 (dev still runs).
//   • Build fails?            -> print the error, exit 0 (dev still runs).
//   • Already up to date?     -> skip the build entirely (fast dev startup).
// The only effect of a failure here is that notifications stay disabled until
// the user installs .NET 8 and re-runs — never a blocked dev server.
//
// To force a rebuild regardless of freshness:  FORCE_WATCHER_BUILD=1 npm run dev
// To build explicitly with full error output:  npm run watcher:build
//
// This file is plain Node ESM (no TypeScript, no deps) so it runs anywhere the
// repo does, on any OS, without a build step of its own.

import { spawnSync } from 'node:child_process'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(scriptDir)
const projectDir = join(repoRoot, 'native', 'NudgeWatcher')
const csproj = join(projectDir, 'NudgeWatcher.csproj')
// Debug is what `dotnet build` produces by default, and it's the first path the
// supervisor (src/main/notificationWatcher.ts → resolveExe) looks for in dev.
// The csproj targets net8.0-windows10.0.19041.0 (the Windows-version TFM is
// required for the WinRT UserNotificationListener projections), so the exe lands
// in a net8.0-windows10.0.19041.0 folder — keep this in sync with the csproj's
// <TargetFramework> and with resolveExe's candidate list.
const tfm = 'net8.0-windows10.0.19041.0'
const exePath = join(projectDir, 'bin', 'Debug', tfm, 'NudgeWatcher.exe')

// A soft note prefix so these lines are easy to spot (and clearly non-fatal).
const tag = '[build-watcher]'
const note = (msg) => console.log(`${tag} ${msg}`)

function bail(msg) {
  // Always a clean exit: a missing/broken watcher must not stop the dev server.
  note(msg)
  note('notifications will be disabled (wander-only) until this is resolved.')
  process.exit(0)
}

if (!existsSync(csproj)) {
  bail(`native project not found at ${csproj}`)
}

// --- freshness check: skip the build if the exe is newer than every source ---
// dotnet's own incremental build is smart, but spawning it still costs a second
// or two on every `npm run dev`. Skipping when nothing changed keeps dev snappy.
function newestSourceMtimeMs(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Ignore build outputs so a fresh build never looks "newer than itself".
    if (entry.isDirectory()) {
      if (entry.name === 'bin' || entry.name === 'obj') continue
      newest = Math.max(newest, newestSourceMtimeMs(join(dir, entry.name)))
    } else if (/\.(cs|csproj)$/.test(entry.name)) {
      newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs)
    }
  }
  return newest
}

const force = process.env['FORCE_WATCHER_BUILD'] === '1'
if (!force && existsSync(exePath)) {
  try {
    if (statSync(exePath).mtimeMs >= newestSourceMtimeMs(projectDir)) {
      note('watcher is up to date — skipping build.')
      process.exit(0)
    }
  } catch {
    // If anything about the freshness check goes wrong, fall through and build.
  }
}

// --- attempt the build -------------------------------------------------------
// First, a quiet probe for the .NET SDK. On Windows we build via a shell (so the
// .cmd/.exe shim resolves), but that means a missing `dotnet` shows up as cmd's
// "'dotnet' is not recognized" + exit code 1 rather than a clean ENOENT — an
// unhelpful message for the common "SDK not installed" case. Probing without a
// shell gives a reliable ENOENT when it's genuinely absent, so we can print the
// friendly install hint up front and skip the noisy failed build entirely.
function dotnetMissing() {
  const probe = spawnSync('dotnet', ['--version'], { stdio: 'ignore', shell: false })
  return Boolean(probe.error) && probe.error.code === 'ENOENT'
}

if (dotnetMissing()) {
  bail('the .NET SDK (dotnet) was not found on your PATH. Install .NET 8 SDK from https://dotnet.microsoft.com/download to enable notifications.')
}

note('building the native notification watcher (dotnet build)…')
let result
try {
  result = spawnSync('dotnet', ['build', csproj, '-c', 'Debug', '--nologo'], {
    stdio: 'inherit',
    // shell:false is REQUIRED here. `csproj` is an absolute path that can contain
    // spaces (e.g. "D:\Window pet\native\..."). With shell:true, Node joins argv
    // into one string for cmd.exe WITHOUT quoting, so cmd splits at the space and
    // MSBuild sees two projects -> "MSB1008: Only one project can be specified".
    // With shell:false the args array is handed to CreateProcess verbatim, so the
    // spaced path stays one argument. `dotnet` still resolves: CreateProcess
    // appends .exe (dotnet is a real dotnet.exe, not a .cmd shim), which is why
    // the shell:false dotnetMissing() probe above already works.
    shell: false
  })
} catch (err) {
  bail(`could not run dotnet: ${err && err.message ? err.message : err}`)
}

if (result.error) {
  if (result.error.code === 'ENOENT') {
    bail('the .NET SDK (dotnet) was not found on your PATH. Install .NET 8 SDK from https://dotnet.microsoft.com/download to enable notifications.')
  }
  bail(`dotnet failed to start: ${result.error.message}`)
}

if (result.status !== 0) {
  bail(`dotnet build exited with code ${result.status}.`)
}

note(`watcher built: ${exePath}`)

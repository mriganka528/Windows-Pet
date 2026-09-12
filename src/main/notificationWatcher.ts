import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { app } from 'electron'

// ---------------------------------------------------------------------------
// Phase 5 supervisor: run the native watcher and turn its NDJSON into events.
// ---------------------------------------------------------------------------
// The native C# watcher (native/NudgeWatcher) is a separate process. We are its
// pipe CLIENT (it is the server): we generate a unique pipe name, spawn it with
// `--pipe <name>`, connect to \\.\pipe\<name>, and parse one JSON object per line.
//
// RESILIENCE (ARCHITECTURE.md §6): the app must degrade to "wander-only" if the
// watcher is missing or keeps crashing — it must never take Nudge down.
//   • exe not found            -> report unavailable, do nothing else
//   • child crashes/exits      -> restart with exponential backoff, capped
//   • too many rapid failures  -> give up, report unavailable (stay wander-only)
//   • transient pipe blips      -> reconnect quietly (no tray flicker)
//
// PRIVACY: we only parse the geometry/metadata schema the watcher emits; there is
// no text field to leak. The child's stderr is diagnostics only (already redacted
// by the watcher) and is surfaced to the main-process log in dev.

/** A toast the watcher reported. Geometry is PHYSICAL screen px (converted to
 *  overlay-local later, in the main process, where Electron's `screen` lives). */
export interface WatcherAppeared {
  id: string
  appId?: string
  screenRect: { x: number; y: number; width: number; height: number }
  screenClosePoint?: { x: number; y: number }
  interactive: boolean
  hasCloseButton: boolean
}

export interface WatcherClosed {
  id: string
}

export interface NotificationWatcherOptions {
  onAppeared: (n: WatcherAppeared) => void
  onClosed: (n: WatcherClosed) => void
  /** Fires only on meaningful transitions: connected (true) or gave-up/missing
   *  (false). Transient reconnects do NOT fire, so the tray label stays steady. */
  onAvailabilityChange?: (available: boolean, reason?: string) => void
  log?: (msg: string) => void
}

// Backoff + retry tuning.
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 15_000
const MAX_CONSECUTIVE_FAILURES = 5
// If a run stayed healthy at least this long, the next failure is treated as
// "fresh" (failure counter resets) so occasional crashes don't exhaust the cap.
const STABLE_RUN_MS = 20_000
// After spawn the server needs a moment to create the pipe; retry connecting.
const CONNECT_RETRY_DELAY_MS = 100
const CONNECT_RETRY_MAX = 30 // ~3s worst case
const MAX_BUFFER_BYTES = 64 * 1024

export class NotificationWatcher {
  private child: ChildProcess | null = null
  private socket: net.Socket | null = null
  private pipeName = ''
  private buffer = ''
  private failures = 0
  private spawnedAt = 0
  private connectAttempts = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private available = false
  private readonly log: (msg: string) => void

  constructor(private readonly opts: NotificationWatcherOptions) {
    this.log = opts.log ?? ((): void => {})
  }

  /** Begin supervising. Safe to call once after app is ready. */
  start(): void {
    if (this.disposed) return
    const exe = this.resolveExe()
    if (!exe) {
      this.setAvailable(
        false,
        'watcher executable not found — notifications disabled (wander-only)',
        true
      )
      return
    }
    this.spawn(exe)
  }

  /** Stop everything: kill the child, close the pipe, cancel timers. Idempotent. */
  dispose(): void {
    this.disposed = true
    this.clearTimers()
    this.teardownSocket()
    this.killChild()
    this.child = null
  }

  /**
   * Phase 6: ask the watcher to dismiss a specific toast by id. Writes one NDJSON
   * command line back over the SAME duplex pipe the watcher streams events on
   * (the C# side parses `{"cmd":"close","id":...}` — see PipeServer.ReadCommandsAsync).
   * Best-effort: if we're momentarily disconnected we just drop it and return
   * false (the toast stays; the companion's reaction will time out harmlessly).
   * The id is one the watcher itself minted — no notification text crosses here.
   */
  sendClose(id: string): boolean {
    if (this.disposed || !id) return false
    const s = this.socket
    if (!s || s.destroyed || !s.writable) {
      this.log(`close ${id}: no live pipe; dropping request`)
      return false
    }
    try {
      s.write(`${JSON.stringify({ cmd: 'close', id })}\n`)
      return true
    } catch (err) {
      this.log(`close ${id}: write failed: ${(err as Error).message}`)
      return false
    }
  }

  // --- executable resolution -------------------------------------------------
  private resolveExe(): string | null {
    // 1) explicit override (dev/testing): point at any built NudgeWatcher.exe.
    const override = process.env['NUDGE_WATCHER_EXE']
    if (!app.isPackaged && override && existsSync(override)) return override

    // 2) packaged app: bundled under resources/watcher/ (see Phase 7 packaging).
    if (app.isPackaged) {
      const packaged = join(process.resourcesPath, 'watcher', 'NudgeWatcher.exe')
      return existsSync(packaged) ? packaged : null
    }

    // 3) dev: whatever `dotnet build` produced under the native project.
    //    The csproj targets net8.0-windows10.0.19041.0 (the Windows-version TFM is
    //    required for the WinRT UserNotificationListener projections), so the exe
    //    lands in a bin/…/net8.0-windows10.0.19041.0/ folder. We deliberately do
    //    NOT fall back to the older plain net8.0-windows path: any exe there is a
    //    stale pre-pivot build whose window-enumeration detector can't see Win11
    //    toasts, so running it would look "connected" yet silently never react —
    //    strictly worse than wander-only. If the new build is missing we return
    //    null and stay wander-only, which the tray surfaces honestly.
    const appPath = app.getAppPath()
    const tfm = 'net8.0-windows10.0.19041.0'
    const candidates = [
      join(appPath, 'native', 'NudgeWatcher', 'bin', 'Debug', tfm, 'NudgeWatcher.exe'),
      join(appPath, 'native', 'NudgeWatcher', 'bin', 'Release', tfm, 'NudgeWatcher.exe')
    ]
    for (const p of candidates) if (existsSync(p)) return p
    return null
  }

  // --- process lifecycle -----------------------------------------------------
  private spawn(exe: string): void {
    this.clearTimers()
    this.pipeName = `nudge-${randomBytes(8).toString('hex')}`
    this.spawnedAt = Date.now()
    this.buffer = ''

    const args = ['--pipe', this.pipeName]
    if (!app.isPackaged) args.push('--verbose')
    // Discovery diagnostic: logs each observed notification's app name + id + the
    // corner rect the pet is aimed at (metadata only — never the message text), so
    // we can confirm detection is flowing. It's ON BY DEFAULT IN DEV right now while
    // we stabilize detection; set NUDGE_WATCHER_DISCOVER=0 to silence it, or =1 to
    // force it on (e.g. in a packaged build). spawn() inherits process.env by default
    // (no `env` override below), so the shell var reaches the child.
    const discoverEnv = process.env['NUDGE_WATCHER_DISCOVER']
    const discover = discoverEnv !== undefined ? discoverEnv !== '0' : !app.isPackaged
    if (discover) args.push('--discover')
    this.log(`spawning watcher: ${exe} ${args.join(' ')}`)

    let child: ChildProcess
    try {
      // stdin is a lifetime signal: EOF stops the helper if an installer or a
      // crash terminates Electron before its normal shutdown handlers run.
      child = spawn(exe, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    } catch (err) {
      this.log(`spawn failed: ${(err as Error).message}`)
      this.scheduleRestart()
      return
    }
    this.child = child

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const t = line.trim()
        if (t) this.log(`[watcher] ${t}`)
      }
    })
    child.on('error', (err) => this.log(`watcher process error: ${err.message}`))
    child.on('exit', (code, signal) => {
      this.log(`watcher exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      // Null the child FIRST so the socket 'close' handler won't try to reconnect.
      this.child = null
      this.teardownSocket()
      if (!this.disposed) this.scheduleRestart()
    })

    this.connectAttempts = 0
    this.connect()
  }

  private connect(): void {
    if (this.disposed || !this.child) return
    const pipePath = `\\\\.\\pipe\\${this.pipeName}`
    const socket = net.connect(pipePath)
    socket.setEncoding('utf8')

    socket.on('connect', () => {
      this.socket = socket
      this.connectAttempts = 0
      this.log('connected to watcher pipe')
      this.setAvailable(true)
    })
    socket.on('data', (chunk: string) => this.onData(chunk))
    // Errors surface as a following 'close'; handle retry/teardown there only.
    socket.on('error', () => {})
    socket.on('close', () => {
      const wasConnected = this.socket === socket
      if (wasConnected) this.socket = null
      if (this.disposed || !this.child) return

      if (wasConnected) {
        // Lost an established link but the child lives: the server loops back to
        // WaitForConnection, so reconnect promptly and quietly.
        this.connectAttempts = 0
        this.connectTimer = setTimeout(() => this.connect(), CONNECT_RETRY_DELAY_MS)
        return
      }
      // Never connected yet: the server may still be creating the pipe. Retry
      // up to a cap, then assume the child is wedged and cycle it.
      this.connectAttempts++
      if (this.connectAttempts <= CONNECT_RETRY_MAX) {
        this.connectTimer = setTimeout(() => this.connect(), CONNECT_RETRY_DELAY_MS)
      } else {
        this.log('could not connect to watcher pipe; recycling child')
        this.killChild() // its 'exit' handler schedules the restart
      }
    })
  }

  private scheduleRestart(): void {
    if (this.disposed) return
    // A healthy long run resets the counter so sporadic crashes don't add up.
    if (Date.now() - this.spawnedAt > STABLE_RUN_MS) this.failures = 0
    this.failures++

    if (this.failures > MAX_CONSECUTIVE_FAILURES) {
      this.setAvailable(
        false,
        `watcher failed ${this.failures - 1} times in a row; giving up (wander-only)`,
        true
      )
      return
    }

    const exe = this.resolveExe()
    if (!exe) {
      this.setAvailable(false, 'watcher executable not found — notifications disabled', true)
      return
    }

    const delay = Math.min(BASE_DELAY_MS * 2 ** (this.failures - 1), MAX_DELAY_MS)
    this.log(
      `restarting watcher in ${delay}ms (attempt ${this.failures}/${MAX_CONSECUTIVE_FAILURES})`
    )
    this.restartTimer = setTimeout(() => this.spawn(exe), delay)
  }

  // --- parsing ---------------------------------------------------------------
  private onData(chunk: string): void {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (line) this.handleLine(line)
    }
    // Defend against a pathological producer that never emits a newline.
    if (this.buffer.length > MAX_BUFFER_BYTES) this.buffer = ''
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.log('ignoring non-JSON line from watcher')
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return
    const msg = parsed as Record<string, unknown>

    if (msg.type === 'notification_appeared') {
      const id = typeof msg.id === 'string' ? msg.id : ''
      if (!id) return
      const b = msg.bounds
      if (typeof b !== 'object' || b === null) return
      const r = b as Record<string, unknown>
      // The watcher's C# Bounds record serializes PascalCase X/Y/Width/Height.
      const { X, Y, Width, Height } = r
      if (
        typeof X !== 'number' ||
        typeof Y !== 'number' ||
        typeof Width !== 'number' ||
        typeof Height !== 'number'
      ) {
        return
      }
      const point = msg.closePoint as { X?: unknown; Y?: unknown } | null | undefined
      const screenClosePoint =
        point &&
        typeof point.X === 'number' &&
        typeof point.Y === 'number' &&
        Number.isFinite(point.X) &&
        Number.isFinite(point.Y) &&
        point.X >= X &&
        point.X <= X + Width &&
        point.Y >= Y &&
        point.Y <= Y + Height
          ? { x: point.X, y: point.Y }
          : undefined
      this.opts.onAppeared({
        id,
        appId: typeof msg.appId === 'string' ? msg.appId : undefined,
        screenRect: { x: X, y: Y, width: Width, height: Height },
        screenClosePoint,
        interactive: msg.interactive === true,
        hasCloseButton: msg.hasCloseButton === true
      })
    } else if (msg.type === 'notification_closed') {
      const id = typeof msg.id === 'string' ? msg.id : ''
      if (id) this.opts.onClosed({ id })
    }
  }

  // --- helpers ---------------------------------------------------------------
  private setAvailable(available: boolean, reason?: string, force = false): void {
    if (this.available === available && !force) return
    this.available = available
    if (reason) this.log(reason)
    this.opts.onAvailabilityChange?.(available, reason)
  }

  private killChild(): void {
    const c = this.child
    if (!c) return
    try {
      c.kill()
    } catch {
      /* already gone */
    }
  }

  private teardownSocket(): void {
    const s = this.socket
    this.socket = null
    if (s) {
      try {
        s.destroy()
      } catch {
        /* best effort */
      }
    }
  }

  private clearTimers(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }
}

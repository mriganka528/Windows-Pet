import { execFile } from 'node:child_process'

// ---------------------------------------------------------------------------
// Webcam-in-use detection (Feature 3). "When the webcam turns on, the pet
// scurries under the camera, poses, then resumes."
// ---------------------------------------------------------------------------
// Windows records camera usage per app under the Capability Access Manager's
// ConsentStore. Each app subkey carries two FILETIME QWORDs:
//   • LastUsedTimeStart — when it most recently opened the camera
//   • LastUsedTimeStop  — when it released it, or 0 WHILE STILL HOLDING it
// So "some app is using the camera right now" == "a subkey has a non-zero
// Start and a Stop of exactly 0". We poll that subtree with `reg query` and
// reduce it to a single boolean.
//
// Why the registry (not a media API): the main process has no camera access and
// we never want any — reading the consent store needs no permission, touches no
// video, and can't capture a frame even in principle. The ONLY thing that leaves
// this module is an in-use boolean; the identity of the app and any imagery stay
// entirely out of the app (mirrors the notification watcher's "geometry only" and
// the audio path's "numbers only" rules).
//
// Degradation: if `reg` is missing, a key doesn't exist, or a query errors, we
// treat it as "not in use" and simply never trigger the pose — Nudge keeps
// roaming. Nothing here can take the app down.

const CONSENT_STORE_SUBPATH =
  'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam'

// Both hives: per-user apps (browsers, Zoom, Camera, and desktop apps under
// NonPackaged) live in HKCU; some all-users/service apps register in HKLM.
const WEBCAM_KEYS = [`HKCU\\${CONSENT_STORE_SUBPATH}`, `HKLM\\${CONSENT_STORE_SUBPATH}`]

const POLL_INTERVAL_MS = 1500
const QUERY_TIMEOUT_MS = 4000

/**
 * Decide whether any app currently holds the camera, from the text of
 * `reg query <consentStoreKey> /s`. Pure + exported so it's unit-testable without
 * a registry (the sandbox and CI have neither a camera nor Windows).
 *
 * Rule: walk each subkey; an app is live when it has a non-zero LastUsedTimeStart
 * AND a LastUsedTimeStop of exactly 0 (Windows zeroes the stop time for the
 * duration of a session and stamps it only on release). Grouping by subkey avoids
 * pairing one app's Start with another's Stop.
 */
export function webcamInUseFromRegQuery(stdout: string): boolean {
  if (!stdout) return false

  let start: bigint | null = null
  let stop: bigint | null = null
  let inUse = false

  // Finalize the subkey we just finished reading: a live session is Start≠0 with
  // Stop===0. Reset the pair for the next subkey.
  const flush = (): void => {
    if (start !== null && start !== 0n && stop === 0n) inUse = true
    start = null
    stop = null
  }

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    // A key header (e.g. "HKEY_CURRENT_USER\...\webcam\<app>") starts a new subkey.
    if (/^HKEY_/i.test(line)) {
      flush()
      continue
    }
    // Value rows look like: "LastUsedTimeStart    REG_QWORD    0x1d9abc..."
    const parts = line.split(/\s+/)
    if (parts.length >= 3 && parts[1].toUpperCase() === 'REG_QWORD') {
      const name = parts[0].toLowerCase()
      let val: bigint
      try {
        val = BigInt(parts[2]) // handles "0x0" and "0x1d9..." alike
      } catch {
        continue
      }
      if (name === 'lastusedtimestart') start = val
      else if (name === 'lastusedtimestop') stop = val
    }
  }
  flush() // finalize the last subkey (no trailing header to trigger it)
  return inUse
}

export interface WebcamWatcherOptions {
  /** Fires only on transitions (true when the camera goes in-use, false when it's
   *  released) — never every poll — so downstream can treat it as an edge. */
  onChange: (inUse: boolean) => void
  log?: (msg: string) => void
  /** Test seams. */
  intervalMs?: number
  /** Injectable query fn (defaults to `reg query`). Returns '' on any failure. */
  query?: (key: string) => Promise<string>
}

/**
 * Polls the ConsentStore on an interval and reports in-use transitions. Cheap:
 * the subtree is tiny, and we only diff a boolean. Start it when reactToWebcam is
 * on and Nudge isn't paused; dispose to stop (see main/index.ts wiring).
 */
export class WebcamWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private inUse = false
  private disposed = false
  private readonly log: (msg: string) => void
  private readonly intervalMs: number
  private readonly query: (key: string) => Promise<string>

  constructor(private readonly opts: WebcamWatcherOptions) {
    this.log = opts.log ?? ((): void => {})
    this.intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS
    this.query = opts.query ?? defaultRegQuery
  }

  /** Begin polling. Idempotent; safe to call after app is ready. */
  start(): void {
    if (this.disposed || this.timer) return
    // Kick once immediately so a camera already-on at launch is noticed promptly.
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.intervalMs)
  }

  /** Stop polling. Emits a final "off" if we were mid-session so nothing downstream
   *  stays stuck "posing". Idempotent. */
  dispose(): void {
    this.disposed = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.inUse) {
      this.inUse = false
      this.opts.onChange(false)
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.polling) return // never overlap slow queries
    this.polling = true
    try {
      let anyInUse = false
      for (const key of WEBCAM_KEYS) {
        const out = await this.query(key)
        if (out && webcamInUseFromRegQuery(out)) {
          anyInUse = true
          break // one live app is enough; skip the rest
        }
      }
      if (this.disposed) return
      if (anyInUse !== this.inUse) {
        this.inUse = anyInUse
        this.log(`webcam ${anyInUse ? 'in use' : 'released'}`)
        this.opts.onChange(anyInUse)
      }
    } finally {
      this.polling = false
    }
  }
}

/** `reg query <key> /s`, resolving to '' on any error (missing key, no `reg`,
 *  timeout). Never rejects — the caller treats empty as "nothing in use". */
function defaultRegQuery(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', key, '/s'],
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : stdout)
    )
  })
}

import { spawn, type ChildProcess } from 'node:child_process'
import { parseAudioLevel, type AudioLevel } from '../shared/audio'

interface SystemAudioOptions {
  resolveExecutable: () => string | null
  onLevel: (sample: AudioLevel) => void
  log?: (message: string) => void
  spawnProcess?: typeof spawn
}

/** Supervises the meter-only mode of the existing native helper. */
export class SystemAudioMonitor {
  private child: ChildProcess | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private failures = 0

  constructor(private readonly options: SystemAudioOptions) {}

  start(): void {
    if (this.disposed || this.child || this.restartTimer) return
    const executable = this.options.resolveExecutable()
    if (!executable) {
      this.options.onLevel({ level: 0, available: false })
      this.options.log?.(
        'Audio meter unavailable: build the native helper with npm run watcher:build.'
      )
      return
    }
    const spawnProcess = this.options.spawnProcess ?? spawn
    let child: ChildProcess
    try {
      child = spawnProcess(executable, ['--audio-meter'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch {
      this.failed()
      return
    }
    this.child = child
    let buffer = ''
    const began = Date.now()
    const fail = (): void => {
      if (this.child !== child) return
      this.child = null
      this.clearHeartbeat()
      this.stopChild(child)
      if (Date.now() - began > 20_000) this.failures = 0
      this.failed()
    }
    const armHeartbeat = (): void => {
      this.clearHeartbeat()
      this.heartbeatTimer = setTimeout(fail, 3000)
      this.heartbeatTimer.unref()
    }
    child.on('error', fail)
    child.on('exit', fail)
    child.stdin?.on('error', () => {}) // a shutdown racing with EOF is harmless
    child.stderr?.resume() // drain diagnostics without collecting device metadata
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (this.disposed || this.child !== child) return
      buffer += chunk
      if (buffer.length > 16 * 1024) {
        fail()
        return
      }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        const sample = parseAudioLevel(line)
        if (sample) {
          armHeartbeat()
          this.options.onLevel(sample)
        }
      }
    })
    armHeartbeat()
  }

  dispose(): void {
    this.disposed = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.clearHeartbeat()
    const child = this.child
    this.child = null
    if (child) this.stopChild(child)
  }

  private stopChild(child: ChildProcess): void {
    if (child.exitCode !== null || child.killed) return
    try {
      child.stdin?.end('stop\n')
    } catch {
      /* pipe already closed */
    }
    const force = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill()
    }, 1000)
    force.unref()
    child.once('exit', () => clearTimeout(force))
  }

  private failed(): void {
    if (this.disposed) return
    this.options.onLevel({ level: 0, available: false })
    if (++this.failures > 5) {
      this.options.log?.(
        'Audio meter stopped after repeated failures. Rebuild the native helper and restart Nudge.'
      )
      return
    }
    this.restartTimer = setTimeout(
      () => {
        this.restartTimer = null
        this.start()
      },
      Math.min(8000, 500 * 2 ** (this.failures - 1))
    )
    this.restartTimer.unref()
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}

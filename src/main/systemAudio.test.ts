import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess, spawn } from 'node:child_process'
import { SystemAudioMonitor } from './systemAudio'

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    exitCode: null as number | null,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true
      child.emit('exit', null, 'SIGTERM')
      return true
    })
  })
  return child
}

describe('system audio monitor', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('starts the hidden meter-only process and reads fragmented JSON lines', () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => child as unknown as ChildProcess)
    const onLevel = vi.fn()
    const monitor = new SystemAudioMonitor({
      resolveExecutable: () => 'watcher.exe',
      onLevel,
      spawnProcess: spawnProcess as typeof spawn
    })
    monitor.start()
    monitor.start()
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(spawnProcess).toHaveBeenCalledWith('watcher.exe', ['--audio-meter'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    child.stdout.write('{"type":"audio-level","level":')
    expect(onLevel).not.toHaveBeenCalled()
    child.stdout.write('0.4,"available":true}\r\n{"bad":true}\n')
    expect(onLevel).toHaveBeenCalledTimes(1)
    expect(onLevel).toHaveBeenCalledWith({ level: 0.4, available: true })
    monitor.dispose()
    expect(child.stdin.read().toString()).toBe('stop\n')
    child.stdout.write('{"type":"audio-level","level":0.8,"available":true}\n')
    expect(onLevel).toHaveBeenCalledTimes(1)
    child.exitCode = 0
    child.emit('exit', 0)
    vi.advanceTimersByTime(20000)
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
  })
  it('reports an unavailable helper without opening another audio source', () => {
    const spawnProcess = vi.fn()
    const onLevel = vi.fn()
    const monitor = new SystemAudioMonitor({
      resolveExecutable: () => null,
      onLevel,
      spawnProcess: spawnProcess as typeof spawn
    })
    monitor.start()
    expect(onLevel).toHaveBeenCalledWith({ level: 0, available: false })
    expect(spawnProcess).not.toHaveBeenCalled()
    monitor.dispose()
  })
  it('recovers from a stalled helper and ignores late output from the old process', () => {
    const first = fakeChild()
    const second = fakeChild()
    const spawnProcess = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
    const onLevel = vi.fn()
    const monitor = new SystemAudioMonitor({
      resolveExecutable: () => 'watcher.exe',
      onLevel,
      spawnProcess: spawnProcess as typeof spawn
    })
    monitor.start()
    vi.advanceTimersByTime(3500)
    expect(onLevel).toHaveBeenCalledWith({ level: 0, available: false })
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    first.stdout.write('{"type":"audio-level","level":0.6,"available":true}\n')
    expect(onLevel).toHaveBeenCalledTimes(1)
    second.stdout.write('{"type":"audio-level","level":0.2,"available":true}\n')
    expect(onLevel).toHaveBeenLastCalledWith({ level: 0.2, available: true })
    monitor.dispose()
    vi.advanceTimersByTime(1500)
    expect(first.kill).toHaveBeenCalledOnce()
    expect(second.kill).toHaveBeenCalledOnce()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationForeground } from './notificationForeground'

afterEach(() => vi.useRealTimers())

describe('notification window ordering', () => {
  it('raises each reaction once without continuously fighting the shell window order', () => {
    vi.useFakeTimers()
    const win = { isDestroyed: () => false, setAlwaysOnTop: vi.fn(), moveTop: vi.fn() }
    const foreground = new NotificationForeground(() => win)
    foreground.setActive(true)
    foreground.setActive(true)
    vi.advanceTimersByTime(300)
    expect(win.moveTop).toHaveBeenCalledTimes(1)
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'screen-saver')
    foreground.setActive(false)
    vi.advanceTimersByTime(500)
    expect(win.moveTop).toHaveBeenCalledTimes(1)
    foreground.setActive(true)
    expect(win.moveTop).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops if the overlay is destroyed or absent', () => {
    vi.useFakeTimers()
    let destroyed = false
    const win = { isDestroyed: () => destroyed, setAlwaysOnTop: vi.fn(), moveTop: vi.fn() }
    const foreground = new NotificationForeground(() => win)
    foreground.setActive(true)
    destroyed = true
    foreground.raise()
    expect(win.moveTop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    new NotificationForeground(() => null).setActive(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

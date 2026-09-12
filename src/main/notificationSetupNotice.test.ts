import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { EventEmitter } from 'node:events'

interface TestWindow extends EventEmitter {
  webContents: object
  showInactive: Mock
  close: Mock
  isDestroyed(): boolean
}
type Handler = (event: { sender: unknown }) => unknown
const state = vi.hoisted(() => ({
  packaged: true,
  seen: false,
  windows: [] as TestWindow[],
  events: new Map<string, Handler>(),
  invokes: new Map<string, Handler>(),
  markSeen: vi.fn(),
  openExternal: vi.fn(),
  openAppSettings: vi.fn()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: {
      get isPackaged() {
        return state.packaged
      }
    },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    shell: { openExternal: state.openExternal },
    ipcMain: {
      on: (name: string, handler: Handler) => state.events.set(name, handler),
      handle: (name: string, handler: Handler) => state.invokes.set(name, handler),
      removeListener: (name: string) => state.events.delete(name),
      removeHandler: (name: string) => state.invokes.delete(name)
    },
    BrowserWindow: class extends EventEmitter {
      webContents = {}
      destroyed = false
      showInactive = vi.fn()
      setAlwaysOnTop = vi.fn()
      loadFile = vi.fn().mockResolvedValue(undefined)
      loadURL = vi.fn().mockResolvedValue(undefined)
      close = vi.fn(() => {
        this.destroyed = true
        this.emit('closed')
      })
      isDestroyed(): boolean {
        return this.destroyed
      }
      constructor() {
        super()
        state.windows.push(this)
      }
    }
  }
})
vi.mock('./settingsStore', () => ({
  hasSeenNotificationSetupNotice: () => state.seen,
  markNotificationSetupNoticeSeen: () => {
    state.seen = true
    state.markSeen()
  }
}))
import { NotificationSetupNotice } from './notificationSetupNotice'

describe('notification setup window', () => {
  let notice: NotificationSetupNotice
  beforeEach(() => {
    vi.clearAllMocks()
    state.packaged = true
    state.seen = false
    state.windows = []
    state.events.clear()
    state.invokes.clear()
    state.openExternal.mockResolvedValue(undefined)
    notice = new NotificationSetupNotice(state.openAppSettings)
  })
  afterEach(() => notice.dispose())

  it('records the first launch only after the window actually appears, and does not repeat it', () => {
    notice.showOnce()
    notice.showOnce()
    expect(state.windows).toHaveLength(1)
    expect(state.markSeen).not.toHaveBeenCalled()
    state.windows[0].emit('ready-to-show')
    expect(state.windows[0].showInactive).toHaveBeenCalled()
    expect(state.markSeen).toHaveBeenCalledOnce()
    state.windows[0].close()
    notice.showOnce()
    expect(state.windows).toHaveLength(1)
  })

  it('keeps a failed or closed-before-display notice pending for the next launch', () => {
    notice.showOnce()
    state.windows[0].close()
    state.windows[0].emit('ready-to-show')
    expect(state.markSeen).not.toHaveBeenCalled()
    notice.showOnce()
    expect(state.windows).toHaveLength(2)
  })

  it('allows reopening from the tray even when already seen, without auto-showing in dev', () => {
    state.packaged = false
    notice.showOnce()
    expect(state.windows).toHaveLength(0)
    notice.show()
    state.windows[0].emit('ready-to-show')
    expect(state.markSeen).not.toHaveBeenCalled()
    state.windows[0].close()
    state.seen = true
    state.packaged = true
    notice.show()
    expect(state.windows).toHaveLength(2)
  })

  it('rejects requests from other renderers', async () => {
    notice.show()
    const other = { sender: {} }
    state.events.get('notification-setup:dismiss')!(other)
    state.events.get('notification-setup:open-app-settings')!(other)
    expect(await state.invokes.get('notification-setup:open-windows-settings')!(other)).toBe(false)
    expect(state.windows[0].close).not.toHaveBeenCalled()
    expect(state.openExternal).not.toHaveBeenCalled()
    expect(state.openAppSettings).not.toHaveBeenCalled()
  })

  it('opens only the fixed Windows page, and can close the notice to show app settings', async () => {
    notice.show()
    const own = { sender: state.windows[0].webContents }
    expect(await state.invokes.get('notification-setup:open-windows-settings')!(own)).toBe(true)
    expect(state.openExternal).toHaveBeenCalledOnce()
    expect(state.openExternal).toHaveBeenCalledWith('ms-settings:notifications')
    state.events.get('notification-setup:open-app-settings')!(own)
    expect(state.openAppSettings).toHaveBeenCalledOnce()
    expect(state.windows[0].close).toHaveBeenCalledOnce()
  })

  it('reports a failed settings launch, and dismisses only its own window', async () => {
    notice.show()
    state.openExternal.mockRejectedValueOnce(new Error('Settings unavailable'))
    const own = { sender: state.windows[0].webContents }
    expect(await state.invokes.get('notification-setup:open-windows-settings')!(own)).toBe(false)
    state.events.get('notification-setup:dismiss')!(own)
    expect(state.windows[0].close).toHaveBeenCalledOnce()
  })
})

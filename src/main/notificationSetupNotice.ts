import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'
import { hasSeenNotificationSetupNotice, markNotificationSetupNoticeSeen } from './settingsStore'

/** An app window, so Windows DND cannot suppress this setup reminder as a toast. */
export class NotificationSetupNotice {
  private window: BrowserWindow | null = null

  constructor(
    private readonly openAppSettings: () => void,
    private readonly rendererDevUrl?: string
  ) {
    ipcMain.on('notification-setup:dismiss', this.dismiss)
    ipcMain.on('notification-setup:open-app-settings', this.openSettings)
    ipcMain.handle('notification-setup:open-windows-settings', this.openWindowsSettings)
  }

  showOnce(): void {
    if (app.isPackaged && !hasSeenNotificationSetupNotice()) this.show()
  }

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive()
      return
    }
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(448, area.width - 32)
    const height = Math.min(510, area.height - 32)
    const window = new BrowserWindow({
      width,
      height,
      x: area.x + area.width - width - 16,
      y: area.y + area.height - height - 16,
      title: 'Nudge — Notification setup',
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      backgroundColor: '#fbfaf6',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.window = window
    window.setAlwaysOnTop(true, 'screen-saver')
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return
      window.showInactive()
      if (app.isPackaged) markNotificationSetupNoticeSeen()
    })
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })
    if (this.rendererDevUrl && !app.isPackaged) {
      void window.loadURL(`${this.rendererDevUrl}/notification-setup.html`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/notification-setup.html'))
    }
  }

  private isNoticeSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents
  }

  private dismiss = (event: IpcMainEvent): void => {
    if (this.isNoticeSender(event)) this.window?.close()
  }

  private openSettings = (event: IpcMainEvent): void => {
    if (!this.isNoticeSender(event)) return
    this.window?.close()
    this.openAppSettings()
  }

  private openWindowsSettings = async (event: IpcMainInvokeEvent): Promise<boolean> => {
    if (!this.isNoticeSender(event)) return false
    try {
      // A fixed Windows Settings page; never accept a URL from the renderer.
      await shell.openExternal('ms-settings:notifications')
      return true
    } catch {
      return false
    }
  }

  dispose(): void {
    ipcMain.removeListener('notification-setup:dismiss', this.dismiss)
    ipcMain.removeListener('notification-setup:open-app-settings', this.openSettings)
    ipcMain.removeHandler('notification-setup:open-windows-settings')
    this.window?.close()
  }
}

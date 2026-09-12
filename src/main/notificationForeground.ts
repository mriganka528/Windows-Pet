import type { BrowserWindow } from 'electron'

type Overlay = Pick<BrowserWindow, 'isDestroyed' | 'setAlwaysOnTop' | 'moveTop'>

/** Raise within the process's Windows band without taking keyboard focus.
 * UIAccess is enabled on the signed installed executable; repeatedly raising a
 * normal desktop window cannot move it above the shell's notification band. */
export class NotificationForeground {
  private active = false

  constructor(private readonly window: () => Overlay | null) {}

  raise(): void {
    const win = this.window()
    if (!win || win.isDestroyed()) {
      this.stop()
      return
    }
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }

  setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    if (active) this.raise()
  }

  stop(): void {
    this.active = false
  }
}

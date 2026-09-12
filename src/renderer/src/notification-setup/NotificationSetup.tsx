import { useEffect, useState } from 'react'
import {
  NOTIFICATION_SETUP,
  NOTIFICATION_SETUP_TIMEOUT_SECONDS
} from '../../../shared/notificationSetup'

export function NotificationSetup(): React.JSX.Element {
  const [seconds, setSeconds] = useState(NOTIFICATION_SETUP_TIMEOUT_SECONDS)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState('')
  const paused = hovered || focused

  useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [paused])

  useEffect(() => {
    if (seconds === 0) window.nudge.dismissNotificationSetup()
  }, [seconds])

  useEffect(() => {
    const blur = (): void => {
      setFocused(false)
      setHovered(false)
    }
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.nudge.dismissNotificationSetup()
    }
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', keydown)
    }
  }, [])

  async function openWindowsSettings(): Promise<void> {
    try {
      const opened = await window.nudge.openWindowsNotificationSettings()
      setError(opened ? '' : 'Open Windows Settings → System → Notifications manually.')
    } catch {
      setError('Open Windows Settings → System → Notifications manually.')
    }
  }

  return (
    <main
      className="setup-notice"
      aria-labelledby="notice-title"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <header className="notice-brand">
        <span className="notice-paw" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <ellipse cx="5.5" cy="8" rx="2.5" ry="3.3" transform="rotate(-25 5.5 8)" />
            <ellipse cx="11.5" cy="5" rx="2.5" ry="3.3" />
            <ellipse cx="18" cy="8" rx="2.5" ry="3.3" transform="rotate(25 18 8)" />
            <path d="M5 17c0-3 4-7 7-7s7 4 7 7c0 5-5 3-7 3s-7 2-7-3Z" />
          </svg>
        </span>
        <strong>Nudge</strong>
        <span className="notice-eyebrow">A QUICK SETUP TIP</span>
        <button
          className="notice-close"
          aria-label="Close notification setup"
          onClick={() => window.nudge.dismissNotificationSetup()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </header>
      <h1 id="notice-title">{NOTIFICATION_SETUP.title}</h1>
      <p className="notice-intro">{NOTIFICATION_SETUP.message}</p>
      <ol className="notice-steps">
        <li>
          <span>1</span>
          <div>
            <h2>Turn off DND in Windows</h2>
            <p>{NOTIFICATION_SETUP.windows11}</p>
            <p>{NOTIFICATION_SETUP.windows10}</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h2>Choose Auto-close in Nudge</h2>
            <p>{NOTIFICATION_SETUP.autoClose}</p>
          </div>
        </li>
      </ol>
      <p className="notice-reminder">{NOTIFICATION_SETUP.reminder}</p>
      <div className="notice-actions">
        <button className="notice-primary" onClick={() => void openWindowsSettings()}>
          Windows notification settings <span aria-hidden="true">↗</span>
        </button>
        <button
          className="notice-secondary"
          onClick={() => window.nudge.openNotificationSetupSettings()}
        >
          Nudge settings
        </button>
      </div>
      {error && (
        <p className="notice-error" role="status">
          {error}
        </p>
      )}
      <footer className="notice-footer">
        <span>{paused ? 'Timer paused while you interact' : `Closes in ${seconds}s`}</span>
        <button onClick={() => window.nudge.dismissNotificationSetup()}>Got it</button>
      </footer>
      <p className="notice-reopen">
        Find this tip again: paw in the system tray → Notification setup.
      </p>
    </main>
  )
}

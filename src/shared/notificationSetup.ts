// Shared wording keeps the application notice and product website consistent.
// This is guidance, not a claim that we detected or changed Windows' DND state.
export const NOTIFICATION_SETUP = {
  title: 'Let your pet close notifications',
  message:
    'Windows may turn on Do not disturb automatically. When it hides notification banners, your pet cannot interact with them on screen.',
  windows11: 'Windows 11: Settings → System → Notifications → Do not disturb → Off.',
  windows10: 'Windows 10: Settings → System → Focus assist → Off.',
  autoClose: 'In Nudge Settings → Behavior, choose “Close them for me” (Auto-close).',
  reminder: 'Keep notification banners enabled for the apps you want Nudge to react to.'
} as const

export const NOTIFICATION_SETUP_TIMEOUT_SECONDS = 25

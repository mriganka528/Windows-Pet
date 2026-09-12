import type { CharacterId } from '../../src/shared/settings'
import { NOTIFICATION_SETUP } from '../../src/shared/notificationSetup'
import type { IconName } from './Icon'

export const friends: { id: CharacterId; name: string; description: string; color: string }[] = [
  { id: 'cat', name: 'Cat', description: 'A little curious. A little cozy.', color: '#f4e8d5' },
  { id: 'dog', name: 'Dog', description: 'Your most enthusiastic coworker.', color: '#ede7d9' },
  { id: 'fox', name: 'Fox', description: 'A bright spark for your screen.', color: '#f2e0d6' },
  { id: 'bunny', name: 'Bunny', description: 'Small hops. Plenty of heart.', color: '#e7e6ef' },
  { id: 'panda', name: 'Panda', description: 'An expert in taking it easy.', color: '#e3eadf' },
  { id: 'bear', name: 'Bear', description: 'Big cozy energy, tiny footprint.', color: '#eaded2' },
  {
    id: 'penguin',
    name: 'Penguin',
    description: 'A very well-dressed little waddle.',
    color: '#e1e9ed'
  },
  {
    id: 'redpanda',
    name: 'Red panda',
    description: 'A fluffy tail and a friendly face.',
    color: '#eeded2'
  },
  { id: 'hamster', name: 'Hamster', description: 'Pocket-sized desk company.', color: '#f2e8cc' },
  { id: 'frog', name: 'Frog', description: 'A fresh hop in your routine.', color: '#e0e9d5' },
  {
    id: 'tiger',
    name: 'Tiger',
    description: 'A small friend with bold stripes.',
    color: '#f4e4cd'
  },
  { id: 'koala', name: 'Koala', description: 'Always up for a quiet moment.', color: '#e4e7e6' },
  { id: 'pig', name: 'Pig', description: 'A rosy little ray of sunshine.', color: '#f0dee1' },
  { id: 'mouse', name: 'Mouse', description: 'The other mouse on your desktop.', color: '#e7e2ec' },
  { id: 'chick', name: 'Chick', description: 'A little sunshine, all day long.', color: '#f3eccf' }
]

export const guides: {
  id: string
  title: string
  icon: IconName
  heading: string
  intro: string
  steps: { title: string; text: string }[]
  note?: string
}[] = [
  {
    id: 'install',
    title: 'Getting started',
    icon: 'download',
    heading: 'From download to desk mate.',
    intro: 'A few clicks, and a little friend moves in. No account or extra runtimes required.',
    steps: [
      {
        title: 'Download & install',
        text: 'Download the Windows installer, then open it on a Windows 10 or 11 x64 PC. Nudge installs for your user and creates desktop and Start menu shortcuts.'
      },
      {
        title: 'Say hello',
        text: 'Your pet appears when installation finishes. A first-launch tip explains Do not disturb and Auto-close; it closes after 25 seconds, pauses while you interact, or you can dismiss it. Reopen it from the tray’s Notification setup menu.'
      },
      {
        title: 'Make it yours',
        text: 'Right-click the paw icon in the Windows system tray and choose Settings. Pick your animal, color, size, and default mood.'
      }
    ],
    note: 'This early release is unsigned. Windows may show “Unknown publisher” or SmartScreen. Check the download source and the SHA-256 checksum before running it.'
  },
  {
    id: 'controls',
    title: 'Pet, move & sleep',
    icon: 'mouse',
    heading: 'Little gestures. Lots of personality.',
    intro: 'Nudge keeps the everyday interactions simple, so your pet fits into your day.',
    steps: [
      {
        title: 'A click is a little kindness',
        text: 'Left-click your pet to make it happy. Click and hold to drag it, then release to let it wander from its new spot.'
      },
      {
        title: 'Give your friend a break',
        text: 'Right-click the pet to send it to its sleeping corner. Left-click again to wake it, or to cancel its walk to bed.'
      },
      {
        title: 'Set the pace',
        text: 'In Settings → Movement & sleep, choose one of four sleeping corners and adjust wandering speed from 25% to 200%. Tray → Pause temporarily stops behavior and reactions.'
      }
    ],
    note: 'Sleeping pets stay asleep through notifications, music, and webcam activity. You decide when to wake them.'
  },
  {
    id: 'personalize',
    title: 'Make it your own',
    icon: 'sliders',
    heading: 'Your companion. Your kind of cozy.',
    intro: 'All 15 characters are included. Change your mind as often as you like.',
    steps: [
      {
        title: 'Find your favorite face',
        text: 'Open Settings → Appearance to choose your character. The app includes cats, dogs, foxes, bunnies, pandas, and ten more friends.'
      },
      {
        title: 'Choose a look & personality',
        text: 'Try 15 coat options for each animal, three sizes, and seven default moods. Your changes appear immediately and save on your device.'
      },
      {
        title: 'Settle into your routine',
        text: 'In General, choose reduced motion or enable Start with Windows if you want Nudge to greet you at sign-in. You can turn music and webcam reactions off here too.'
      }
    ]
  },
  {
    id: 'reactions',
    title: 'Music & notifications',
    icon: 'bell',
    heading: 'A little more in tune with your day.',
    intro: 'Pick which moments your companion reacts to. You stay in control.',
    steps: [
      {
        title: 'Let the music move them',
        text: 'Music reactions are enabled by default. Nudge responds to Windows playback levels without recording your audio or starting screen sharing.'
      },
      {
        title: 'Choose your notification style',
        text: `The default Nudge mode notices notifications and reacts. ${NOTIFICATION_SETUP.autoClose} Auto-close tries to dismiss notifications after the pet reaches them.`
      },
      {
        title: 'Turn off DND & allow notification banners',
        text: `${NOTIFICATION_SETUP.windows11} ${NOTIFICATION_SETUP.windows10} Keep app notification banners enabled and allow notification access if Windows asks.`
      }
    ],
    note: `${NOTIFICATION_SETUP.message} Auto-close can dismiss interactive notifications too; leave it off if you prefer to handle notifications yourself.`
  },
  {
    id: 'help',
    title: 'A little help',
    icon: 'book',
    heading: 'Get your friend back on its feet.',
    intro: 'A few useful places to look if something seems quiet or out of place.',
    steps: [
      {
        title: 'Can’t find the pet?',
        text: 'Look for the paw in the system tray, including the hidden-icons menu. Open Settings, check whether Nudge is paused, or quit and reopen it from the Start menu.'
      },
      {
        title: 'Not reacting to notifications?',
        text: 'Check that Windows Do not disturb (Focus assist on Windows 10) is off and app notification banners are enabled. Make sure the pet is awake and unpaused, review notification access, and choose “Close them for me” in Nudge Settings → Behavior for automatic closing. Some system notifications can remain above the standard overlay.'
      },
      {
        title: 'Quit, update, or uninstall',
        text: 'Use tray → Quit Nudge to close the app. To update, quit it and run the newer installer. To remove it, use Windows Settings → Apps → Installed apps → Nudge → Uninstall.'
      }
    ],
    note: 'You do not need to install Node.js or .NET separately. The Windows installer includes everything the app needs to run.'
  }
]

export const faqs = [
  {
    q: 'Should I turn off Do not disturb for Auto-close?',
    a: `${NOTIFICATION_SETUP.message} ${NOTIFICATION_SETUP.windows11} ${NOTIFICATION_SETUP.windows10} ${NOTIFICATION_SETUP.autoClose} This is a setup reminder; Nudge does not turn DND off for you.`
  },
  {
    q: 'What exactly is Nudge?',
    a: 'Nudge is an illustrated animal companion that lives on your Windows desktop. It roams across your screen, responds to pets and drags, takes naps, and can react to music, camera use, and Windows notifications.'
  },
  {
    q: 'Will it get in the way of my work?',
    a: 'The overlay lets clicks pass through to your apps when you’re not interacting with the pet. You can move it, change its size or wandering speed, send it to sleep, or pause it from the system tray whenever you need a quieter screen.'
  },
  {
    q: 'Which computers does it work on?',
    a: 'The current download is for Windows 10 and Windows 11 on x64 PCs. There are no macOS, Linux, or native ARM64 builds in this release. You don’t need to install Node.js or .NET; both runtimes are bundled.'
  },
  {
    q: 'Does it record my audio or use my camera?',
    a: 'No. Music reactions read Windows playback levels; they don’t record audio or use your microphone. Webcam reactions only check whether a camera is in use; Nudge doesn’t open it or access its images. You can turn either reaction off in Settings.'
  },
  {
    q: 'Does it read my notifications?',
    a: 'The notification helper uses an app name, notification identifier, and position information. It does not read notification titles or message bodies. Notification access is controlled by Windows. Auto-close is optional and off by default.'
  },
  {
    q: 'Why does Windows show an unknown publisher warning?',
    a: 'Version 0.1.0 is an unsigned early release. Windows may display Unknown publisher or SmartScreen because it has no trusted publisher signature. Check the source and SHA-256 checksum of the download. Do not disable Windows security protections to install it.'
  },
  {
    q: 'Can I keep my settings when I update?',
    a: 'Your preferences are saved locally. Install the new version over the existing app to keep using them. The current uninstaller also preserves preferences, so your choices are available if you install Nudge again.'
  }
]

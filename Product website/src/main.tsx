import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MOOD_LABELS, MOOD_ORDER, THEME_ORDER } from '../../src/shared/settings'
import { NOTIFICATION_SETUP } from '../../src/shared/notificationSetup'
import type { CharacterId, ColorThemeId, MoodDefault } from '../../src/shared/settings'
import { coatLabel, coatPalette } from '../../src/renderer/src/companion/coats'
import { speciesFor } from '../../src/renderer/src/companion/species'
import { Desktop } from './Desktop'
import { Icon } from './Icon'
import { Pet } from './Pet'
import { friends, guides, faqs } from './content'
import release from './release.json'
import './styles.css'

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`
const downloadUrl =
  release.downloadMode === 'local' ? asset(release.downloadUrl) : release.downloadUrl
type ModalState =
  | { type: 'privacy' | 'release' | 'checksum' }
  | { type: 'image'; src: string; title: string; caption: string }
  | null

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <a className={`wordmark ${light ? 'wordmark-light' : ''}`} href="#home" aria-label="Nudge home">
      <span className="brand-mark">
        <Icon name="paw" size={23} />
      </span>
      nudge<span className="brand-period">.</span>
    </a>
  )
}

function DownloadLink({
  children = 'Download for Windows',
  className = '',
  compact = false
}: {
  children?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <a
      className={`button button-primary ${className}`}
      href={downloadUrl}
      download={release.fileName}
    >
      <Icon name={compact ? 'download' : 'windows'} size={compact ? 17 : 19} />
      <span>{children}</span>
      {!compact && <Icon name="arrow" size={19} />}
    </a>
  )
}

function SectionLabel({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <p className={`section-label ${light ? 'label-light' : ''}`}>
      <span />
      {children}
    </p>
  )
}

function SiteModal({ content, onClose }: { content: ModalState; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    if (!content) return
    setCopied('')
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [content])
  if (!content) return null
  const title =
    content.type === 'image'
      ? content.title
      : content.type === 'privacy'
        ? 'A companion that stays local.'
        : content.type === 'release'
          ? `What’s in Nudge ${release.version}`
          : 'Know what you’re downloading.'
  return (
    <dialog
      ref={dialog}
      className={`site-modal ${content.type === 'image' ? 'image-modal' : ''}`}
      aria-labelledby="modal-title"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-content">
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>
        {content.type === 'image' && (
          <>
            <p>{content.caption}</p>
            <img className="expanded-image" src={content.src} alt={content.title} />
          </>
        )}
        {content.type === 'privacy' && (
          <div className="prose">
            <p>
              Nudge works on your desktop without an account. Your pet preferences are saved on your
              own computer.
            </p>
            <h3>Music, without recording</h3>
            <p>
              The app reads the level of Windows audio playback. It does not record audio, use the
              microphone, or start screen sharing.
            </p>
            <h3>Camera reactions, without camera images</h3>
            <p>
              Nudge checks whether a webcam is in use. It does not open the camera or access frames
              or photos.
            </p>
            <h3>Notification reactions</h3>
            <p>
              The helper uses notification identifiers, app names, and screen positions. It does not
              read notification titles or message bodies. Access is controlled by Windows, and
              automatic dismissal is an optional setting.
            </p>
            <h3>About this website</h3>
            <p>
              This website has no analytics, tracking pixels, advertising scripts, or account
              system. Interactive previews run in your browser and do not request notification,
              microphone, or camera access.
            </p>
          </div>
        )}
        {content.type === 'release' && (
          <div className="prose">
            <p className="release-label">WINDOWS RELEASE · VERSION {release.version}</p>
            <p>A little company for Windows 10 and 11 x64 desktops.</p>
            <ul>
              <li>
                A dismissible first-launch notification setup tip with a 25-second timer and Windows
                DND guidance.
              </li>
              <li>15 animals, 15 coat choices per animal, three sizes, and seven default moods.</li>
              <li>
                Roaming, click-to-pet, dragging, sleep and wake, and adjustable wandering speed.
              </li>
              <li>Music and webcam-use reactions, with individual controls in Settings.</li>
              <li>Default notification reactions and optional Auto-close mode.</li>
              <li>Local preferences, optional launch at sign-in, and a system tray menu.</li>
              <li>An installer with the required runtimes included.</li>
            </ul>
            <h3>Things to know</h3>
            <p>
              This version is unsigned. Windows may show a publisher warning. Notification access
              and detection vary by Windows version, and some system notifications can appear above
              the pet.
            </p>
            <DownloadLink compact>Download version {release.version}</DownloadLink>
          </div>
        )}
        {content.type === 'checksum' && (
          <div className="prose">
            <p>
              Version {release.version} · Windows x64 · {release.size}
            </p>
            <p>
              The SHA-256 checksum identifies the exact Nudge installer for this release. Compare it
              with your downloaded file before opening it.
            </p>
            <label className="hash-label" htmlFor="checksum">
              SHA-256
            </label>
            <textarea
              id="checksum"
              className="checksum-value"
              value={release.sha256}
              readOnly
              rows={3}
              spellCheck={false}
            />
            <button
              className="button button-outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(release.sha256)
                  setCopied('Checksum copied.')
                } catch {
                  setCopied('Select and copy the checksum above.')
                }
              }}
            >
              <Icon name="copy" size={17} />
              Copy checksum
            </button>
            <p className="copy-status" role="status">
              {copied}
            </p>
            <h3>Check it in PowerShell</h3>
            <code className="code-block">Get-FileHash .\{release.fileName} -Algorithm SHA256</code>
            <p>
              A matching checksum confirms the file is the same; it does not replace a publisher
              signature. This release is unsigned.
            </p>
            <a className="text-link" href={asset('downloads/SHA256SUMS.txt')} download>
              Download checksum file <Icon name="arrow" size={16} />
            </a>
          </div>
        )}
      </div>
    </dialog>
  )
}

function App() {
  const [character, setCharacter] = useState<CharacterId>('cat')
  const [coat, setCoat] = useState<ColorThemeId>('natural')
  const [mood, setMood] = useState<MoodDefault>('happy')
  const [allFriends, setAllFriends] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [guideId, setGuideId] = useState('install')
  const [modal, setModal] = useState<ModalState>(null)
  const [dancing, setDancing] = useState(true)
  const [waving, setWaving] = useState(false)
  const currentFriend = friends.find((friend) => friend.id === character)!
  const currentGuide = guides.find((guide) => guide.id === guideId)!
  const species = speciesFor(character)
  const visibleFriends = allFriends ? friends : friends.slice(0, 5)

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start'
    })
    setMenuOpen(false)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header" id="home">
        <div className="header-inner">
          <Wordmark />
          <nav
            className={`main-nav ${menuOpen ? 'is-open' : ''}`}
            id="main-navigation"
            aria-label="Main navigation"
          >
            <a href="#features" onClick={() => setMenuOpen(false)}>
              The little things
            </a>
            <a href="#companions" onClick={() => setMenuOpen(false)}>
              Meet the pets
            </a>
            <a href="#guide" onClick={() => setMenuOpen(false)}>
              The field guide
            </a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>
              FAQs
            </a>
          </nav>
          <div className="header-actions">
            <DownloadLink compact className="header-download">
              Get Nudge
            </DownloadLink>
            <button
              className="icon-button mobile-menu"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              aria-controls="main-navigation"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero section-container" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-eyebrow">
              <span className="tiny-sun">
                <Icon name="sun" size={17} />
              </span>
              A SMALL FRIEND FOR YOUR EVERYDAY SCREEN
            </p>
            <h1 id="hero-title">
              A little company.
              <br />A <em>happier</em>
              <br className="desktop-break" /> desktop<span className="title-dot">.</span>
            </h1>
            <p className="hero-description">
              Meet Nudge. A tiny companion that wanders your Windows desktop, dances to your music,
              and makes the everyday a little less ordinary.
            </p>
            <div className="hero-actions">
              <DownloadLink />
              <a className="hero-secondary" href="#companions">
                Find your little friend <Icon name="arrow" size={18} />
              </a>
            </div>
            <p className="download-meta">
              Windows 10 & 11 <span>·</span> x64 <span>·</span> v{release.version} <span>·</span>{' '}
              {release.size}
            </p>
            <div className="hero-reassurance">
              <span>
                <Icon name="check" size={14} />
                No account needed
              </span>
              <span>
                <Icon name="check" size={14} />
                All 15 pets included
              </span>
            </div>
          </div>
          <Desktop
            character={character}
            coat={coat}
            mood={mood}
            onMeetFriends={() => jumpTo('companions')}
          />
        </section>

        <div className="little-promise section-container">
          <span className="promise-intro">
            <Icon name="paw" size={20} />
            Small on your screen.
            <br />
            <strong>Big on personality.</strong>
          </span>
          <span>
            <b>15</b> little companions
          </span>
          <span>
            <b>15</b> coats for every pet
          </span>
          <span>
            <b>7</b> different moods
          </span>
          <span className="promise-local">
            <Icon name="shield" size={21} />
            Happily at home
            <br />
            <strong>on your computer</strong>
          </span>
        </div>

        <section
          className="companions-section section-container section-space"
          id="companions"
          aria-labelledby="companions-title"
        >
          <div className="section-heading">
            <div>
              <SectionLabel>GOOD COMPANY COMES IN ALL SHAPES</SectionLabel>
              <h2 id="companions-title">
                Find your kind of <em>little friend.</em>
              </h2>
            </div>
            <p>
              A familiar face or a wonderfully unexpected one.
              <br />
              Go on, pick the one that feels like you.
            </p>
          </div>
          <div className="friend-grid" aria-label="Choose your companion">
            {visibleFriends.map((friend) => (
              <button
                className={`friend-card ${friend.id === character ? 'is-selected' : ''}`}
                key={friend.id}
                style={{ '--friend-color': friend.color } as CSSProperties}
                aria-pressed={friend.id === character}
                onClick={() => {
                  setCharacter(friend.id)
                  setCoat('natural')
                }}
              >
                <span className="friend-selected">
                  <Icon name="check" size={12} />
                </span>
                <Pet id={friend.id} size={112} still />
                <span className="friend-name">{friend.name}</span>
                <span className="friend-card-arrow">
                  <Icon name="arrow" size={16} />
                </span>
              </button>
            ))}
          </div>
          <div className="friend-grid-footer">
            <p>
              <span className="live-dot" />
              {currentFriend.name} is keeping you company in the preview.
            </p>
            <button
              className="text-link"
              onClick={() => setAllFriends((value) => !value)}
              aria-expanded={allFriends}
            >
              {allFriends ? 'Show the first five' : 'Meet all 15 companions'}
              <Icon name="chevron" size={17} className={allFriends ? 'rotate-icon' : ''} />
            </button>
          </div>
          <div className="customizer">
            <div
              className="customizer-pet"
              style={{ '--friend-color': currentFriend.color } as CSSProperties}
            >
              <span className="customizer-sparkle sparkle-one">✧</span>
              <Pet id={character} coat={coat} mood={mood} size={174} />
              <span className="customizer-sparkle sparkle-two">✦</span>
              <div>
                <span className="small-label">YOUR CURRENT DESK MATE</span>
                <h3>
                  {currentFriend.name}
                  <span> / </span>
                  {MOOD_LABELS[mood]}
                </h3>
                <p>{currentFriend.description}</p>
              </div>
            </div>
            <div className="customizer-options">
              <div className="option-heading">
                <h3>
                  A little more <em>you.</em>
                </h3>
                <span>Try it here. Make it yours in the app.</span>
              </div>
              <fieldset className="coat-options">
                <legend>
                  01 <span>Pick a coat</span>
                  <strong>{coatLabel(species, coat)}</strong>
                </legend>
                <div className="swatch-row">
                  {THEME_ORDER.map((theme) => (
                    <button
                      key={theme}
                      style={{ '--swatch': coatPalette(species, theme).fur } as CSSProperties}
                      className={`coat-swatch ${theme === coat ? 'is-selected' : ''}`}
                      aria-label={`Coat: ${coatLabel(species, theme)}`}
                      aria-pressed={theme === coat}
                      title={coatLabel(species, theme)}
                      onClick={() => setCoat(theme)}
                    >
                      {theme === coat && <Icon name="check" size={14} />}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="mood-options">
                <legend>
                  02 <span>Set the mood</span>
                </legend>
                <div className="mood-row">
                  {MOOD_ORDER.map((value) => (
                    <button
                      key={value}
                      className={mood === value ? 'is-selected' : ''}
                      aria-pressed={mood === value}
                      onClick={() => setMood(value)}
                    >
                      {MOOD_LABELS[value]}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        </section>

        <section
          className="features-section section-space"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="section-container">
            <div className="section-heading">
              <div>
                <SectionLabel>MORE THAN A CUTE FACE</SectionLabel>
                <h2 id="features-title">
                  It’s the little things
                  <br />
                  that make a day <em>better.</em>
                </h2>
              </div>
              <p>
                There for the busy moments, the music breaks,
                <br />
                and the very important afternoon naps.
              </p>
            </div>
            <div className="feature-grid">
              <article className="feature-card roam-card">
                <span className="feature-number">01 / AROUND FOR THE EVERYDAY</span>
                <div className="roam-illustration" aria-hidden="true">
                  <div className="mini-work-window">
                    <span className="mini-window-dots">● ● ●</span>
                    <div className="fake-text-line" />
                    <div className="fake-text-line short" />
                    <div className="fake-text-line" />
                    <span className="mini-caret" />
                  </div>
                  <div className="dotted-walk-path" />
                  <Pet id="fox" size={135} />
                  <span className="roam-cursor">
                    <svg width="25" height="30" viewBox="0 0 25 30">
                      <path d="m3 2 18 15-9 1-4 9Z" fill="#fff" stroke="#2c3b2c" strokeWidth="2" />
                    </svg>
                  </span>
                </div>
                <h3>Your screen, with a little life.</h3>
                <p>
                  They wander while you work. Click to pet, drag to a favorite spot, and keep using
                  your apps right underneath.
                </p>
                <span className="feature-footnote">
                  <Icon name="mouse" size={15} />
                  Click-through, until it’s cuddle time.
                </span>
              </article>
              <article className={`feature-card music-card ${dancing ? 'is-playing' : ''}`}>
                <span className="feature-number">02 / YOUR TINIEST DANCE PARTNER</span>
                <div className="music-illustration">
                  <div className="music-record">
                    <div className="record-center">
                      <Icon name="music" size={23} />
                    </div>
                  </div>
                  <Pet id="panda" size={138} pose={dancing ? 'dance' : 'idle'} />
                  <span className="music-note note-a" aria-hidden="true">
                    ♪
                  </span>
                  <span className="music-note note-b" aria-hidden="true">
                    ♫
                  </span>
                  <button
                    className="music-play"
                    aria-label={dancing ? 'Pause dance preview' : 'Play dance preview'}
                    aria-pressed={dancing}
                    onClick={() => setDancing((value) => !value)}
                  >
                    {dancing ? <span className="pause-symbol" /> : <Icon name="play" size={16} />}
                  </button>
                </div>
                <h3>A soft spot for your playlist.</h3>
                <p>
                  Put some music on and watch the happy feet. Nudge feels the beat through playback
                  levels, without recording a thing.
                </p>
                <span className="feature-footnote">
                  <Icon name="volume" size={15} />
                  Your music stays yours.
                </span>
              </article>
              <article className="feature-card sleep-card">
                <span className="feature-number">03 / REST IS PART OF THE ROUTINE</span>
                <div className="sleep-illustration" aria-hidden="true">
                  <span className="sleep-moon">
                    <Icon name="moon" size={49} />
                  </span>
                  <span className="sleep-star star-a">✧</span>
                  <span className="sleep-star star-b">✦</span>
                  <div className="sleep-rug" />
                  <Pet id="cat" size={158} pose="sleep" />
                  <span className="sleep-z">z z z</span>
                </div>
                <h3>Experts at doing absolutely nothing.</h3>
                <p>
                  Right-click for a cozy nap in their favorite corner. A little click wakes them up
                  when you’re ready for company again.
                </p>
                <span className="feature-footnote">
                  <Icon name="moon" size={15} />
                  Notifications can wait. Naps come first.
                </span>
              </article>
            </div>
            <div className="extra-features">
              <article>
                <span className="extra-icon">
                  <Icon name="bell" size={23} />
                </span>
                <div>
                  <h3>A friendly heads-up.</h3>
                  <p>
                    Your companion reacts to notifications. Choose a gentle nudge or opt into
                    Auto-close.
                  </p>
                </div>
                <a
                  href="#guide"
                  aria-label="Read about notification reactions"
                  onClick={() => setGuideId('reactions')}
                >
                  <Icon name="arrow" />
                </a>
              </article>
              <article>
                <button
                  className="extra-icon"
                  onClick={() => setWaving((value) => !value)}
                  aria-label="Try webcam pose preview"
                  aria-pressed={waving}
                >
                  <Icon name="camera" size={23} />
                </button>
                <div>
                  <h3>Camera on? Say cheese.</h3>
                  <p>A little wave when your camera is in use. No camera images are accessed.</p>
                </div>
                <Pet id="bunny" size={74} pose={waving ? 'wave' : 'idle'} />
              </article>
            </div>
          </div>
        </section>

        <section
          className="make-yours-section section-container section-space"
          aria-labelledby="make-yours-title"
        >
          <div className="settings-showcase">
            <div className="settings-window-bar">
              <span>
                <Icon name="paw" size={15} />
                Nudge Settings
              </span>
              <span aria-hidden="true">— &nbsp; □ &nbsp; ×</span>
            </div>
            <button
              className="settings-image-button"
              onClick={() =>
                setModal({
                  type: 'image',
                  src: asset('images/settings-full.png'),
                  title: 'A look inside Nudge Settings',
                  caption:
                    'The actual settings interface, captured from the app renderer. The full view below includes appearance, movement, behavior, and general preferences.'
                })
              }
              aria-label="Expand the actual Nudge settings screenshot"
            >
              <img
                src={asset('images/settings.png')}
                alt="Nudge Settings with its animal picker, three sizes, and coat colors"
                width="960"
                height="1680"
                loading="lazy"
              />
              <span className="image-expand">
                <Icon name="expand" size={16} />
                Take a closer look
              </span>
            </button>
            <span className="settings-sticker">
              <Icon name="heart" size={16} />a personality that’s all yours
            </span>
          </div>
          <div className="make-yours-copy">
            <SectionLabel>SETTLE RIGHT IN</SectionLabel>
            <h2 id="make-yours-title">
              A companion.
              <br /> <em>Your</em> way.
            </h2>
            <p>
              Some days call for a curious fox. Others, a sleepy cat. Make room for whatever feels
              right.
            </p>
            <ul className="detail-list">
              <li>
                <Icon name="sliders" />
                <div>
                  <h3>A whole lot of personality</h3>
                  <p>
                    15 animals, 15 coats each, seven moods, and three sizes. Every change shows up
                    right away.
                  </p>
                </div>
              </li>
              <li>
                <Icon name="moon" />
                <div>
                  <h3>A rhythm that matches yours</h3>
                  <p>
                    Choose their sleeping corner, adjust wandering speed, or turn on reduced motion.
                  </p>
                </div>
              </li>
              <li>
                <Icon name="sun" />
                <div>
                  <h3>There when you want them</h3>
                  <p>
                    Start with Windows is your choice. Pause or quit any time from the little paw in
                    your system tray.
                  </p>
                </div>
              </li>
            </ul>
            <a href="#guide" onClick={() => setGuideId('personalize')} className="text-link">
              A quick guide to making it yours <Icon name="arrow" size={18} />
            </a>
          </div>
        </section>

        <section className="gallery-section section-container" aria-labelledby="gallery-title">
          <div className="gallery-heading">
            <h2 id="gallery-title">
              A peek into their <em>little world.</em>
            </h2>
            <span>THE REAL ART. ALL THE LITTLE DETAILS.</span>
          </div>
          <div className="gallery-grid">
            {[
              {
                image: 'desktop-preview.png',
                full: 'desktop-preview.png',
                title: 'A friend in your workspace',
                label: 'INTERACTIVE DESKTOP PREVIEW',
                caption:
                  'An illustrated desktop scene with the same animated pet renderer used by Nudge. This is a browser preview, not a capture of the installed Windows overlay.'
              },
              {
                image: 'character-roster.png',
                full: 'character-roster.png',
                title: 'Fifteen ways to feel at home',
                label: 'CHARACTER & ANIMATION GALLERY',
                caption:
                  'The Nudge character gallery, rendered with the app’s own artwork. Walk, run, sit, dance, pose, and sleep.'
              },
              {
                image: 'expressions.png',
                full: 'expressions.png',
                title: 'They wear their hearts on their faces',
                label: 'THE EXPRESSION STUDIES',
                caption:
                  'Nudge’s illustrated facial expressions, captured from the character renderer.'
              }
            ].map((item) => (
              <button
                key={item.image}
                className="gallery-card"
                onClick={() =>
                  setModal({
                    type: 'image',
                    src: asset(`images/${item.full}`),
                    title: item.title,
                    caption: item.caption
                  })
                }
              >
                <div className="gallery-image">
                  <img src={asset(`images/${item.image}`)} alt={item.title} loading="lazy" />
                  <span>
                    <Icon name="expand" size={17} />
                  </span>
                </div>
                <div className="gallery-caption">
                  <span>{item.label}</span>
                  <h3>
                    {item.title}
                    <Icon name="arrow" size={18} />
                  </h3>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="privacy-strip section-container">
          <span className="privacy-icon">
            <Icon name="shield" size={29} />
          </span>
          <div>
            <h3>Your desktop is your space.</h3>
            <p>
              No account. Local preferences. Music reactions without recordings, and camera
              reactions without camera access.
            </p>
          </div>
          <button onClick={() => setModal({ type: 'privacy' })} className="text-link">
            A note on privacy <Icon name="arrow" size={17} />
          </button>
        </section>

        <section
          className="guide-section section-container section-space"
          id="guide"
          aria-labelledby="guide-title"
        >
          <div className="section-heading">
            <div>
              <SectionLabel>THE NUDGE FIELD GUIDE</SectionLabel>
              <h2 id="guide-title">
                Good friends are easy
                <br />
                to get to <em>know.</em>
              </h2>
            </div>
            <p>
              Everything you need for a happy little desktop.
              <br />
              Start here. Settle in. Make yourself at home.
            </p>
          </div>
          <div className="guide-layout">
            <div
              className="guide-nav"
              role="tablist"
              aria-label="Nudge guides"
              aria-orientation="vertical"
            >
              {guides.map((guide, index) => (
                <button
                  key={guide.id}
                  role="tab"
                  id={`guide-tab-${guide.id}`}
                  aria-controls={`guide-panel-${guide.id}`}
                  aria-selected={guideId === guide.id}
                  tabIndex={guideId === guide.id ? 0 : -1}
                  className={guideId === guide.id ? 'is-selected' : ''}
                  onClick={() => setGuideId(guide.id)}
                  onKeyDown={(event) => {
                    let next = index
                    if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
                      next = (index + 1) % guides.length
                    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
                      next = (index + guides.length - 1) % guides.length
                    else if (event.key === 'Home') next = 0
                    else if (event.key === 'End') next = guides.length - 1
                    else return
                    event.preventDefault()
                    setGuideId(guides[next].id)
                    document.getElementById(`guide-tab-${guides[next].id}`)?.focus()
                  }}
                >
                  <Icon name={guide.icon} size={19} />
                  <span>{guide.title}</span>
                  <Icon name="arrow" size={16} />
                </button>
              ))}
              <div className="guide-tip">
                <Icon name="paw" size={25} />
                <p>
                  Lost your little friend?
                  <br />
                  Look for the paw in your
                  <br />
                  Windows system tray.
                </p>
              </div>
            </div>
            <div
              className="guide-panel"
              id={`guide-panel-${currentGuide.id}`}
              role="tabpanel"
              aria-labelledby={`guide-tab-${currentGuide.id}`}
              tabIndex={0}
            >
              <span className="guide-page">
                FIELD NOTES / 0{guides.findIndex((guide) => guide.id === guideId) + 1}
              </span>
              <h3>{currentGuide.heading}</h3>
              <p className="guide-intro">{currentGuide.intro}</p>
              <ol className="guide-steps">
                {currentGuide.steps.map((step, index) => (
                  <li key={step.title}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h4>{step.title}</h4>
                      <p>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {currentGuide.note && (
                <p className="guide-note">
                  <Icon name="book" size={17} />
                  <span>{currentGuide.note}</span>
                </p>
              )}
            </div>
          </div>
        </section>

        <section
          className="faq-section section-container section-space"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div className="faq-heading">
            <SectionLabel>A FEW THINGS YOU MIGHT WONDER</SectionLabel>
            <h2 id="faq-title">
              Small pet.
              <br /> <em>Good questions.</em>
            </h2>
            <Pet id="dog" size={134} pose="wave" />
            <p>
              Less wondering.
              <br />
              More wandering.
            </p>
          </div>
          <div className="faq-list">
            {faqs.map((faq) => (
              <details key={faq.q}>
                <summary>
                  {faq.q}
                  <span>
                    <Icon name="chevron" size={19} />
                  </span>
                </summary>
                <div className="faq-answer">
                  <p>{faq.a.replace('Version 0.1.0', `Version ${release.version}`)}</p>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="download-section" id="download" aria-labelledby="download-title">
          <div className="section-container download-inner">
            <div className="download-doodle doodle-a" aria-hidden="true">
              ✧
            </div>
            <div className="download-doodle doodle-b" aria-hidden="true">
              ✦
            </div>
            <SectionLabel light>A LITTLE LESS ORDINARY, STARTING TODAY</SectionLabel>
            <h2 id="download-title">
              There’s room for one more
              <br />
              on your <em>desktop.</em>
            </h2>
            <p>Your next favorite coworker is a few clicks away.</p>
            <DownloadLink className="button-yellow">Bring Nudge home</DownloadLink>
            <div className="download-details">
              <span>Windows 10 & 11 · x64 · {release.size}</span>
              <span>
                Version {release.version} <span className="detail-separator">/</span>
                <button onClick={() => setModal({ type: 'release' })}>What’s included</button>
                <span className="detail-separator">/</span>
                <button onClick={() => setModal({ type: 'checksum' })}>Verify download</button>
              </span>
            </div>
            <aside className="download-dnd-note" aria-labelledby="download-dnd-title">
              <Icon name="bell" size={24} />
              <div>
                <h3 id="download-dnd-title">Using Auto-close? Turn off Do not disturb.</h3>
                <p>{NOTIFICATION_SETUP.message}</p>
                <p>{NOTIFICATION_SETUP.autoClose}</p>
                <a href="#guide" onClick={() => setGuideId('reactions')}>
                  See Windows notification setup <Icon name="arrow" size={15} />
                </a>
              </div>
            </aside>
            <div className="download-friends" aria-hidden="true">
              <Pet id="fox" size={101} />
              <Pet id="bunny" size={91} />
              <Pet id="cat" size={116} pose="wave" />
              <Pet id="panda" size={109} />
              <Pet id="dog" size={106} />
            </div>
            <p className="unsigned-note">
              An early, unsigned release. Windows may show a publisher warning.
              <br />
              The installer includes all required runtimes.{' '}
              <a href="#guide" onClick={() => setGuideId('install')}>
                Read the installation guide.
              </a>
            </p>
          </div>
        </section>
      </main>
      <footer className="site-footer section-container">
        <div className="footer-top">
          <div>
            <Wordmark />
            <p>A little life between the tabs.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#companions">Meet the pets</a>
            <a href="#guide">The field guide</a>
            <button onClick={() => setModal({ type: 'privacy' })}>Privacy</button>
            <button onClick={() => setModal({ type: 'release' })}>Release notes</button>
          </nav>
          <a className="back-to-top" href="#home" aria-label="Back to top">
            <Icon name="arrow" size={20} />
          </a>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Nudge. A desktop companion for Windows.</span>
          <span>
            Made for a softer workday.
            <Icon name="heart" size={13} />
          </span>
        </div>
      </footer>
      <SiteModal content={modal} onClose={() => setModal(null)} />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

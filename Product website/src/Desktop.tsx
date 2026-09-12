import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { CharacterId, ColorThemeId, MoodDefault } from '../../src/shared/settings'
import { Icon } from './Icon'
import { Pet, type Pose } from './Pet'

const status: Record<Pose, string> = {
  idle: 'A little company for your day.',
  love: 'You just made their day.',
  dance: 'Every workday needs a little groove.',
  sleep: 'Shhh. Very important nap in progress.',
  wave: 'Ready for their close-up.',
  alert: 'Something new? Your friend noticed.'
}

export function Desktop({
  character,
  coat,
  mood,
  onMeetFriends
}: {
  character: CharacterId
  coat: ColorThemeId
  mood: MoodDefault
  onMeetFriends: () => void
}) {
  const [pose, setPose] = useState<Pose>('idle')
  const [night, setNight] = useState(false)
  const [position, setPosition] = useState({ x: 68, y: 68 })
  const [dragging, setDragging] = useState(false)
  const [petCount, setPetCount] = useState(0)
  const [notification, setNotification] = useState(false)
  const [moving, setMoving] = useState(false)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  useEffect(() => {
    if (!notification) return
    const timeout = setTimeout(() => {
      setNotification(false)
      setPose((p) => (p === 'alert' ? 'idle' : p))
    }, 6500)
    return () => clearTimeout(timeout)
  }, [notification])

  function act(next: Pose) {
    if (timer.current) clearTimeout(timer.current)
    setNotification(false)
    setMoving(false)
    setPose(next)
    if (next === 'sleep') {
      setPosition({ x: 20, y: 71 })
      setMoving(true)
    }
    if (next === 'love') {
      setPetCount((count) => count + 1)
      timer.current = setTimeout(() => setPose('idle'), 2200)
    }
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !stage.current) return
    if (
      Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) < 5 &&
      !drag.current.moved
    )
      return
    drag.current.moved = true
    setDragging(true)
    setMoving(false)
    const bounds = stage.current.getBoundingClientRect()
    setPosition({
      x: Math.min(83, Math.max(16, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(75, Math.max(30, ((event.clientY - bounds.top) / bounds.height) * 100))
    })
  }

  return (
    <div className="desktop-wrap">
      <div className="desktop-topline">
        <span>
          <i className="live-dot" /> A LITTLE LOOK AT LIFE WITH NUDGE
        </span>
        <span className="preview-tag">Interactive preview</span>
      </div>
      <div className={`desktop ${night ? 'is-night' : ''}`} ref={stage}>
        <div className="desktop-landscape" aria-hidden="true">
          <div className="landscape-sun" />
          <div className="hill hill-back" />
          <div className="hill hill-middle" />
          <div className="hill hill-front" />
          <svg className="landscape-flower flower-one" viewBox="0 0 40 70">
            <path
              d="M20 65V18M20 48Q4 45 7 31M20 39q15-9 14-21"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx="20" cy="13" r="7" fill="#f6dc93" />
          </svg>
          <svg className="landscape-flower flower-two" viewBox="0 0 40 70">
            <path
              d="M20 65V18M20 48Q4 45 7 31M20 39q15-9 14-21"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx="20" cy="13" r="7" fill="#f6dc93" />
          </svg>
        </div>
        <div className="desktop-topbar">
          <span>
            <Icon name="windows" size={13} /> Your happy place
          </span>
          <span>
            Tuesday, 9:41 AM <Icon name="volume" size={13} />
          </span>
        </div>
        <div className="desktop-shortcuts" aria-hidden="true">
          <span>
            <Icon name="folder" size={28} />
            Good things
          </span>
          <span>
            <Icon name="book" size={25} />
            Little ideas
          </span>
        </div>
        <div className="desktop-note">
          <div className="note-tape" />
          <span className="note-eyebrow">TODAY’S TO-DO</span>
          <p>
            Make something.
            <br />
            Take a breath.
            <br />
            <span>Pet a friend.</span>
          </p>
          <svg viewBox="0 0 150 18" aria-hidden="true">
            <path
              d="M2 10Q50 1 147 7M7 15Q79 8 134 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setNight((value) => !value)}
          aria-label={night ? 'Use daytime preview' : 'Use nighttime preview'}
          title="Change the scenery"
        >
          <Icon name={night ? 'sun' : 'moon'} size={18} />
        </button>
        {notification && (
          <div className="demo-notification" role="status">
            <span className="notification-icon">
              <Icon name="bell" size={17} />
            </span>
            <div>
              <strong>A little reminder</strong>
              <p>Stretch. Sip. You’re doing great.</p>
            </div>
            <button
              aria-label="Dismiss preview notification"
              onClick={() => {
                setNotification(false)
                setPose('idle')
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        <div
          className={`desktop-pet-position ${moving ? 'is-moving' : ''}`}
          style={{ '--pet-x': `${position.x}%`, '--pet-y': `${position.y}%` } as CSSProperties}
        >
          <span className={`pet-speech ${pose === 'love' ? 'is-loved' : ''}`} key={pose + petCount}>
            {pose === 'sleep'
              ? 'z z z'
              : pose === 'dance'
                ? '♪  ♫  ♪'
                : pose === 'love'
                  ? '♥  ♥  ♥'
                  : pose === 'alert'
                    ? 'oh, hello!'
                    : 'oh, hi there.'}
          </span>
          <button
            className={`desktop-pet ${dragging ? 'is-dragging' : ''}`}
            aria-label={`${character} preview: click to pet, drag to move, right-click to sleep. Use arrow keys to move.`}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              drag.current = { x: event.clientX, y: event.clientY, moved: false }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={pointerMove}
            onPointerUp={(event) => {
              const wasMoved = drag.current?.moved
              drag.current = null
              setDragging(false)
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
              if (!wasMoved) act(pose === 'sleep' ? 'idle' : 'love')
            }}
            onPointerCancel={() => {
              drag.current = null
              setDragging(false)
            }}
            onClick={(event) => {
              if (event.detail === 0) act(pose === 'sleep' ? 'idle' : 'love')
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              act('sleep')
            }}
            onKeyDown={(event) => {
              const delta = {
                ArrowLeft: [-4, 0],
                ArrowRight: [4, 0],
                ArrowUp: [0, -4],
                ArrowDown: [0, 4]
              }[event.key]
              if (delta) {
                event.preventDefault()
                setPosition((p) => ({
                  x: Math.min(83, Math.max(16, p.x + delta[0])),
                  y: Math.min(75, Math.max(30, p.y + delta[1]))
                }))
              }
            }}
          >
            <Pet id={character} coat={coat} mood={mood} pose={pose} size={186} />
          </button>
          <span className="pet-ground-shadow" />
        </div>
        <div className="desktop-taskbar">
          <span className="taskbar-dots">
            <Icon name="windows" size={18} />
            <span className="taskbar-search" />
            <Icon name="folder" size={21} />
            <span className="taskbar-paw">
              <Icon name="paw" size={18} />
            </span>
          </span>
          <span className="taskbar-clock">
            9:41
            <br />
            <small>a good day</small>
          </span>
        </div>
      </div>
      <div className="desktop-controls">
        <div className="preview-actions" aria-label="Try your companion">
          <button onClick={() => act('love')} aria-pressed={pose === 'love'}>
            <Icon name="heart" size={17} />
            Pet me
          </button>
          <button
            onClick={() => act(pose === 'dance' ? 'idle' : 'dance')}
            aria-pressed={pose === 'dance'}
          >
            <Icon name="music" size={17} />
            Let’s dance
          </button>
          <button
            onClick={() => act(pose === 'sleep' ? 'idle' : 'sleep')}
            aria-pressed={pose === 'sleep'}
          >
            <Icon name="moon" size={17} />
            {pose === 'sleep' ? 'Wake up' : 'Nap time'}
          </button>
          <button
            className="notification-preview-button"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current)
              setNotification(true)
              setPose('alert')
            }}
            aria-label="Preview a notification reaction"
          >
            <Icon name="bell" size={17} />
          </button>
        </div>
        <button
          className="change-friend"
          onClick={onMeetFriends}
          aria-label="Choose a different companion"
        >
          <Icon name="sliders" size={19} />
        </button>
      </div>
      <p className="preview-status" aria-live="polite">
        {status[pose]} <span>Click or drag your friend to say hello.</span>
      </p>
      <div className="handwritten-note" aria-hidden="true">
        <svg viewBox="0 0 80 54">
          <path d="M75 44C29 58 25 4 8 13m0 0 17 3M8 13l7 15" />
        </svg>
        yes, you can pet them!
      </div>
    </div>
  )
}

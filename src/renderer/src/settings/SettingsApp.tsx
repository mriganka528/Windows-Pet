import { useEffect, useState } from 'react'
import { SpriteCanvas } from '../companion/SpriteCanvas'
import { paletteFor } from '../companion/appearance'
import { speciesFor } from '../companion/species'
import type { Mood } from '../companion/mood'
import {
  CHARACTER_LABELS,
  CHARACTER_ORDER,
  COLOR_THEMES,
  MOOD_LABELS,
  MOOD_ORDER,
  SIZE_LABELS,
  SIZE_ORDER,
  SIZE_PX,
  THEME_LABELS,
  THEME_ORDER,
  isNaturalCoat,
  type ColorThemeId,
  type MoodDefault,
  type NudgeSettings,
  type Size
} from '../../../shared/settings'

// ---------------------------------------------------------------------------
// Settings window UI (UI/UX §2.4).
// ---------------------------------------------------------------------------
// A normal, opaque window opened from the tray. Every control writes through
// window.nudge.setSettings(patch); main persists + broadcasts, and the overlay
// updates live. We also subscribe to settings:changed so external changes (the
// tray's Pause, another edit) keep this window in sync.

// The idle face each default mood implies (for the live preview only). Mirrors
// appearance.baseMoodFor's 1:1 mapping so the preview matches what the overlay
// actually rests on — every preset now has its own distinct face.
const PREVIEW_EXPR: Record<MoodDefault, Mood> = {
  happy: 'happy',
  excited: 'excited',
  curious: 'curious',
  alert: 'alert',
  chill: 'chill',
  sleepy: 'sleepy',
  grumpy: 'grumpy'
}

export default function SettingsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<NudgeSettings | null>(null)

  useEffect(() => {
    let alive = true
    void window.nudge?.getSettings().then((s) => {
      if (alive) setSettings(s)
    })
    const off = window.nudge?.onSettingsChanged((s) => setSettings(s))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  async function patch(next: Parameters<typeof window.nudge.setSettings>[0]): Promise<void> {
    const resolved = await window.nudge.setSettings(next)
    setSettings(resolved)
  }

  async function reset(): Promise<void> {
    const resolved = await window.nudge.resetSettings()
    setSettings(resolved)
  }

  if (!settings) {
    return (
      <div className="loading" role="status">
        Loading settings…
      </div>
    )
  }

  const { appearance, behavior, general } = settings
  // The animal currently chosen, and the palette it should paint with — the coat
  // decides: 'natural' uses the species' own colors, any other coat recolors it.
  const currentSpecies = speciesFor(appearance.character)
  const palette = paletteFor(settings, currentSpecies)
  // The 'natural' swatch has no fixed color of its own (it means "use this
  // animal's colors"), so it shows the chosen species' fur; the recolor coats
  // each show their own fur.
  const swatchColor = (id: ColorThemeId): string =>
    isNaturalCoat(id) ? currentSpecies.palette.fur : COLOR_THEMES[id].fur

  return (
    <div className="app">
      <header className="app-header">
        <div className="preview-stage" aria-hidden="true">
          <SpriteCanvas
            size={Math.min(SIZE_PX[appearance.size], 128)}
            facing="right"
            expression={PREVIEW_EXPR[appearance.moodDefault]}
            species={currentSpecies}
            palette={palette}
            dragging={false}
            idle={true}
          />
        </div>
        <div className="app-title">
          <h1>Nudge</h1>
          <p>Your desktop companion</p>
        </div>
      </header>

      <Section title="Appearance">
        <Row label="Character" stack>
          <div className="character-grid">
            {CHARACTER_ORDER.map((id) => {
              // Each card shows the animal in its OWN natural colors so the roster
              // reads at a glance (fox vs dog); the coat control below recolors the
              // one you pick. A tiny live sprite keeps the picker honest — it's the
              // exact same renderer the overlay uses.
              const sp = speciesFor(id)
              const selected = appearance.character === id
              return (
                <button
                  key={id}
                  type="button"
                  className={`character-card${selected ? ' selected' : ''}`}
                  aria-pressed={selected}
                  aria-label={CHARACTER_LABELS[id]}
                  onClick={() => void patch({ appearance: { character: id } })}
                >
                  <span className="character-canvas" aria-hidden="true">
                    <SpriteCanvas
                      size={54}
                      facing="right"
                      expression="happy"
                      species={sp}
                      palette={sp.palette}
                      dragging={false}
                      idle={true}
                    />
                  </span>
                  <span className="character-label">{CHARACTER_LABELS[id]}</span>
                </button>
              )
            })}
          </div>
        </Row>

        <Row label="Size">
          <Segmented<Size>
            options={SIZE_ORDER.map((s) => ({ value: s, label: SIZE_LABELS[s] }))}
            value={appearance.size}
            onChange={(size) => void patch({ appearance: { size } })}
          />
        </Row>

        <Row label="Color">
          <div className="swatches">
            {THEME_ORDER.map((id: ColorThemeId) => (
              <button
                key={id}
                type="button"
                title={THEME_LABELS[id]}
                aria-label={THEME_LABELS[id]}
                aria-pressed={appearance.colorTheme === id}
                className={`swatch${appearance.colorTheme === id ? ' selected' : ''}${isNaturalCoat(id) ? ' natural' : ''}`}
                style={{ background: swatchColor(id) }}
                onClick={() => void patch({ appearance: { colorTheme: id } })}
              />
            ))}
          </div>
        </Row>

        <Row label="Default mood" stack>
          <Segmented<MoodDefault>
            options={MOOD_ORDER.map((m) => ({ value: m, label: MOOD_LABELS[m] }))}
            value={appearance.moodDefault}
            onChange={(moodDefault) => void patch({ appearance: { moodDefault } })}
          />
        </Row>
      </Section>

      <Section title="Behavior" description="What Nudge does when a notification appears.">
        <div className="mode-cards">
          <ModeCard
            active={behavior.mode === 'nudge'}
            title="Just nudge me"
            body="The companion reacts and points you to the notification. Nothing gets closed."
            onSelect={() => void patch({ behavior: { mode: 'nudge' } })}
          />
          <ModeCard
            active={behavior.mode === 'autoClose'}
            title="Close them for me"
            body="Nudge walks over to every notification and taps it closed with a paw, then goes back to roaming."
            note="Heads up: this dismisses everything — including one-time codes, reminders, and messages you might want to read."
            warn
            onSelect={() => void patch({ behavior: { mode: 'autoClose' } })}
          />
        </div>
      </Section>

      <Section title="General">
        <Toggle
          label="Start with Windows"
          description="Launch Nudge automatically when you sign in."
          checked={general.startWithWindows}
          onChange={(startWithWindows) => void patch({ general: { startWithWindows } })}
        />
        <Toggle
          label="Sound"
          description="Play a soft sound with reactions."
          checked={general.soundEnabled}
          onChange={(soundEnabled) => void patch({ general: { soundEnabled } })}
        />
        <Toggle
          label="Reduced motion"
          description="Calmer, slower movement with less roaming."
          checked={general.reducedMotion}
          onChange={(reducedMotion) => void patch({ general: { reducedMotion } })}
        />
        <Toggle
          label="Dance to music"
          description="Bop along when music is playing. Off by default: while it's on, Windows sees the audio capture as screen-sharing and may switch on Do Not Disturb. Listens to your PC's audio only — never the microphone."
          checked={general.reactToAudio}
          onChange={(reactToAudio) => void patch({ general: { reactToAudio } })}
        />
        <Toggle
          label="Pose for the camera"
          description="Scurry up and strike a cute pose when your webcam turns on. Only detects that a camera is in use — never opens it or sees any video."
          checked={general.reactToWebcam}
          onChange={(reactToWebcam) => void patch({ general: { reactToWebcam } })}
        />
      </Section>

      <footer className="app-footer">
        <button type="button" className="reset-btn" onClick={() => void reset()}>
          Reset to defaults
        </button>
      </footer>
    </div>
  )
}

// --- small building blocks --------------------------------------------------

function Section({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Row({
  label,
  stack,
  children
}: {
  label: string
  stack?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`row${stack ? ' row-stack' : ''}`}>
      <span className="row-label">{label}</span>
      <div className="row-control">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`segment${value === o.value ? ' selected' : ''}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ModeCard({
  active,
  title,
  body,
  note,
  warn = false,
  onSelect
}: {
  active: boolean
  title: string
  body: string
  note?: string
  warn?: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`mode-card${active ? ' selected' : ''}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="mode-radio" aria-hidden="true" />
      <span className="mode-text">
        <span className="mode-title">{title}</span>
        <span className="mode-body">{body}</span>
        {note ? <span className={`mode-note${warn ? ' mode-note--warn' : ''}`}>{note}</span> : null}
      </span>
    </button>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="toggle">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description ? <span className="toggle-desc">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
    </label>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'
import { companionMachine } from './companion/machine'
import { SpriteCanvas } from './companion/SpriteCanvas'
import { facesFront } from './companion/presentation'
import { speciesWithCoat } from './companion/coats'
import { EffectsCanvas, type EffectsHandle } from './companion/EffectsCanvas'
import { useSystemAudio } from './companion/useSystemAudio'
import { DEFAULT_WANDER, type Vec2, type WanderConfig } from './companion/motion'
import { initialMood, reduceMood, expressionOf, type Mood, type MoodEvent } from './companion/mood'
import { wanderConfigFor, baseMoodFor, energyFor, paletteFor } from './companion/appearance'
import { speciesFor, type SpeciesDef } from './companion/species'
import { isPointInRect } from './lib/hitTest'
import {
  DEFAULT_SETTINGS,
  type BehaviorMode,
  type NudgeSettings,
  type SpritePalette
} from '../../shared/settings'

// ---------------------------------------------------------------------------
// Renderer glue: locomotion (XState) + mood/expression (pure reducer) + input.
// ---------------------------------------------------------------------------
// Responsibilities (all the "impure" wiring; the logic lives in the pure/tested
// modules companion/{motion,machine,mood,effects,appearance}.ts):
//   1. rAF loop -> TICK the machine (movement) AND decay the mood.
//   2. SET_BOUNDS on resize.
//   3. Translate mouse input into: a PET (quick click) vs a DRAG (press+move),
//      keeping the Phase 0 click-through toggle correct against the moving pup.
//   4. React to companion events from main (a notification -> angry; in dev these
//      are fired by global shortcuts, see main/index.ts). Real toasts arrive via
//      the Phase 5 notification IPC below: main converts their geometry to
//      overlay-local px and we drive the machine's alert→travel→interact flow.
//   5. Emit reaction emotes (hearts / anger) via the EffectsCanvas layer.
//   6. Phase 2: apply persisted settings live — size (SET_CONFIG), color
//      (palette), default mood (SET_BASE resting face), reduced motion, and Pause (freeze
//      the wander while keeping drag/pet interactive).

const HIT_PADDING = 8
// Pointer travel (px) that turns a press into a drag; below it, a release = pet.
const DRAG_THRESHOLD = 5
// The paw-swat one-shot in SpriteCanvas runs over SWAT_TIME (0.5s) with a sine
// envelope, so the paw is fully forward at the half-way point (~250ms). In
// auto-close mode we ask main to dismiss the toast right then, so it disappears
// exactly as the paw "connects" — cause and effect line up on screen.
const SWAT_PEAK_MS = 250

export default function App(): React.JSX.Element {
  const [state, send, actorRef] = useMachine(companionMachine, {
    input: {
      bounds: { width: window.innerWidth, height: window.innerHeight },
      config: DEFAULT_WANDER
    }
  })

  // --- live settings-derived look/behavior ----------------------------------
  // Sprite size travels through the machine's WanderConfig (keeps the body on
  // the ground line); we also mirror it in a ref for the pointer math below.
  const [config, setConfig] = useState<WanderConfig>(DEFAULT_WANDER)
  const sizeRef = useRef(config.spriteSize)
  sizeRef.current = config.spriteSize
  // The chosen animal (colors + morphology) and the resolved fur palette. The
  // 'natural' coat uses the species' own colors; other coats recolor it (see
  // appearance.paletteFor). Both update live from the settings subscription.
  const [species, setSpecies] = useState<SpeciesDef>(() =>
    speciesFor(DEFAULT_SETTINGS.appearance.character)
  )
  const [palette, setPalette] = useState<SpritePalette>(() =>
    paletteFor(DEFAULT_SETTINGS, speciesFor(DEFAULT_SETTINGS.appearance.character))
  )
  // Liveliness of the on-the-spot animation (breathing, tail, idle fidgets),
  // separate from the wander SPEED that rides in `config`. See appearance.ts.
  const [energy, setEnergy] = useState(() =>
    energyFor(DEFAULT_SETTINGS.appearance.moodDefault, DEFAULT_SETTINGS.general.reducedMotion)
  )
  const [reducedMotion, setReducedMotion] = useState(DEFAULT_SETTINGS.general.reducedMotion)
  const pausedRef = useRef(false)
  // Which behavior the user picked: 'nudge' (just point it out) or 'autoClose'
  // (paw the toast shut). Held in a ref because only the reaction effects read
  // it, and they should see the latest value without re-subscribing on change.
  const behaviorModeRef = useRef<BehaviorMode>(DEFAULT_SETTINGS.behavior.mode)
  // Bumped once per dismissal to fire SpriteCanvas's one-shot forward paw-swat.
  const [swatNonce, setSwatNonce] = useState(0)
  // Bumped once per detected musical beat -> SpriteCanvas's one-shot beat "pop".
  const [beatNonce, setBeatNonce] = useState(0)
  // Bumped once at startup to fire the welcome "hop" — a happy little bounce that
  // greets the user on launch (see the startup-greeting effect below).
  const [hopNonce, setHopNonce] = useState(0)
  // Dance-speed multiplier following the music's tempo (1 = natural bop). Updated
  // on each beat from the detector's estimate; SpriteCanvas scales its bop by it
  // so a fast song dances fast and a slow one sways slow. Reset to 1 when a song
  // ends so the next one starts from the natural speed.
  const [danceTempo, setDanceTempo] = useState(1)
  // Whether the system-audio dance listener should run: the user's "Dance to
  // music" toggle AND not paused. Recomputed on every settings change (the only
  // time either input changes), which is what re-runs the capture effect.
  const [audioEnabled, setAudioEnabled] = useState(
    DEFAULT_SETTINGS.general.reactToAudio && !DEFAULT_SETTINGS.runtime.paused
  )

  // --- mood / expression (kept out of the locomotion FSM on purpose) ---------
  const moodRef = useRef(initialMood())
  const exprRef = useRef<Mood>('neutral')
  const [expression, setExpression] = useState<Mood>('neutral')

  const applyMood = useCallback((ev: MoodEvent): void => {
    moodRef.current = reduceMood(moodRef.current, ev)
    const next = expressionOf(moodRef.current)
    if (next !== exprRef.current) {
      exprRef.current = next
      setExpression(next)
    }
  }, [])

  const effectsRef = useRef<EffectsHandle>(null)
  const ignoringRef = useRef(true)
  const draggingRef = useRef(false)
  const [interactive, setInteractive] = useState(false)

  const posRef = useRef<Vec2>(state.context.position)
  posRef.current = state.context.position
  draggingRef.current = state.matches('dragging')

  // Current locomotion state, mirrored for the (deps-stable) rAF loop so Pause
  // can freeze wandering without also stalling a drop's landing recovery.
  const machineStateRef = useRef<string>('idle')
  machineStateRef.current = String(state.value)
  const sleeping = state.matches('sleeping')
  const dozing = sleeping || state.matches('sleepTravel')
  const dozingRef = useRef(dozing)
  dozingRef.current = dozing
  const refreshHitTestRef = useRef<() => void>(() => {})
  const lastConfigRef = useRef<WanderConfig>(DEFAULT_WANDER)

  // The toast we're currently reacting to, mirrored so the auto-close effect can
  // read the id at the swat's peak without re-subscribing as context changes.
  const notifIdRef = useRef<string | null>(null)
  notifIdRef.current = state.context.notification?.id ?? null

  // Phase 5 reaction phases, derived for the sustain effects below. Each boolean
  // stays constant across ticks within a phase, so effects keyed on them fire on
  // entry/exit only (not every frame).
  const reacting = state.matches('alert') || state.matches('travel') || state.matches('interact')
  const interacting = state.matches('interact')
  const wasReactingRef = useRef(false)
  // Feature 3: holding the photogenic webcam pose. Declared here with the other
  // emitter-driving phases (not down with the render-only flags) so the sparkle
  // sustain-effect below can key on it; it's also passed to the sprite for the
  // "say cheese" pose. Pause freezes it (a paused pup holds still).
  const posing = state.matches('posing') && !pausedRef.current

  // --- settings: load once + subscribe to live changes ----------------------
  useEffect(() => {
    if (!window.nudge?.getSettings) return
    let alive = true
    const apply = (s: NudgeSettings): void => {
      if (!alive) return
      const cfg = wanderConfigFor(s)
      setConfig(cfg)
      if (JSON.stringify(lastConfigRef.current) !== JSON.stringify(cfg)) {
        lastConfigRef.current = cfg
        send({ type: 'SET_CONFIG', config: cfg })
      }
      const sp = speciesFor(s.appearance.character)
      setSpecies(speciesWithCoat(sp, s.appearance.colorTheme))
      setPalette(paletteFor(s, sp))
      setEnergy(energyFor(s.appearance.moodDefault, s.general.reducedMotion))
      setReducedMotion(s.general.reducedMotion)
      pausedRef.current = s.runtime.paused
      behaviorModeRef.current = s.behavior.mode
      // Run the audio-dance listener only when opted in AND not paused.
      setAudioEnabled(s.general.reactToAudio && !s.runtime.paused)
      // Default mood sets the resting face. Each preset now maps to its OWN
      // face (happy=warm smile, alert=wide watchful eyes, chill=relaxed,
      // sleepy=droopy, excited/curious/grumpy…), so we set it directly rather
      // than the old sleepy-or-neutral toggle.
      applyMood({ type: 'SET_BASE', base: baseMoodFor(s.appearance.moodDefault) })
    }
    void window.nudge.getSettings().then(apply)
    const off = window.nudge.onSettingsChanged(apply)
    return () => {
      alive = false
      off?.()
    }
  }, [send, applyMood])

  // --- startup greeting: a cute "hello!", then it eases into the normal walk --
  // On launch the pup beams a happy face, gives a little hop, and puffs a few
  // hearts — a friendly welcome instead of the old "angry" first frame. (That
  // anger came from the watcher replaying notifications already sitting in the
  // Action Center at startup; the watcher now seeds those silently, so nothing
  // triggers an alert on launch.) WELCOME is a *transient* mood, so once it
  // decays (~2.2s) the face returns to the resting mood and the pup wanders as
  // usual — exactly the "welcoming expression, then normal walk" behavior asked
  // for. A short delay lets the overlay paint its first frame so the hop + hearts
  // read as a deliberate greeting rather than a flicker; the ref makes React 18
  // StrictMode's dev double-mount greet exactly once.
  const welcomedRef = useRef(false)
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (welcomedRef.current) return
      welcomedRef.current = true
      if (dozingRef.current || pausedRef.current) return
      applyMood({ type: 'WELCOME' }) // happy face, briefly overriding the resting mood
      setHopNonce((n) => n + 1) // one-shot bounce
      const p = posRef.current
      const sz = sizeRef.current
      effectsRef.current?.hearts(p.x + sz * 0.5, p.y + sz * 0.24)
    }, 220)
    return () => window.clearTimeout(t)
  }, [applyMood])

  // --- rAF loop: movement TICK + mood decay ---------------------------------
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // Pause freezes roaming, but a drag-in-progress and its landing recovery
      // must still advance so a dropped pup settles instead of hanging mid-beat.
      // The notification reaction (alert→travel→interact) is likewise allowed to
      // finish once started — main won't START a reaction while paused (it drops
      // appeared events), so this only lets an in-flight one complete gracefully.
      const st = machineStateRef.current
      const mustAdvance =
        st === 'dragging' ||
        st === 'landing' ||
        st === 'alert' ||
        st === 'travel' ||
        st === 'interact' ||
        st === 'celebrate' ||
        st === 'sleepTravel'
      if (st !== 'sleeping' && (!pausedRef.current || mustAdvance)) {
        send({ type: 'TICK', dt })
      }
      applyMood({ type: 'TICK', dt }) // reactions always decay
      refreshHitTestRef.current()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [send, applyMood])

  // --- resize -> SET_BOUNDS -------------------------------------------------
  useEffect(() => {
    let alive = true
    const onResize = (): void => {
      if (window.nudge?.getGeometry) {
        void window.nudge.getGeometry().then((bounds) => {
          if (alive) send({ type: 'SET_BOUNDS', bounds })
        })
      } else
        send({
          type: 'SET_BOUNDS',
          bounds: { width: window.innerWidth, height: window.innerHeight }
        })
    }
    onResize()
    const off = window.nudge?.onGeometryChanged((bounds) => send({ type: 'SET_BOUNDS', bounds }))
    window.addEventListener('resize', onResize)
    return () => {
      alive = false
      off?.()
      window.removeEventListener('resize', onResize)
    }
  }, [send])

  // --- companion events from main (notification -> angry, etc.) -------------
  useEffect(() => {
    if (!window.nudge?.onCompanionEvent) return
    const off = window.nudge.onCompanionEvent((evt) => {
      if (dozingRef.current) return
      const p = posRef.current
      const sz = sizeRef.current
      if (evt.kind === 'alert') {
        applyMood({ type: 'ALERT' })
        effectsRef.current?.anger(p.x + sz * 0.72, p.y + sz * 0.22)
      } else if (evt.kind === 'pet') {
        applyMood({ type: 'PET' })
        effectsRef.current?.hearts(p.x + sz * 0.54, p.y + sz * 0.28)
      } else if (evt.kind === 'calm') {
        applyMood({ type: 'CALM' })
      }
    })
    return off
  }, [applyMood])

  // --- real notifications from the watcher (Phase 5) ------------------------
  // Main has already converted the toast's rectangle into overlay-local CSS px.
  // We drive the locomotion machine (notice → walk over → nudge → return) and
  // light up the angry mood. No text ever reaches here — only geometry (§7).
  useEffect(() => {
    const subAppeared = window.nudge?.onNotificationAppeared
    const subClosed = window.nudge?.onNotificationClosed
    if (!subAppeared || !subClosed) return
    const offAppeared = subAppeared((n) => {
      // Never yank the pup out of a drag the user is doing. (The machine also
      // no-ops NOTIFICATION_APPEARED while dragging; this is the first guard.)
      if (draggingRef.current || dozingRef.current || pausedRef.current) return
      send({ type: 'NOTIFICATION_APPEARED', id: n.id, rect: n.rect, interactive: n.interactive })
      welcomedRef.current = true // do not let the launch greeting override this reaction
      applyMood({ type: 'ALERT' }) // notice it immediately, even before walking over
    })
    const offClosed = subClosed((n) => {
      const current = actorRef.getSnapshot().context.notification?.id === n.id
      send({ type: 'NOTIFICATION_CLOSED', id: n.id })
      if (current) {
        applyMood({ type: 'CALM' })
        effectsRef.current?.clear('anger')
      }
    })
    return () => {
      offAppeared?.()
      offClosed?.()
    }
  }, [send, applyMood, actorRef])

  // --- webcam in-use -> scurry under the camera and pose (Feature 3) --------
  // Main polls the OS webcam consent store and sends ONLY an in-use boolean — no
  // camera frames, no app identity. On the rising edge we flip the machine's
  // webcamActive flag (a guarded TICK does the actual scurry-then-pose, so a drag
  // or a notification nudge is never interrupted) and brighten the mood so the
  // face is camera-ready; on release we clear the flag. If reactToWebcam is off,
  // main never starts the watcher, so this simply never fires.
  useEffect(() => {
    const sub = window.nudge?.onWebcamChanged
    if (!sub) return
    const off = sub(({ inUse }) => {
      send({ type: inUse ? 'WEBCAM_ON' : 'WEBCAM_OFF' })
      if (inUse && !dozingRef.current && !pausedRef.current) applyMood({ type: 'PET' })
    })
    return off
  }, [send, applyMood])

  // --- sleepy 'z's: drift up from the head while the resting face is sleepy ---
  // Chill companions settle to a sleepy face (baseMoodFor); this gives that a
  // gentle, periodic "Zzz" without baking particle timing into the pure modules.
  useEffect(() => {
    if (
      (!sleeping && expression !== 'sleepy') ||
      reducedMotion ||
      (dozing && !sleeping) ||
      reacting
    )
      return
    const puff = (): void => {
      const p = posRef.current
      const sz = sizeRef.current
      const headX = actorRef.getSnapshot().context.facing === 'left' ? 0.26 : 0.74
      effectsRef.current?.sleep(p.x + sz * headX, p.y + sz * (sleeping ? 0.67 : 0.25))
    }
    puff()
    const id = window.setInterval(puff, 2600)
    return () => window.clearInterval(id)
  }, [expression, sleeping, dozing, reducedMotion, reacting, actorRef])

  // --- notification reaction: stay alarmed, then "bark" while nudging --------
  // Keep the angry face topped up from the instant a toast appears through the
  // walk over and the nudge, so the mood doesn't decay to neutral mid-trip.
  useEffect(() => {
    if (!reacting) {
      if (wasReactingRef.current) {
        applyMood({ type: 'CALM' })
        effectsRef.current?.clear('anger')
      }
      wasReactingRef.current = false
      return
    }
    wasReactingRef.current = true
    applyMood({ type: 'ALERT' })
    effectsRef.current?.clear('sleep')
    effectsRef.current?.clear('heart')
    const id = window.setInterval(() => applyMood({ type: 'ALERT' }), 700)
    return () => window.clearInterval(id)
  }, [reacting, applyMood])

  // Anger puffs while actually standing at the toast (the "nudge" itself).
  useEffect(() => {
    if (!reacting || reducedMotion) return
    const bark = (): void => {
      const p = posRef.current
      const sz = sizeRef.current
      effectsRef.current?.anger(p.x + sz * 0.72, p.y + sz * 0.22)
    }
    bark()
    const id = window.setInterval(bark, interacting ? 450 : 850)
    return () => window.clearInterval(id)
  }, [interacting, reacting, reducedMotion])

  // --- auto-close: paw the toast shut, then return to natural form ----------
  // Only in auto-close mode. The moment the pup arrives beside the toast (enters
  // `interact`), it throws one decisive forward paw-swat; at the swat's forward
  // peak we ask main to dismiss that specific toast. We do NOT skip "interactive"
  // toasts — the user chose "close everything" — so no gate on n.interactive here.
  //
  // Main is the trust boundary (it re-checks mode + pause before relaying to the
  // watcher), and only the watcher-minted id crosses — never any toast text (§7).
  // If the close doesn't land, NOTIFICATION_CLOSED never arrives and the machine's
  // own safety timeout walks the pup back to roaming, so we can't get stuck.
  useEffect(() => {
    if (!interacting || behaviorModeRef.current !== 'autoClose') return
    const id = notifIdRef.current
    if (!id) return
    setSwatNonce((n) => n + 1) // fire the one-shot swat animation
    const timer = window.setTimeout(() => {
      window.nudge?.closeNotification(id)
    }, SWAT_PEAK_MS)
    return () => window.clearTimeout(timer)
  }, [interacting])

  // --- photogenic sparkles: twinkle around the head while posing (Feature 3) --
  // Mirrors the sleepy-z / nudge-anger sustain emitters — a burst on entry, then
  // a gentle repeat for the ~3s pose — so the "say cheese" moment reads as a
  // little camera-flash shimmer around the pup's head. Keyed on `posing`, so it
  // stops the instant the pup resumes roaming (posing flips false).
  useEffect(() => {
    if (!posing) return
    const flash = (): void => {
      const p = posRef.current
      const sz = sizeRef.current
      effectsRef.current?.sparkles(p.x + sz * 0.5, p.y + sz * 0.22, 4)
    }
    flash()
    const id = window.setInterval(flash, 520)
    return () => window.clearInterval(id)
  }, [posing])

  // --- sound-sensitive dance (Feature 2) ------------------------------------
  // Follow Windows' read-only playback meter (no capture) and drive the dance:
  // the detector's on/off edges flip the machine's `dance` state via
  // MUSIC_START / MUSIC_STOP, and each detected beat pops the sprite + puffs a
  // musical note. Gated by the "Dance to music" toggle and Pause (audioEnabled);
  // the hook captures nothing while disabled. Detection is pure + tested in
  // audioBeat.ts; the Web-Audio plumbing lives in useSystemAudio.ts.
  const onMusicChange = useCallback(
    (active: boolean): void => {
      send({ type: active ? 'MUSIC_START' : 'MUSIC_STOP' })
      // When a song ends, forget its tempo so the next one starts at the natural
      // bop rather than inheriting the last song's speed.
      if (!active) setDanceTempo(1)
    },
    [send]
  )
  const onBeat = useCallback((tempoScale: number): void => {
    // Track the music's tempo regardless of dance ramp state (so the bop is
    // already at the right speed the instant dancing shows). Skip redundant
    // updates: only re-render when the estimate moves enough to matter.
    setDanceTempo((prev) => (Math.abs(prev - tempoScale) < 0.03 ? prev : tempoScale))
    // Only while actually dancing: a note puff during the brief pre-dance beat
    // ramp (or from a lone system chime that never becomes a song) would confuse.
    if (machineStateRef.current !== 'dance') return
    setBeatNonce((n) => n + 1) // sprite's one-shot beat squash-&-stretch
    const p = posRef.current
    const sz = sizeRef.current
    effectsRef.current?.notes(p.x + sz * 0.5, p.y + sz * 0.12, 1) // ♪ doodle
  }, [])
  useSystemAudio({ enabled: audioEnabled && !dozing, onBeat, onMusicChange })

  // --- pointer: click-through toggle + pet-vs-drag --------------------------
  useEffect(() => {
    const down = { x: 0, y: 0 }
    const offset = { x: 0, y: 0 }
    let cursor: Vec2 | null = null
    let pending = false // pressed on the pup, not yet moved enough to be a drag

    function spriteRect(): { left: number; top: number; right: number; bottom: number } {
      const p = posRef.current
      const sz = sizeRef.current
      return { left: p.x, top: p.y, right: p.x + sz, bottom: p.y + sz }
    }
    function overSprite(x: number, y: number): boolean {
      return isPointInRect(x, y, spriteRect(), HIT_PADDING)
    }
    function setIgnoring(next: boolean): void {
      if (ignoringRef.current === next) return
      ignoringRef.current = next
      window.nudge?.setMouseIgnore(next)
      setInteractive(!next)
    }

    function onMouseMove(e: MouseEvent): void {
      cursor = { x: e.clientX, y: e.clientY }
      if (draggingRef.current) {
        if (!(e.buttons & 1)) {
          cancelPress()
          return
        }
        send({ type: 'DRAG_MOVE', position: { x: e.clientX - offset.x, y: e.clientY - offset.y } })
        return
      }
      if (pending) {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
        if (moved > DRAG_THRESHOLD) {
          // Promote the press to a real drag.
          pending = false
          send({ type: 'PICK_UP' })
          applyMood({ type: 'DRAG_START' })
          send({
            type: 'DRAG_MOVE',
            position: { x: e.clientX - offset.x, y: e.clientY - offset.y }
          })
        }
        return
      }
      // Plain hover: interactive only while over the (moving) pup.
      setIgnoring(!overSprite(e.clientX, e.clientY))
    }

    function onMouseDown(e: MouseEvent): void {
      if (e.button !== 0 || !overSprite(e.clientX, e.clientY)) return
      cursor = { x: e.clientX, y: e.clientY }
      if (dozingRef.current) {
        dozingRef.current = false
        send({ type: 'WAKE' })
        applyMood({ type: 'CALM' })
        return
      }
      // Capture the mouse now; decide pet-vs-drag on move/up.
      down.x = e.clientX
      down.y = e.clientY
      offset.x = e.clientX - posRef.current.x
      offset.y = e.clientY - posRef.current.y
      pending = true
      setIgnoring(false)
    }

    function onMouseUp(e: MouseEvent): void {
      if (e.button !== 0) return
      if (draggingRef.current) {
        send({ type: 'DROP' })
        applyMood({ type: 'DRAG_END' })
      } else if (pending) {
        // Released without dragging => a pet: affection + hearts.
        applyMood({ type: 'PET' })
        const p = posRef.current
        const sz = sizeRef.current
        effectsRef.current?.hearts(p.x + sz * 0.54, p.y + sz * 0.28)
      }
      pending = false
      // Re-evaluate click-through under the cursor's final position.
      setIgnoring(!overSprite(e.clientX, e.clientY))
    }

    function onContextMenu(e: MouseEvent): void {
      e.preventDefault()
      if (!overSprite(e.clientX, e.clientY) || draggingRef.current) return
      pending = false
      dozingRef.current = true
      send({ type: 'SLEEP' })
      applyMood({ type: 'CALM' })
    }

    function cancelPress(): void {
      pending = false
      if (draggingRef.current) {
        send({ type: 'DROP' })
        applyMood({ type: 'DRAG_END' })
      }
      cursor = null
      setIgnoring(true)
    }

    refreshHitTestRef.current = () => {
      if (!draggingRef.current && !pending && cursor) setIgnoring(!overSprite(cursor.x, cursor.y))
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('blur', cancelPress)
    document.addEventListener('mouseleave', cancelPress)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('blur', cancelPress)
      document.removeEventListener('mouseleave', cancelPress)
      refreshHitTestRef.current = () => {}
    }
  }, [send, applyMood])

  const { position, facing } = state.context
  const dragging = state.matches('dragging')
  const idle = state.matches('idle')
  const spriteSize = config.spriteSize
  // HYBRID walk: show the side-profile 4-leg gait whenever the pup is genuinely
  // crossing the screen — free-roaming (wander), trotting to a toast (travel), or
  // scurrying up to the camera (webcamTravel). Wander is gated on !paused so a pup
  // frozen mid-stroll doesn't "walk in place". (travel/webcamTravel are allowed to
  // finish even while paused, so they aren't gated.)
  const moving =
    state.matches('travel') ||
    state.matches('sleepTravel') ||
    (state.matches('webcamTravel') && !pausedRef.current) ||
    (state.matches('wander') && !pausedRef.current)
  // Raise a front paw while reacting in place: the "notice" beat (alert) and the
  // nudge (interact). NOT during travel — that's the walk, and a raised paw would
  // fight the gait (SpriteCanvas also forces the front pose whenever gesturing).
  const gesturing = state.matches('alert') || state.matches('interact')
  // Bop in place while the machine is in its music `dance` state — but Pause
  // freezes everything, so a paused pup holds still even mid-song.
  const dancing = state.matches('dance') && !pausedRef.current

  return (
    <div className="stage">
      <div
        className="sprite-container"
        data-state={String(state.value)}
        data-character={species.id}
        role="img"
        aria-label={`${species.label}: ${sleeping ? 'sleeping. Click to wake' : dozing ? 'going to sleep. Click to wake' : 'click to pet, drag to move, right-click to sleep'}`}
        title={dozing ? 'Click to wake up' : 'Click to pet · Drag to move · Right-click to sleep'}
        style={{
          width: spriteSize,
          height: spriteSize,
          transform: `translate(${position.x}px, ${position.y}px)`
        }}
      >
        <SpriteCanvas
          size={spriteSize}
          facing={facing}
          expression={reacting ? 'angry' : expression}
          frontFacing={facesFront(String(state.value), state.context)}
          species={species}
          palette={palette}
          dragging={dragging}
          idle={idle}
          energy={energy}
          reducedMotion={reducedMotion}
          moving={moving}
          sleeping={sleeping}
          distanceTravelled={state.context.distanceTravelled}
          frozen={pausedRef.current && !moving && !dragging && !sleeping}
          gesturing={gesturing}
          swatNonce={swatNonce}
          dancing={dancing}
          beatNonce={beatNonce}
          danceTempo={danceTempo}
          posing={posing}
          hopNonce={hopNonce}
        />
      </div>
      <EffectsCanvas ref={effectsRef} />
      {import.meta.env.DEV && (
        <div className="debug-badge">
          Nudge · {String(state.value)} · {expression} · {interactive ? 'active' : 'click-through'}
          {pausedRef.current ? ' · paused' : ''}
        </div>
      )}
    </div>
  )
}

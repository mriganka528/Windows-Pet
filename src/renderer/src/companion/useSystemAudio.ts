import { useEffect, useRef } from 'react'
import {
  initBeatState,
  stepBeat,
  energyFromFrequencies,
  DEFAULT_BEAT_CONFIG,
  type BeatConfig,
  type BeatState
} from './audioBeat'

// ---------------------------------------------------------------------------
// useSystemAudio — listen to the PC's own audio and detect music + beats.
// ---------------------------------------------------------------------------
// This is the ONE place in the app that touches Web Audio. It captures the
// system's audio OUTPUT (loopback) — never the microphone — reduces each frame
// to a single bass-band energy scalar, and runs the pure `audioBeat` detector to
// answer two questions:
//   • musicChanged → a song started / stopped (hysteretic on/off edges)
//   • beat         → a percussive transient hit this frame
// It reports those through callbacks; all the animation lives in the components
// that consume them (the machine's `dance` state + the sprite's bop + the
// musical-note puffs). Keeping the detection math in the pure module means the
// only thing here is the (untestable-in-CI) audio plumbing.
//
// How loopback capture works WITHOUT a screen-picker prompt: the main process
// installs a `setDisplayMediaRequestHandler` that answers our getDisplayMedia()
// request directly with the primary screen's video + 'loopback' audio. Chromium
// requires a video track to be requested for getDisplayMedia, so we ask for
// video too — then stop that track the instant the stream arrives and keep only
// the audio. The AnalyserNode taps the audio without routing it to the speakers
// (we never connect it to `destination`), so nothing is echoed back.
//
// Privacy: audio is analyzed in-process into numbers and never stored, sent, or
// surfaced as content (mirrors the notification watcher's "geometry only" rule).
// If loopback is denied — older Windows, the handler missing, the user's OS
// refusing — the hook degrades to a silent no-op and the companion simply never
// dances. It also stays entirely dormant while `enabled` is false, so pausing
// Nudge (or turning the toggle off) stops all listening.

export interface UseSystemAudioOptions {
  /** Master switch: capture ONLY while true (reactToAudio && !paused). Flipping
   *  it false tears the capture down completely so we stop listening — and, if a
   *  song was playing, emits a final music-stop so downstream state can't get
   *  stuck "dancing" after we've stopped hearing anything. */
  enabled: boolean
  /** Fires once per detected percussive transient (drives the sprite's beat
   *  "pop" + a musical-note puff). Receives the current tempo-derived dance-speed
   *  multiplier (1 = natural bop; >1 faster song, <1 slower) so the dance can
   *  track the music's tempo. May fire several times a second. */
  onBeat?: (tempoScale: number) => void
  /** Fires only on the music on/off EDGES (never every frame): true when a song
   *  is first detected, false when it's been quiet long enough to count as over. */
  onMusicChange?: (active: boolean) => void
  /** Detector overrides for tuning; defaults to DEFAULT_BEAT_CONFIG. */
  config?: BeatConfig
}

export function useSystemAudio({
  enabled,
  onBeat,
  onMusicChange,
  config = DEFAULT_BEAT_CONFIG
}: UseSystemAudioOptions): void {
  // Keep the latest callbacks/config in refs so the capture effect depends only
  // on `enabled`. Re-creating the handlers on each parent render must NOT tear
  // down and re-request the audio stream — that would re-run getDisplayMedia
  // constantly and thrash the AudioContext.
  const onBeatRef = useRef(onBeat)
  const onMusicChangeRef = useRef(onMusicChange)
  const configRef = useRef(config)
  onBeatRef.current = onBeat
  onMusicChangeRef.current = onMusicChange
  configRef.current = config

  useEffect(() => {
    if (!enabled) return
    // Non-secure/edge contexts may lack the API entirely — bail safely.
    const media = navigator.mediaDevices
    if (!media || typeof media.getDisplayMedia !== 'function') return

    // Closed-over teardown state. `cancelled` guards the async gap between
    // requesting the stream and it arriving: if `enabled` flips false (or we
    // unmount) first, the resolved stream is stopped immediately and the loop
    // never starts.
    let cancelled = false
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null
    let raf = 0
    let last = 0
    // `beatState` is reassigned each frame; the cleanup closure sees the latest
    // value (shared `let`), which is how we know whether to emit a final stop.
    let beatState: BeatState = initBeatState()

    const start = async (): Promise<void> => {
      let s: MediaStream
      try {
        // video:true is required by Chromium for a getDisplayMedia request even
        // though we only want audio; the main handler supplies 'loopback' audio.
        s = await media.getDisplayMedia({ video: true, audio: true })
      } catch {
        // Denied / unsupported / no handler — degrade silently to "never dances".
        return
      }
      if (cancelled) {
        for (const t of s.getTracks()) t.stop()
        return
      }
      stream = s
      // Drop the video track immediately — we only ever wanted the audio.
      for (const t of s.getVideoTracks()) t.stop()

      if (s.getAudioTracks().length === 0) {
        // Loopback wasn't granted (video-only stream) — nothing to analyze.
        for (const t of s.getTracks()) t.stop()
        stream = null
        return
      }

      audioCtx = new AudioContext()
      // Autoplay policy can start the context suspended; resume so data flows.
      if (audioCtx.state === 'suspended') void audioCtx.resume()
      const source = audioCtx.createMediaStreamSource(s)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024 // 512 frequency bins — plenty for a bass-band mean
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      // NOTE: deliberately NOT connected to audioCtx.destination — tapping the
      // signal for analysis must not re-play it out of the speakers.
      const freq = new Uint8Array(analyser.frequencyBinCount)

      last = performance.now()
      const loop = (now: number): void => {
        if (cancelled) return
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        analyser.getByteFrequencyData(freq)
        const energy = energyFromFrequencies(freq)
        const res = stepBeat(beatState, { energy, dt }, configRef.current)
        beatState = res.state
        if (res.beat) onBeatRef.current?.(res.tempoScale)
        if (res.musicChanged) onMusicChangeRef.current?.(res.state.musicActive)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }

    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      // If we tear down mid-song, tell the consumer the music is "off" so the
      // machine leaves the dance state instead of resuming it stale on re-enable.
      if (beatState.musicActive) onMusicChangeRef.current?.(false)
      if (stream) for (const t of stream.getTracks()) t.stop()
      if (audioCtx) void audioCtx.close()
    }
  }, [enabled])
}

import { useEffect, useRef } from 'react'
import { initBeatState, stepBeat, DEFAULT_BEAT_CONFIG, type BeatConfig } from './audioBeat'

export interface UseSystemAudioOptions {
  enabled: boolean
  onBeat?: (tempoScale: number) => void
  onMusicChange?: (active: boolean) => void
  config?: BeatConfig
}

/** Detect rhythm from Windows' read-only output meter. No browser media capture. */
export function useSystemAudio({
  enabled,
  onBeat,
  onMusicChange,
  config = DEFAULT_BEAT_CONFIG
}: UseSystemAudioOptions): void {
  const callbacks = useRef({ onBeat, onMusicChange, config })
  callbacks.current = { onBeat, onMusicChange, config }

  useEffect(() => {
    const api = window.nudge
    if (!enabled || !api?.onAudioLevel || !api?.setAudioMonitoring) return
    let alive = true
    let state = initBeatState()
    let last = performance.now()
    let received = last
    const stopMusic = (): void => {
      if (state.musicActive) callbacks.current.onMusicChange?.(false)
      state = initBeatState()
    }
    const off = api.onAudioLevel((sample) => {
      if (!alive) return
      const now = performance.now()
      const dt = Math.max(0.001, Math.min(0.1, (now - last) / 1000))
      received = last = now
      if (!sample.available) {
        stopMusic()
        return
      }
      // Perceptual scaling keeps quiet music responsive without amplifying silence.
      const energy = Math.sqrt(Math.max(0, Math.min(1, sample.level)))
      const result = stepBeat(state, { energy, dt }, callbacks.current.config)
      state = result.state
      if (result.musicChanged) callbacks.current.onMusicChange?.(state.musicActive)
      if (result.beat) callbacks.current.onBeat?.(result.tempoScale)
    })
    api.setAudioMonitoring(true)
    // A dead helper or disconnected bridge must not leave the pet dancing forever.
    const watchdog = setInterval(() => {
      if (performance.now() - received > 1600) stopMusic()
    }, 250)
    return () => {
      alive = false
      off()
      clearInterval(watchdog)
      api.setAudioMonitoring(false)
      stopMusic()
    }
  }, [enabled])
}

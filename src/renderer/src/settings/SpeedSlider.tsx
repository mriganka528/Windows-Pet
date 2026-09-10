import { useEffect, useRef, useState } from 'react'
import { WANDER_SPEED_MIN, WANDER_SPEED_MAX } from '../../../shared/settings'

export function SpeedSlider({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const latest = useRef(value)
  const editing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const commitRef = useRef(onChange)
  commitRef.current = onChange
  useEffect(() => {
    if (!editing.current) {
      setDraft(value)
      latest.current = value
    }
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = (): void => {
    clearTimeout(timer.current)
    commitRef.current(latest.current)
  }
  const finish = (): void => {
    editing.current = false
    commit()
  }
  return (
    <div className="speed-control">
      <div className="speed-heading">
        <label htmlFor="wander-speed">Wandering speed</label>
        <output htmlFor="wander-speed">{draft}%</output>
      </div>
      <input
        id="wander-speed"
        type="range"
        min={WANDER_SPEED_MIN}
        max={WANDER_SPEED_MAX}
        step={5}
        value={draft}
        aria-valuetext={`${draft}% of normal speed`}
        aria-describedby="wander-speed-help"
        onPointerDown={() => {
          editing.current = true
        }}
        onChange={(event) => {
          editing.current = true
          latest.current = Number(event.target.value)
          setDraft(latest.current)
          clearTimeout(timer.current)
          timer.current = setTimeout(commit, 140)
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
      <div className="speed-scale">
        <span>Slow · 25%</span>
        <span>Normal · 100%</span>
        <span>Fast · 200%</span>
      </div>
      <p id="wander-speed-help" className="control-help">
        Changes normal roaming. Notification reactions and the trip to bed stay quick.
      </p>
    </div>
  )
}

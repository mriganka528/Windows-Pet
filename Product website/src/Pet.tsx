import { useEffect, useMemo, useRef, useState } from 'react'
import { SpriteCanvas } from '../../src/renderer/src/companion/SpriteCanvas'
import { speciesFor } from '../../src/renderer/src/companion/species'
import { speciesWithCoat } from '../../src/renderer/src/companion/coats'
import type { CharacterId, ColorThemeId } from '../../src/shared/settings'
import type { Mood } from '../../src/renderer/src/companion/mood'

export type Pose = 'idle' | 'love' | 'dance' | 'sleep' | 'wave' | 'alert'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

export function Pet({
  id = 'cat',
  coat = 'natural',
  mood = 'happy',
  pose = 'idle',
  size = 160,
  still = false,
  className = ''
}: {
  id?: CharacterId
  coat?: ColorThemeId
  mood?: Mood
  pose?: Pose
  size?: number
  still?: boolean
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(true)
  const reduced = useReducedMotion()
  const species = useMemo(() => speciesWithCoat(speciesFor(id), coat), [id, coat])
  useEffect(() => {
    if (!ref.current || still) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '80px'
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [still])
  const expression =
    pose === 'love' ? 'love' : pose === 'sleep' ? 'sleepy' : pose === 'alert' ? 'angry' : mood
  return (
    <span
      ref={ref}
      className={`pet-art ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <SpriteCanvas
        key={`${id}-${coat}-${pose}-${expression}-${reduced}`}
        size={size}
        facing="right"
        expression={expression}
        species={species}
        palette={species.palette}
        dragging={false}
        idle={pose === 'idle' || pose === 'love'}
        frontFacing={pose !== 'sleep'}
        sleeping={pose === 'sleep'}
        dancing={pose === 'dance'}
        posing={pose === 'wave'}
        still={still || !visible || reduced}
        reducedMotion={reduced}
      />
    </span>
  )
}

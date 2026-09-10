import { describe, expect, it } from 'vitest'
import { SPECIES_ORDER, speciesFor } from './species'
import { buildModel, tail } from './spriteModel'
import { buildFrontModel } from './frontModel'
import { coatLabel, coatPalette, speciesWithCoat } from './coats'
import { THEME_ORDER, MOOD_ORDER } from '../../../shared/settings'
import { facesFront, wantsFrontPose } from './presentation'

describe('front views, tails and coats', () => {
  it('gives all seven moods distinct faces in both orientations for every animal', () => {
    for (const id of SPECIES_ORDER)
      for (const build of [buildModel, buildFrontModel]) {
        const faces = MOOD_ORDER.map((expr) =>
          JSON.stringify(build(speciesFor(id), { expr }).find((part) => part.id === 'face')!.prims)
        )
        expect(new Set(faces).size).toBe(MOOD_ORDER.length)
        const angry = build(speciesFor(id), { expr: 'angry' }).find((part) => part.id === 'face')!
        const grumpy = build(speciesFor(id), { expr: 'grumpy' }).find((part) => part.id === 'face')!
        expect(angry.prims.some((prim) => prim.stroke?.color === '#D14B40')).toBe(true)
        expect(grumpy.prims.some((prim) => prim.stroke?.color === '#D14B40')).toBe(false)
      }
  })
  it('draws two glossy eyes in the front and three-quarter views', () => {
    for (const id of SPECIES_ORDER) {
      const sp = speciesFor(id)
      const front = buildFrontModel(sp, { expr: 'neutral' }).find((p) => p.id === 'face')!
      const profile = buildModel(sp, { expr: 'neutral' }).find((p) => p.id === 'face')!
      expect(front.prims.filter((p) => p.fill === '#FFFFFF')).toHaveLength(2)
      expect(profile.prims.filter((p) => p.fill === '#FFFFFF')).toHaveLength(2)
      expect(profile.prims).not.toEqual(front.prims)
    }
  })

  it('shows front poses for social reactions and keeps sleep in profile', () => {
    const context = { frontRemaining: 0, idleFront: false }
    for (const state of ['interact', 'celebrate', 'posing', 'dance'])
      expect(facesFront(state, context)).toBe(true)
    expect(wantsFrontPose({ dancing: true })).toBe(true)
    expect(wantsFrontPose({ posing: true })).toBe(true)
    expect(wantsFrontPose({ sleeping: true, dancing: true, frontFacing: true })).toBe(false)
    expect(facesFront('sleepTravel', { ...context, frontRemaining: 1 })).toBe(false)
  })

  it('gives every tailed animal visible geometry while leaving frogs and koalas tailless', () => {
    for (const id of SPECIES_ORDER) {
      for (const front of [true, false]) {
        const parts = tail(speciesFor(id), 65, 0, front)
        if (id === 'frog' || id === 'koala') expect(parts).toHaveLength(0)
        else expect(parts.length).toBeGreaterThan(0)
      }
    }
    expect(speciesFor('dog').tail).toBe('plume')
    expect(speciesFor('penguin').tail).toBe('feather')
    expect(speciesFor('bunny').tail).toBe('stub')
  })

  it('resolves every coat for every animal without mutating its natural colors', () => {
    expect(THEME_ORDER).toHaveLength(15)
    for (const id of SPECIES_ORDER) {
      const original = speciesFor(id)
      const before = structuredClone(original)
      for (const coat of THEME_ORDER) {
        const palette = coatPalette(original, coat)
        expect(palette.fur).toMatch(/^#[\da-f]{6}$/i)
        expect(palette.cream).toMatch(/^#[\da-f]{6}$/i)
        expect(coatLabel(original, coat)).toBeTruthy()
        expect(speciesWithCoat(original, coat).id).toBe(id)
      }
      expect(original).toEqual(before)
    }
  })

  it('recolors panda markings and fox tail tips along with their chosen coat', () => {
    const panda = speciesWithCoat(speciesFor('panda'), 'natural-warm')
    expect(panda.markColor).toBe('#876047')
    const fox = speciesWithCoat(speciesFor('fox'), 'natural-light')
    expect(fox.pawColor).toBe(fox.markColor)
    expect(fox.tailAccent).toBe(fox.palette.cream)
  })
})

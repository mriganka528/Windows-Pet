import type { CharacterId } from '../../../shared/settings'

export type GaitKind = 'walk' | 'hop' | 'waddle' | 'scurry' | 'biped'
export type LegName = 'legFarBack' | 'legFarFront' | 'legNearBack' | 'legNearFront'

export interface Anatomy {
  bodyY: number
  bodyRX: number
  bodyRY: number
  headX: number
  headY: number
  headRX: number
  headRY: number
  legWidth: number
  earSize: number
  stride: number
  gait: GaitKind
  frontHeadY: number
  frontHeadRX: number
  frontHeadRY: number
}

const CAT: Anatomy = {
  bodyY: 67,
  bodyRX: 25,
  bodyRY: 18,
  headX: 72,
  headY: 41,
  headRX: 20,
  headRY: 20,
  legWidth: 5,
  earSize: 13,
  stride: 29,
  gait: 'walk',
  frontHeadY: 33,
  frontHeadRX: 25,
  frontHeadRY: 23
}

/** Rounded young-animal silhouettes inspired by the supplied character sheet. */
export const ANATOMY: Record<CharacterId, Anatomy> = {
  cat: CAT,
  dog: {
    ...CAT,
    bodyRY: 19,
    headX: 71,
    headRX: 20,
    headRY: 21,
    earSize: 15,
    legWidth: 5.5,
    stride: 31
  },
  fox: {
    ...CAT,
    bodyRY: 16,
    headY: 42,
    headRX: 20,
    headRY: 19,
    earSize: 16,
    stride: 32,
    frontHeadY: 35,
    frontHeadRY: 22
  },
  bunny: {
    ...CAT,
    bodyY: 71,
    bodyRX: 24,
    bodyRY: 20,
    headX: 70,
    headY: 48,
    headRX: 21,
    headRY: 19,
    earSize: 26,
    legWidth: 5.5,
    stride: 36,
    gait: 'hop',
    frontHeadY: 46,
    frontHeadRX: 24,
    frontHeadRY: 21
  },
  panda: {
    ...CAT,
    bodyY: 68,
    bodyRX: 23,
    bodyRY: 22,
    headX: 60,
    headY: 32,
    headRX: 25,
    headRY: 24,
    earSize: 8,
    legWidth: 7,
    stride: 23,
    gait: 'biped',
    frontHeadY: 31,
    frontHeadRX: 27,
    frontHeadRY: 24
  },
  bear: {
    ...CAT,
    bodyRX: 27,
    bodyRY: 21,
    headX: 70,
    headY: 43,
    headRX: 22,
    headRY: 21,
    earSize: 7,
    legWidth: 6,
    stride: 24,
    frontHeadRX: 26
  },
  penguin: {
    ...CAT,
    bodyY: 57,
    bodyRX: 27,
    bodyRY: 35,
    headX: 60,
    headY: 34,
    headRX: 21,
    headRY: 23,
    earSize: 0,
    stride: 17,
    gait: 'waddle',
    frontHeadY: 32,
    frontHeadRX: 24,
    frontHeadRY: 25
  },
  redpanda: {
    ...CAT,
    bodyY: 68,
    bodyRX: 24,
    bodyRY: 19,
    headX: 70,
    headY: 45,
    headRX: 21,
    headRY: 20,
    earSize: 9,
    legWidth: 5.5,
    stride: 24,
    frontHeadRX: 26
  },
  hamster: {
    ...CAT,
    bodyY: 73,
    bodyRX: 25,
    bodyRY: 19,
    headX: 69,
    headY: 53,
    headRX: 21,
    headRY: 19,
    earSize: 5.5,
    legWidth: 4,
    stride: 15,
    gait: 'scurry',
    frontHeadY: 40,
    frontHeadRX: 25,
    frontHeadRY: 22
  },
  frog: {
    ...CAT,
    bodyY: 75,
    bodyRX: 25,
    bodyRY: 16,
    headX: 67,
    headY: 57,
    headRX: 23,
    headRY: 16,
    earSize: 0,
    legWidth: 5.5,
    stride: 37,
    gait: 'hop',
    frontHeadY: 54,
    frontHeadRX: 27,
    frontHeadRY: 18
  },
  tiger: {
    ...CAT,
    bodyRX: 27,
    bodyRY: 20,
    headRX: 21,
    headRY: 21,
    earSize: 7.5,
    legWidth: 5.7,
    stride: 30,
    frontHeadRX: 26
  },
  koala: {
    ...CAT,
    bodyY: 70,
    bodyRX: 25,
    bodyRY: 21,
    headX: 68,
    headY: 45,
    headRX: 23,
    headRY: 22,
    earSize: 11,
    legWidth: 6,
    stride: 21,
    frontHeadY: 36,
    frontHeadRX: 26,
    frontHeadRY: 23
  },
  pig: {
    ...CAT,
    bodyY: 69,
    bodyRX: 27,
    bodyRY: 21,
    headX: 70,
    headY: 47,
    headRX: 22,
    headRY: 21,
    earSize: 12,
    legWidth: 5.5,
    stride: 22,
    frontHeadY: 36
  },
  mouse: {
    ...CAT,
    bodyY: 74,
    bodyRX: 23,
    bodyRY: 16,
    headX: 70,
    headY: 53,
    headRX: 20,
    headRY: 18,
    earSize: 10,
    legWidth: 3.7,
    stride: 15,
    gait: 'scurry',
    frontHeadY: 41,
    frontHeadRX: 22,
    frontHeadRY: 20
  },
  chick: {
    ...CAT,
    bodyY: 65,
    bodyRX: 24,
    bodyRY: 25,
    headX: 62,
    headY: 37,
    headRX: 22,
    headRY: 22,
    earSize: 0,
    stride: 18,
    gait: 'waddle',
    frontHeadY: 34,
    frontHeadRX: 24,
    frontHeadRY: 23
  }
}

const WALK_PHASE: Record<LegName, number> = {
  legNearBack: 0,
  legNearFront: 0.25,
  legFarBack: 0.5,
  legFarFront: 0.75
}
const RUN_PHASE: Record<LegName, number> = {
  legNearFront: 0,
  legFarFront: 0.12,
  legNearBack: 0.52,
  legFarBack: 0.64
}

/** A paw is planted for 64% of a walking stride, then lifts and swings forward.
 * The stance travels back linearly: advancing phase by distance / stride keeps
 * that paw fixed against the desktop rather than skating under a swinging leg. */
export function footPose(
  phase: number,
  leg: LegName,
  anatomy: Anatomy,
  amount: number,
  strideScale = 1
): { x: number; y: number } {
  const hop = anatomy.gait === 'hop'
  const run = Math.min(1, Math.max(0, (strideScale - 1) / 2.5))
  const bounding = anatomy.gait === 'walk' || anatomy.gait === 'scurry'
  const offset = hop
    ? leg.endsWith('Back')
      ? 0
      : 0.16
    : WALK_PHASE[leg] + (bounding ? (RUN_PHASE[leg] - WALK_PHASE[leg]) * run : 0)
  const cycle = (((phase + offset) % 1) + 1) % 1
  const stance = hop ? 0.42 : 0.64 - run * 0.3
  const reach = anatomy.stride * strideScale * stance
  let x: number
  let y = 0
  if (cycle < stance) {
    x = reach * (0.5 - cycle / stance)
  } else {
    const swing = (cycle - stance) / (1 - stance)
    const ease = swing * swing * (3 - 2 * swing)
    x = reach * (ease - 0.5)
    y = -Math.sin(swing * Math.PI) * (hop ? 7 : anatomy.gait === 'scurry' ? 2.5 : 4)
  }
  return { x: x * amount, y: y * amount }
}

/** Two-bone limb with a stable knee/hock direction. */
export function jointBetween(
  hip: { x: number; y: number },
  foot: { x: number; y: number },
  length: number,
  bend: number
): { x: number; y: number } {
  const dx = foot.x - hip.x
  const dy = foot.y - hip.y
  const distance = Math.max(0.001, Math.hypot(dx, dy))
  const offset = Math.sqrt(Math.max(0, length * length - (distance * distance) / 4)) * bend
  return {
    x: (hip.x + foot.x) / 2 + (dy / distance) * offset,
    y: (hip.y + foot.y) / 2 - (dx / distance) * offset
  }
}

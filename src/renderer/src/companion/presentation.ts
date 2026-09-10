export interface PresentationContext {
  frontRemaining: number
  idleFront: boolean
}

/** Face the viewer for social interactions, with occasional glances on walks. */
export function facesFront(state: string, context: PresentationContext): boolean {
  return (
    ['alert', 'interact', 'celebrate', 'dance', 'posing', 'dragging'].includes(state) ||
    (state === 'wander' && context.frontRemaining > 0) ||
    (state === 'idle' && context.idleFront)
  )
}

export function wantsFrontPose(props: {
  frontFacing?: boolean
  dancing?: boolean
  posing?: boolean
  gesturing?: boolean
  dragging?: boolean
  sleeping?: boolean
}): boolean {
  return (
    !props.sleeping &&
    !!(props.frontFacing || props.dancing || props.posing || props.gesturing || props.dragging)
  )
}

import type { CSSProperties } from 'react'

export type IconName =
  | 'paw'
  | 'download'
  | 'arrow'
  | 'play'
  | 'windows'
  | 'heart'
  | 'music'
  | 'moon'
  | 'sun'
  | 'bell'
  | 'sparkles'
  | 'check'
  | 'chevron'
  | 'close'
  | 'menu'
  | 'shield'
  | 'sliders'
  | 'mouse'
  | 'camera'
  | 'book'
  | 'copy'
  | 'expand'
  | 'folder'
  | 'volume'
  | 'minus'

const paths: Partial<Record<IconName, React.ReactNode>> = {
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  play: <path d="m9 5 11 7-11 7Z" />,
  heart: (
    <path d="M20.8 4.9a5.5 5.5 0 0 0-7.8 0L12 6l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.3a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13M9 9l11-2" />
      <ellipse cx="6" cy="18" rx="3" ry="3" />
      <ellipse cx="17" cy="16" rx="3" ry="3" />
    </>
  ),
  moon: <path d="M20.7 13.1A9 9 0 0 1 10.9 3.3 9 9 0 1 0 20.7 13.1Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      <path d="M12 2V1" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  shield: (
    <>
      <path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" fill="var(--icon-bg, #f8f7f2)" />
      <circle cx="16" cy="17" r="3" fill="var(--icon-bg, #f8f7f2)" />
    </>
  ),
  mouse: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="6" />
      <path d="M12 3v6" />
    </>
  ),
  camera: (
    <>
      <path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v11H2V8a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  book: (
    <>
      <path d="M12 5v16M12 5C8 2 5 2 2 3v16c4-1 7-1 10 2 3-3 6-3 10-2V3c-3-1-6-1-10 2Z" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  folder: <path d="M2 6V4h7l2 3h11v13H2V6Z" />,
  volume: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-12a11 11 0 0 1 0 16" />
    </>
  ),
  minus: <path d="M4 12h16" />
}

export function Icon({
  name,
  size = 20,
  className = '',
  style
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  if (name === 'paw')
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={className}
        style={style}
      >
        <ellipse cx="5.5" cy="8" rx="2.6" ry="3.4" transform="rotate(-25 5.5 8)" />
        <ellipse cx="11.2" cy="5.3" rx="2.6" ry="3.4" />
        <ellipse cx="17.5" cy="7.5" rx="2.6" ry="3.4" transform="rotate(25 17.5 7.5)" />
        <path d="M5 17c0-3.4 4.4-7 7-7s7 3.6 7 7c0 5-4.8 2.8-7 2.8S5 22 5 17Z" />
      </svg>
    )
  if (name === 'windows')
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={className}
      >
        <path d="M2 3h9v9H2Zm11 0h9v9h-9ZM2 14h9v9H2Zm11 0h9v9h-9Z" />
      </svg>
    )
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {paths[name]}
    </svg>
  )
}

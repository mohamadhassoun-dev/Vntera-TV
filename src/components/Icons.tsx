import type { SVGProps } from 'react'

export type IconName =
  | 'play'
  | 'pause'
  | 'plus'
  | 'check'
  | 'info'
  | 'search'
  | 'bell'
  | 'home'
  | 'tv'
  | 'film'
  | 'grid'
  | 'list'
  | 'heart'
  | 'user'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'settings'
  | 'logout'
  | 'volume'
  | 'mute'
  | 'maximize'
  | 'minimize'
  | 'rotate'
  | 'pip'
  | 'cast'
  | 'subtitles'
  | 'audio'
  | 'speed'
  | 'rewind'
  | 'forward'
  | 'next'
  | 'close'
  | 'filter'
  | 'sort'
  | 'star'
  | 'lock'
  | 'eye'
  | 'eyeOff'
  | 'server'
  | 'qr'
  | 'device'
  | 'wifi'
  | 'download'
  | 'share'
  | 'trash'
  | 'refresh'
  | 'clock'
  | 'alert'
  | 'calendar'
  | 'mic'
  | 'menu'
  | 'arrowLeft'
  | 'sparkles'
  | 'layers'
  | 'cloud'
  | 'globe'
  | 'shield'
  | 'checkCircle'
  | 'xCircle'
  | 'loader'
  | 'more'
  | 'headphones'
  | 'sliders'
  | 'power'
  | 'image'
  | 'guide'
  | 'flame'
  | 'external'

const P: Record<IconName, React.ReactNode> = {
  play: <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  bell: <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10.3 21a2 2 0 0 0 3.4 0" />,
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />,
  tv: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="m8 2 4 4 4-4" />
    </>
  ),
  film: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2.5 9h19M2.5 15h19" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  heart: <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 4.6h.1A1.7 1.7 0 0 0 8.9 3V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" transform="translate(1 0) scale(0.92)" />
    </>
  ),
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  volume: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  mute: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4Z" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </>
  ),
  maximize: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
  minimize: <path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" />,
  // A phone turning on its side: the "turn the picture" control.
  rotate: (
    <>
      <rect x="7" y="2" width="10" height="17" rx="2" />
      <path d="M3 17a9 9 0 0 0 3 4.5M21 7a9 9 0 0 0-3-4.5" />
    </>
  ),
  pip: (
    <>
      <rect x="2" y="4" width="20" height="15" rx="2" />
      <rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none" opacity="0.85" />
    </>
  ),
  cast: (
    <>
      <path d="M2 16.5a5.5 5.5 0 0 1 5.5 5.5M2 12a10 10 0 0 1 10 10M2 7.5A14.5 14.5 0 0 1 16.5 22" />
      <path d="M2 5V4a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
    </>
  ),
  subtitles: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 12h4M6 15.5h7M14 12h4" />
    </>
  ),
  audio: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2" y="14" width="4" height="7" rx="1.5" />
      <rect x="18" y="14" width="4" height="7" rx="1.5" />
    </>
  ),
  speed: (
    <>
      <path d="M4 18a9 9 0 1 1 16 0" />
      <path d="m12 14 4-4" />
    </>
  ),
  rewind: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  forward: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  next: (
    <>
      <path d="M5 5.5v13a1 1 0 0 0 1.5.86l9-6.5a1 1 0 0 0 0-1.72l-9-6.5A1 1 0 0 0 5 5.5Z" fill="currentColor" stroke="none" />
      <rect x="17" y="4" width="2.5" height="16" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8Z" />,
  sort: <path d="M4 7h13M4 12h9M4 17h5M18 9V4m0 0-2.5 2.5M18 4l2.5 2.5" />,
  star: <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9Z" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1" />
      <path d="m2 2 20 20M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 18v3" />
    </>
  ),
  device: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  wifi: <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a15 15 0 0 1 20 0" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />,
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />,
  refresh: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  alert: <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  arrowLeft: <path d="M19 12H5m0 0 7-7m-7 7 7 7" />,
  sparkles: <path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8ZM18 15l.9 2.1 2.1.9-2.1.9L18 21l-.9-2.1L15 18l2.1-.9Z" />,
  layers: <path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5" />,
  cloud: <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.7A4 4 0 0 0 7 19Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
    </>
  ),
  shield: <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  loader: <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  headphones: <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1ZM20 14h-3v6h2a1 1 0 0 0 1-1Z" />,
  sliders: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h9M17 18h3M14 4v4M8 10v4M13 16v4" />,
  power: <path d="M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </>
  ),
  guide: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10M15 10v10" />
    </>
  ),
  flame: <path d="M12 22c4 0 6.5-2.7 6.5-6 0-4.5-4.5-6.5-4-13-3 2-4 4.5-4 7 0 1.5-1 2-1.5 1.2C8 10 7 8.5 7 8.5 5.6 10 5.5 12 5.5 14c0 4.5 2.5 8 6.5 8Z" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  strokeWidth?: number
}

export function Icon({ name, size = 20, strokeWidth = 1.8, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {P[name]}
    </svg>
  )
}

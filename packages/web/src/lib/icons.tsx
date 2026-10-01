/**
 * Иконки интерфейса.
 *
 * Один набор штриховых SVG вместо внешней библиотеки: иконки нужны в одном
 * стиле и в одном размере, а лишняя зависимость в бандле только раздувает его.
 * Размер задаётся свойством `size`, толщина линии — общая для всех иконок.
 */

type IconProps = {
  size?: number
  className?: string
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
})

export const IconFolder = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />
  </svg>
)

export const IconChat = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </svg>
)

export const IconClock = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
)

export const IconPhone = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </svg>
)

export const IconSliders = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="10" cy="16" r="2" />
  </svg>
)

export const IconSun = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
  </svg>
)

export const IconMoon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2" />
  </svg>
)

export const IconMonitor = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </svg>
)

export const IconSend = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4.5 12h13M12.5 6.5 18.5 12l-6 5.5" />
  </svg>
)

export const IconPlus = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconStop = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconTrash = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </svg>
)

export const IconCopy = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6.5A1.5 1.5 0 0 0 13.5 5h-7A1.5 1.5 0 0 0 5 6.5v7A1.5 1.5 0 0 0 6.5 15H9" />
  </svg>
)

export const IconCheck = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M5 12.5 9.5 17 19 7" />
  </svg>
)

export const IconRefresh = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" />
  </svg>
)

export const IconPlay = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 5.5 18 12 8 18.5z" />
  </svg>
)

export const IconLogout = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h9" />
  </svg>
)

export const IconChevron = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </svg>
)

export const IconMenu = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const IconChart = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)

export const IconClose = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconDownload = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 4v11M6.5 10.5 12 16l5.5-5.5M5 19.5h14" />
  </svg>
)

export const IconFile = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
    <path d="M13.5 3.5v5h5" />
  </svg>
)

/** Иконка для кнопки переключения темы: показывает ту тему, что будет дальше. */
export const themeIcon = (theme: 'light' | 'dark' | 'system') => {
  if (theme === 'light') return IconSun
  if (theme === 'dark') return IconMoon
  return IconMonitor
}

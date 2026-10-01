/**
 * Выбор темы оформления: светлая, тёмная или как в системе.
 *
 * Реализация через атрибут `data-theme` на корневом элементе: тему видно и в
 * обычном CSS, и в `color-scheme` для нативных элементов (полосы прокрутки,
 * поле ввода, автозаполнение). Настройка `system` подписывается на событие
 * ОС, поэтому смена темы в системе подхватывается без перезагрузки.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { themeIcon } from './icons'

export type Theme = 'light' | 'dark' | 'system'
/** Что реально отрисовывается при выборе `system`. */
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'verstak.theme'

export const themeNames: Record<Theme, string> = {
  light: 'Светлая',
  dark: 'Тёмная',
  system: 'Как в системе',
}

const isTheme = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system'

const prefersDark = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export const readTheme = (): Theme => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export const writeTheme = (theme: Theme): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Приватный режим: выбор действует только в этой вкладке.
  }
}

/** Применяет тему к документу. Возвращает, что получилось на самом деле. */
export const applyTheme = (theme: Theme): ResolvedTheme => {
  const resolved: ResolvedTheme = theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme
  const root = document.documentElement
  // При `system` атрибут не ставим: тогда действует `@media (prefers-color-scheme)`.
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  root.style.colorScheme = resolved
  return resolved
}

/** Следующая тема по кругу — для кнопки-переключателя в шапке. */
export const nextTheme = (theme: Theme): Theme => {
  const order: Theme[] = ['light', 'dark', 'system']
  const index = order.indexOf(theme)
  return order[(index + 1) % order.length] ?? 'system'
}

export type ThemeApi = {
  theme: Theme
  resolved: ResolvedTheme
  setTheme: (theme: Theme) => void
  /** Переключает тему по кругу — для кнопки в шапке. */
  toggle: () => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

/**
 * Держит выбранную тему для всего приложения: переключатель в настройках и
 * кнопка в шапке должны видеть одно и то же значение, поэтому состояние
 * живёт в контексте, а не в отдельных хуках.
 */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => readTheme())
  const [resolved, setResolved] = useState<ResolvedTheme>(() => applyTheme(readTheme()))

  const setTheme = useCallback((next: Theme) => {
    writeTheme(next)
    setThemeState(next)
    setResolved(applyTheme(next))
  }, [])

  const toggle = useCallback(() => {
    setTheme(nextTheme(theme))
  }, [setTheme, theme])

  // При системной теме следим за настройками ОС: смена темы в системе
  // подхватывается сразу, без перезагрузки страницы.
  useEffect(() => {
    if (theme !== 'system') return
    let query: MediaQueryList
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const update = () => setResolved(applyTheme('system'))
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [theme])

  const value = useMemo<ThemeApi>(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeApi => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme вызван вне ThemeProvider')
  return context
}

/**
 * Кнопка быстрого переключения темы.
 *
 * Показывает иконку следующей темы, а не текущей: так понятнее, что
 * нажатие что-то изменит. Подпись — текущая тема, для наведения и скринридеров.
 */
export const ThemeToggle = ({ label }: { label: string }) => {
  const { theme, toggle } = useTheme()
  const NextIcon = themeIcon(theme)
  return (
    <button className="theme-toggle" onClick={toggle} title={label} aria-label={label}>
      <NextIcon size={16} />
    </button>
  )
}

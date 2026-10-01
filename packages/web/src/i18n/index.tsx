/**
 * Выбор языка и подстановка параметров в строки.
 *
 * Русский — язык по умолчанию. Выбор сохраняется в localStorage, но сервер
 * тоже присылает свой `locale` в конфигурации, поэтому первая загрузка
 * ориентируется на настройку сервера, а последующие — на выбор пользователя.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { dictionaries, localeNames, type Locale, type MessageKey } from './messages'

const STORAGE_KEY = 'verstak.locale'
export const DEFAULT_LOCALE: Locale = 'ru'

const normalize = (value: string | null | undefined): Locale | null => {
  if (!value) return null
  const lower = value.trim().toLowerCase().replace(/_/g, '-')
  if (lower === 'ru' || lower.startsWith('ru-')) return 'ru'
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  return null
}

export const readStoredLocale = (): Locale | null => {
  try {
    return normalize(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export const writeStoredLocale = (locale: Locale): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Приватный режим браузера: просто не сохраняем.
  }
}

export type I18n = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, params?: Record<string, string | number>) => string
  localeNames: Record<Locale, string>
}

const I18nContext = createContext<I18n | null>(null)

const interpolate = (template: string, params?: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    params && key in params ? String(params[key]) : match,
  )

export const I18nProvider = ({
  children,
  serverLocale,
}: {
  children: ReactNode
  serverLocale?: string | null
}) => {
  const [locale, setLocaleState] = useState<Locale>(
    () => readStoredLocale() ?? normalize(serverLocale) ?? DEFAULT_LOCALE,
  )

  // Язык сервера приходит после первого запроса, поэтому применяем его,
  // только если пользователь ещё ничего не выбрал вручную.
  useEffect(() => {
    const fromServer = normalize(serverLocale)
    if (fromServer && !readStoredLocale()) setLocaleState(fromServer)
  }, [serverLocale])

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next)
    setLocaleState(next)
    document.documentElement.lang = next
  }, [])

  const value = useMemo<I18n>(() => {
    const dictionary = dictionaries[locale]
    return {
      locale,
      setLocale,
      localeNames,
      t: (key, params) => interpolate(dictionary[key] ?? dictionaries.ru[key] ?? key, params),
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = (): I18n => {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n вызван вне I18nProvider')
  return context
}
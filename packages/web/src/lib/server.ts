/**
 * Адрес сервера и определение среды.
 *
 * В браузере интерфейс отдаёт сам сервер, поэтому запросы идут относительными
 * путями. В мобильном приложении страница живёт внутри телефона: относительный
 * путь указывал бы на сам телефон, поэтому адрес сервера хранится отдельно и
 * подставляется ко всем запросам.
 */

const SERVER_KEY = 'verstak.server'

/**
 * Работаем ли внутри мобильного приложения.
 *
 * Capacitor добавляет в страницу глобальный объект `Capacitor`; его наличие —
 * единственный надёжный признак. Отдельная зависимость для этого не нужна.
 *
 * Параметр `?native=1` позволяет открыть мобильные экраны в обычном браузере —
 * это нужно, чтобы проверить их вёрстку без сборки приложения.
 */
export const isNativePlatform = (): boolean => {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('native') === '1') return true
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return capacitor?.isNativePlatform?.() === true
}

/** Приводит введённый адрес к виду `http://хост:порт`. */
export const normalizeServerUrl = (input: string): string | null => {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Пользователь может ввести адрес без схемы — считаем, что это http:
  // локальный сервер почти всегда работает без TLS.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

  try {
    const url = new URL(withScheme)
    if (!url.hostname) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export const getServerUrl = (): string | null => {
  try {
    const stored = window.localStorage.getItem(SERVER_KEY)
    return stored ? stored : null
  } catch {
    return null
  }
}

export const setServerUrl = (url: string | null): void => {
  try {
    if (url) window.localStorage.setItem(SERVER_KEY, url)
    else window.localStorage.removeItem(SERVER_KEY)
  } catch {
    // Приватный режим: адрес будет действовать только в этой вкладке.
  }
}

/**
 * Нужно ли показать экран подключения к серверу.
 *
 * В браузере — никогда: страницу отдал сервер, значит адрес уже известен.
 * В приложении — пока адрес не сохранён.
 */
export const needsServerAddress = (): boolean => isNativePlatform() && getServerUrl() === null

/** Полный адрес запроса с учётом того, где открыт интерфейс. */
export const apiUrl = (path: string): string => {
  const server = getServerUrl()
  if (!server || !isNativePlatform()) return path
  return `${server}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Проверяет, что по адресу действительно Verstak.
 *
 * Ответ разбирается вручную: обычный `apiFetch` здесь не подходит, потому что
 * адрес ещё не сохранён и базовый URL ему неизвестен.
 */
export const probeServer = async (baseUrl: string, timeoutMs = 6000): Promise<{ ok: boolean; error?: string }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal })
    if (!response.ok) return { ok: false, error: `Сервер ответил кодом ${response.status}` }
    const payload = (await response.json()) as { app?: string; healthy?: boolean }
    if (payload.app !== 'Verstak') {
      return { ok: false, error: 'По этому адресу работает другая программа' }
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'Сервер не отвечает' : 'Не удалось подключиться'
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}

/** Платформа устройства — попадает в список подключённых устройств. */
export const detectPlatform = (): string | null => {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS'
  if (/android/.test(ua)) return 'Android'
  return null
}

/** Разбирает адрес с кодом сопряжения, полученный сканированием QR. */
export const parsePairingLink = (
  raw: string,
): { server: string; secret: string } | null => {
  const value = raw.trim()
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
    const secret = url.searchParams.get('pair')
    if (!secret) return null
    return { server: `http://${url.host}`, secret }
  } catch {
    return null
  }
}

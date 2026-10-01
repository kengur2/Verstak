/**
 * Клиент сервера Verstak.
 *
 * В браузере запросы идут относительными путями (страницу отдал тот же
 * сервер). В мобильном приложении адрес сервера известен отдельно, поэтому
 * каждый путь проходит через `apiUrl`.
 */
import { apiUrl } from './server'

export type ApiError = { error?: string; [key: string]: unknown }

export class RequestFailure extends Error {
  readonly status: number
  readonly payload: ApiError

  constructor(status: number, payload: ApiError) {
    super(typeof payload.error === 'string' ? payload.error : `HTTP ${status}`)
    this.name = 'RequestFailure'
    this.status = status
    this.payload = payload
  }
}

const TOKEN_STORAGE_KEY = 'verstak.token'

/**
 * Токен мобильного клиента. На десктопе используется сессионная cookie,
 * на телефоне после сопряжения — токен, потому что там нет cookie-сессии
 * до первого обмена кода.
 */
export const readToken = (): string | null => {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export const writeToken = (token: string | null): void => {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Приватный режим: токен живёт только в памяти вкладки.
  }
}

export const apiFetch = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  headers.set('accept', 'application/json')

  const token = readToken()
  if (token) headers.set('authorization', `Bearer ${token}`)

  // `same-origin` подходит и для приложения: токен передаётся заголовком, а
  // cookie в мобильной сборке всё равно недоступна.
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: 'same-origin' })
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as T) : ({} as T)

  if (!response.ok) {
    throw new RequestFailure(response.status, payload as ApiError)
  }
  return payload
}

/** Кодирует путь проекта в идентификатор, понятный серверу. */
export const encodeWorkspace = (directory: string): string =>
  btoa(unescape(encodeURIComponent(directory))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const decodeWorkspace = (id: string): string => {
  const padded = id.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return decodeURIComponent(escape(atob(padded)))
  } catch {
    return ''
  }
}

/** Адрес OpenCode для папки, проксируемый сервером. */
export const workspaceApi = (directory: string): string => `/api/workspaces/${encodeWorkspace(directory)}/opencode`
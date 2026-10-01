/**
 * Подписка на события OpenCode.
 *
 * OpenCode отдаёт SSE на `/api/event`. Поток проксирует сервер Verstak,
 * поэтому клиенту достаточно знать адрес рабочей папки.
 *
 * Переподключение выполняется с нарастающей паузой: при обрыве сервера или
 * сети поток должен восстановиться сам, без вмешательства пользователя.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { readToken, workspaceApi } from './api'
import { apiUrl } from './server'
import type { ServerEvent } from './types'

const INITIAL_RETRY_MS = 1_000
const MAX_RETRY_MS = 15_000

export const useEventStream = (
  directory: string | null,
  onEvent: (event: ServerEvent) => void,
): { connected: boolean } => {
  const [connected, setConnected] = useState(false)
  const handlerRef = useRef(onEvent)
  const retryRef = useRef(INITIAL_RETRY_MS)
  const sourceRef = useRef<EventSource | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  handlerRef.current = onEvent

  const connect = useCallback(() => {
    if (!directory) return

    sourceRef.current?.close()
    // В приложении адрес сервера не совпадает с адресом страницы, поэтому
    // абсолютный адрес строится через apiUrl.
    const url = new URL(apiUrl(`${workspaceApi(directory)}/event`), window.location.origin)

    const token = readToken()
    if (token) url.searchParams.set('token', token)

    // EventSource не умеет заголовки, поэтому токен передаётся в адресе.
    // Сервер принимает оба варианта: заголовок и параметр.
    const source = new EventSource(url.toString())
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      retryRef.current = INITIAL_RETRY_MS
    }

    source.onmessage = (message) => {
      if (message.data === ': heartbeat') return
      try {
        const parsed = JSON.parse(message.data) as ServerEvent
        if (parsed?.type) handlerRef.current(parsed)
      } catch {
        // Неструктурированная строка — игнорируем, поток продолжит работу.
      }
    }

    source.onerror = () => {
      setConnected(false)
      source.close()
      sourceRef.current = null
      const delay = retryRef.current
      retryRef.current = Math.min(delay * 2, MAX_RETRY_MS)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(connect, delay)
    }
  }, [directory])

  useEffect(() => {
    connect()
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      sourceRef.current?.close()
      sourceRef.current = null
      setConnected(false)
    }
  }, [connect])

  return { connected }
}
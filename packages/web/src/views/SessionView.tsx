/**
 * Экран сессии: список сессий, лента сообщений, поле ввода.
 *
 * Живое обновление — через поток событий OpenCode. Имена событий в API v2 не
 * документированы как перечисление, поэтому вместо разбора каждого события
 * лента перечитывается из API с небольшим замедлением: так интерфейс остаётся
 * верным при любых изменениях потока, а нагрузка ограничена.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { apiFetch, workspaceApi } from '../lib/api'
import { useEventStream } from '../lib/events'
import { basename, formatCost, formatRelative, formatTokens } from '../lib/format'
import { IconChevron, IconClose, IconPlus, IconSend, IconStop } from '../lib/icons'
import { ModelPicker } from '../components/ModelPicker'
import type { MessageInfo, MessageListResponse, MessagePart, ModelInfo, SessionInfo, SessionPage } from '../lib/types'

/**
 * Текст сообщения. У ассистента он собирается из текстовых частей, у
 * пользователя и системы лежит отдельным полем.
 */
const textOf = (message: MessageInfo): string => {
  if (typeof message.text === 'string' && message.text.length > 0) return message.text
  return (message.content ?? [])
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

const roleLabel = (role: string, t: (key: never) => string): string => {
  if (role === 'user') return t('session.user' as never)
  if (role === 'assistant') return t('session.assistant' as never)
  return t('session.system' as never)
}

/**
 * Минимальная разметка ответа: блоки кода, `код` в строке, **жирный**,
 * *курсив* и ссылки. Своя реализация вместо библиотеки: сообщения содержат
 * в основном текст и код, а тяжёлый markdown-движок здесь ни к чему.
 */
export const renderRichText = (text: string): ReactNode => {
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g)
  const blocks: ReactNode[] = []

  for (let index = 0; index < parts.length; index += 1) {
    const segment = parts[index]
    if (segment === undefined) continue

    // После split: [текст, язык, код, текст, язык, код, …]
    if (index % 3 === 2) {
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{segment}</code>
        </pre>,
      )
      continue
    }
    if (!segment) continue

    blocks.push(
      <Fragment key={`text-${index}`}>
        {segment.split('\n').map((line, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 ? '\n' : null}
            {inlineMarkup(line)}
          </Fragment>
        ))}
      </Fragment>,
    )
  }

  return blocks
}

/** Разметка внутри строки. Правила намеренно простые и предсказуемые. */
const inlineMarkup = (line: string): ReactNode[] => {
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > lastIndex) nodes.push(line.slice(lastIndex, start))
    const token = match[0]

    if (token.startsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('[')) {
      const close = token.indexOf(']')
      nodes.push(
        <a key={key++} href={token.slice(close + 2, -1)} target="_blank" rel="noreferrer noopener">
          {token.slice(1, close)}
        </a>,
      )
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }

    lastIndex = start + token.length
  }

  if (lastIndex < line.length) nodes.push(line.slice(lastIndex))
  return nodes
}

export const SessionView = ({
  directory,
  sessionId,
  onSessionChange,
  onBack,
  showBack,
}: {
  directory: string
  sessionId: string | null
  onSessionChange: (id: string | null) => void
  onBack?: () => void
  showBack?: boolean
}) => {
  const { t, locale } = useI18n()
  const base = workspaceApi(directory)

  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [messages, setMessages] = useState<MessageInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [streaming, setStreaming] = useState(false)

  const threadRef = useRef<HTMLDivElement>(null)
  const refreshTimer = useRef<number | null>(null)

  const refreshSessions = useCallback(async () => {
    try {
      const page = await apiFetch<SessionPage>(`${base}/session?limit=40`)
      setSessions(page.data ?? [])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    }
  }, [base, t])

  const refreshMessages = useCallback(async () => {
    if (!sessionId) {
      setMessages([])
      return
    }
    try {
      // OpenCode отдаёт последние сообщения по одной роли за раз, поэтому
      // запрашиваем реплики пользователя отдельно и сливаем с остальными по
      // времени: иначе собственные сообщения выпадали бы из окна последних.
      const [allPage, userPage] = await Promise.all([
        apiFetch<MessageListResponse>(`${base}/session/${sessionId}/message?limit=100`),
        apiFetch<MessageListResponse>(`${base}/session/${sessionId}/message?limit=40&type=user`),
      ])
      const byId = new Map<string, MessageInfo>()
      for (const message of [...(allPage.data ?? []), ...(userPage.data ?? [])]) {
        byId.set(message.id, message)
      }
      setMessages([...byId.values()].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0)))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    }
  }, [base, sessionId, t])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      await refreshSessions()
      await refreshMessages()
      try {
        const list = await apiFetch<{ data: ModelInfo[] }>(`${base}/model`)
        if (!cancelled) setModels((list.data ?? []).filter((item) => item.enabled !== false))
      } catch {
        // Список моделей не критичен: без него работаем на модели по умолчанию.
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [base, refreshMessages, refreshSessions])

  /** Перечитывает ленту не чаще, чем раз в 400 мс, при потоке событий. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null
      void refreshMessages()
      void refreshSessions()
    }, 400)
  }, [refreshMessages, refreshSessions])

  const onEvent = useCallback(
    (event: { type: string; data?: unknown }) => {
      if (event.type === 'server.connected') return

      // Признак генерации: сообщение ассистента без времени завершения.
      const data = event.data as { type?: string; time?: { completed?: number } } | undefined
      if (data?.type === 'assistant') setStreaming(!data.time?.completed)
      if (event.type.includes('idle') || event.type.includes('completed')) setStreaming(false)

      scheduleRefresh()
    },
    [scheduleRefresh],
  )

  const { connected } = useEventStream(directory, onEvent)

  // Держим ленту прижатой к низу, пока пользователь сам не прокрутил вверх.
  useEffect(() => {
    const node = threadRef.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    if (distance < 240) node.scrollTop = node.scrollHeight
  }, [messages])

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
    },
    [],
  )

  const createSession = useCallback(async () => {
    try {
      const response = await apiFetch<{ data: SessionInfo }>(`${base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          model
            ? { model: { providerID: model.split('/')[0] ?? 'opencode', id: model.split('/').slice(1).join('/') } }
            : {},
        ),
      })
      onSessionChange(response.data.id)
      await refreshSessions()
      return response.data.id
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
      return null
    }
  }, [base, model, onSessionChange, refreshSessions, t])

  const send = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    setBusy(true)
    setError(null)
    setText('')
    try {
      const target = sessionId ?? (await createSession())
      if (!target) return
      await apiFetch(`${base}/session/${target}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      await refreshMessages()
      await refreshSessions()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }, [base, busy, createSession, refreshMessages, refreshSessions, sessionId, t, text])

  const interrupt = useCallback(async () => {
    if (!sessionId) return
    await apiFetch(`${base}/session/${sessionId}/interrupt`, { method: 'POST' }).catch(() => undefined)
    setStreaming(false)
  }, [base, sessionId])

  const current = useMemo(() => sessions.find((session) => session.id === sessionId), [sessions, sessionId])
  const isRunning = streaming

  return (
    <>
      <div className="topbar">
        {showBack && (
          <button className="icon-btn mobile-back" onClick={onBack} aria-label={t('action.back')}>
            <IconChevron size={18} className="flip" />
          </button>
        )}
        <h1>
          {basename(directory)}
          <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
            {current?.title?.trim() || t('session.newTitle')}
          </span>
        </h1>
        <span className={`pill ${connected ? 'ready' : 'error'}`}>
          <span className={`dot ${connected ? 'ready' : 'error'}`} />
          {connected ? t('session.title') : t('common.offline')}
        </span>
        <div className="spacer" />
        {current && (
          <span
            className="pill"
            title={`${t('session.tokens')}: ${current.tokens?.input ?? 0} / ${current.tokens?.output ?? 0}`}
          >
            {formatTokens(current.tokens?.input)} / {formatTokens(current.tokens?.output)}
          </span>
        )}
        <ModelPicker models={models} value={model} onChange={setModel} />
        <button className="btn" onClick={() => void createSession()}>
          <IconPlus size={16} />
          {t('action.newSession')}
        </button>
      </div>

      <div className="thread" ref={threadRef}>
        <div className="thread-inner">
          {loading && <div className="empty">{t('common.loading')}</div>}

          {!loading && messages.length === 0 && sessions.length > 0 && (
            <div className="card">
              <div className="card-title">{t('session.recentSessions')}</div>
              <ul className="list">
                {sessions.slice(0, 12).map((session) => (
                  <li key={session.id}>
                    <button className="item" onClick={() => onSessionChange(session.id)}>
                      <span className="item-main">
                        <span className="truncate">{session.title?.trim() || t('session.untitled')}</span>
                        <span className="item-sub">{formatRelative(session.time?.updated, locale)}</span>
                      </span>
                      <span className="pill">{formatTokens(session.tokens?.output)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && messages.length === 0 && sessions.length === 0 && (
            <div className="empty">{t('session.chooseSession')}</div>
          )}

          {messages.map((message) => {
            const body = textOf(message)
            const tools = (message.content ?? []).filter((part) => part.type === 'tool')
            return (
              <article className={`message ${message.type}`} key={message.id}>
                <div className="message-head">
                  <span>{roleLabel(message.type, t as never)}</span>
                  {message.model?.id ? <span>· {message.model.id}</span> : null}
                  {message.cost ? <span>· {formatCost(message.cost)}</span> : null}
                </div>
                {body && <div className="message-bubble">{renderRichText(body)}</div>}
                {tools.map((tool, index) => {
                  const name = (tool as { name?: string }).name
                  const status = (tool as { state?: { status?: string } }).state?.status
                  return (
                    <div className="part-tool" key={`${message.id}:tool:${index}`}>
                      {name ?? 'tool'}
                      {status ? ` · ${status}` : ''}
                    </div>
                  )
                })}
                {message.error && (
                  <div className="banner danger">{message.error.data?.message ?? t('common.error')}</div>
                )}
              </article>
            )
          })}

          {streaming && (
            <div className="thinking">
              <span className="spinner" />
              {t('session.streaming')}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="banner danger" style={{ margin: '0 20px 10px' }}>
          <span className="truncate">{error}</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setError(null)} aria-label={t('action.close')}>
            <IconClose size={14} />
          </button>
        </div>
      )}

      <div className="composer">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('session.placeholder')}
          onKeyDown={(event) => {
            // Enter отправляет, Shift+Enter переносит строку.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        {isRunning ? (
          <button className="btn danger send" onClick={() => void interrupt()} title={t('action.stop')}>
            <IconStop size={16} />
          </button>
        ) : (
          <button
            className="btn primary send"
            onClick={() => void send()}
            disabled={busy || !text.trim()}
            title={t('action.send')}
            aria-label={t('action.send')}
          >
            <IconSend size={17} />
          </button>
        )}
      </div>
    </>
  )
}

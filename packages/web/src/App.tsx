/**
 * Корень интерфейса: состояние приложения, навигация, обмен кода на токен.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { I18nProvider, useI18n } from './i18n'
import { apiFetch, readToken, writeToken } from './lib/api'
import { basename } from './lib/format'
import {
  IconChart,
  IconChat,
  IconClock,
  IconFile,
  IconFolder,
  IconMenu,
  IconPhone,
  IconSliders,
} from './lib/icons'
import { detectPlatform, getServerUrl, isNativePlatform, needsServerAddress, setServerUrl } from './lib/server'
import { ThemeProvider, ThemeToggle } from './lib/theme'
import type { AppConfigDto, InstanceDto, TaskDto } from './lib/types'
import { ConnectView } from './views/ConnectView'
import { FilesView } from './views/FilesView'
import { StatsView } from './views/StatsView'
import { LoginView } from './views/LoginView'
import { ProjectsView } from './views/ProjectsView'
import { SessionView } from './views/SessionView'
import { TasksView } from './views/TasksView'
import { DevicesView } from './views/DevicesView'
import { SettingsView } from './views/SettingsView'

type Tab = 'projects' | 'session' | 'tasks' | 'files' | 'stats' | 'devices' | 'settings'

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; passwordConfigured: boolean; username: string }
  | { status: 'ready' }

const emptyWorkspaces = {
  folders: [] as { path: string; lastAccessed?: number }[],
  instances: [] as InstanceDto[],
  scheduler: [] as TaskDto[],
}

/** Сколько держать всплывающую подсказку, мс. */
const NOTICE_MS = 2600

/**
 * Обмен одноразового кода сопряжения на постоянный токен.
 *
 * Код приходит в адресе (`?pair=…`), потому что сценарий открытия ссылки
 * целиком в нём не передать. Код одноразовый, поэтому сразу после обмена он
 * удаляется из адресной строки.
 */
const redeemPairingFromUrl = async (): Promise<void> => {
  const params = new URLSearchParams(window.location.search)
  const secret = params.get('pair')
  if (!secret || readToken()) return

  try {
    const result = await apiFetch<{ token: string }>('/api/pairing/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret,
        label: 'Телефон',
        deviceName: params.get('name') ?? null,
        devicePlatform: detectPlatform(),
      }),
    })
    writeToken(result.token)
  } catch {
    // Неверный или истёкший код: покажем экран входа с паролем.
  }

  const url = new URL(window.location.href)
  url.searchParams.delete('pair')
  window.history.replaceState({}, '', url.toString())
}

/**
 * Проверяет, есть ли действующий вход: cookie-сессия на десктопе либо токен
 * телефона.
 */
const probeSession = async (): Promise<boolean> => {
  try {
    const me = await apiFetch<{ authenticated: boolean }>('/api/me')
    return me.authenticated === true
  } catch {
    return false
  }
}

const Shell = ({
  onLocaleResolved,
  onServerChange,
}: {
  onLocaleResolved: (locale: string) => void
  onServerChange: () => void
}) => {
  const { t } = useI18n()
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [config, setConfig] = useState<AppConfigDto | null>(null)
  const [workspaces, setWorkspaces] = useState(emptyWorkspaces)
  const [tasks, setTasks] = useState<TaskDto[]>([])
  const [tab, setTab] = useState<Tab>('projects')
  const [folder, setFolder] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // На телефоне показываем либо список, либо экран: оба занимают одну ячейку.
  const [mobileView, setMobileView] = useState<'rail' | 'main'>('main')

  /** Короткое сообщение о результате — например, «файл сохранён». */
  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), NOTICE_MS)
  }, [])

  // Кнопка «назад» на Android: с экрана возвращает к списку, из списка
  // закрывает приложение. Без этого обработчика система закрывала бы
  // приложение с любого экрана.
  const mobileViewRef = useRef(mobileView)
  mobileViewRef.current = mobileView

  useEffect(() => {
    if (!isNativePlatform()) return
    let remove: (() => void) | undefined

    void (async () => {
      try {
        const { App } = await import('@capacitor/app')
        const listener = await App.addListener('backButton', () => {
          if (mobileViewRef.current === 'rail') void App.exitApp()
          else setMobileView('rail')
        })
        remove = () => void listener.remove()
      } catch {
        // Без плагина кнопка «назад» работает как обычно — закрывает приложение.
      }
    })()

    return () => remove?.()
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    try {
      const response = await apiFetch<typeof emptyWorkspaces>('/api/workspaces')
      setWorkspaces(response)
      setTasks(response.scheduler ?? [])
    } catch {
      // Список проектов не критичен для отображения экранов.
    }
  }, [])

  const refreshAuth = useCallback(async () => {
    await redeemPairingFromUrl()

    let status: { passwordConfigured: boolean; username: string; locale: string } | null = null
    try {
      status = await apiFetch('/api/auth/status')
    } catch {
      // Сервер недоступен: показываем экран входа с паролем.
    }
    if (status) onLocaleResolved(status.locale)

    if (await probeSession()) {
      setAuth({ status: 'ready' })
      try {
        setConfig(await apiFetch<AppConfigDto>('/api/config'))
      } catch {
        setConfig(null)
      }
      await refreshWorkspaces()
      return
    }

    writeToken(null)
    setAuth({
      status: 'anonymous',
      passwordConfigured: status?.passwordConfigured ?? true,
      username: status?.username ?? 'verstak',
    })
  }, [onLocaleResolved, refreshWorkspaces])

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    writeToken(null)
    setConfig(null)
    setWorkspaces(emptyWorkspaces)
    setTasks([])
    setAuth({ status: 'anonymous', passwordConfigured: true, username: 'verstak' })
  }, [])

  if (auth.status === 'loading') {
    return <div className="empty">{t('common.loading')}</div>
  }

  if (auth.status === 'anonymous') {
    return (
      <LoginView
        passwordConfigured={auth.passwordConfigured}
        username={auth.username}
        onAuthenticated={() => void refreshAuth()}
      />
    )
  }

  const selectFolder = (next: string) => {
    setFolder(next)
    setSessionId(null)
    setTab('session')
    setMobileView('main')
    void refreshWorkspaces()
  }

  const goTo = (next: Tab) => {
    setTab(next)
    setMobileView('main')
  }

  const navItems: { id: Tab; label: string; Icon: typeof IconFolder; count?: number }[] = [
    { id: 'projects', label: t('nav.projects'), Icon: IconFolder, count: workspaces.folders.length },
    { id: 'session', label: t('nav.sessions'), Icon: IconChat },
    { id: 'tasks', label: t('nav.tasks'), Icon: IconClock, count: tasks.length },
    { id: 'files', label: t('nav.files'), Icon: IconFile },
    { id: 'stats', label: t('nav.stats'), Icon: IconChart },
    { id: 'devices', label: t('nav.devices'), Icon: IconPhone },
    { id: 'settings', label: t('nav.settings'), Icon: IconSliders },
  ]

  const enableLan = async () => {
    try {
      const next = await apiFetch<AppConfigDto>('/api/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lanAccess: true }),
      })
      setConfig(next)
    } catch {
      // Ошибку покажет следующая попытка сохранения настроек.
    }
  }

  return (
    <div className="app" data-mobile-view={mobileView}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <IconChat size={17} />
          </span>
          <span className="brand-text">
            <span className="brand-name">{t('app.name')}</span>
            <span className="brand-tag">{t('app.tagline')}</span>
          </span>
          <span className="spacer" />
          <ThemeToggle label={t('action.toggleTheme')} />
        </div>

        <nav className="nav">
          {navItems.map(({ id, label, Icon, count }) => (
            <button key={id} aria-current={tab === id} onClick={() => goTo(id)}>
              <Icon size={17} className="nav-icon" />
              <span className="truncate">{label}</span>
              {count ? <span className="nav-count">{count}</span> : null}
            </button>
          ))}
        </nav>

        {workspaces.folders.length > 0 && (
          <>
            <div className="rail-section">{t('nav.projects')}</div>
            <ul className="list">
              {workspaces.folders.map((item) => {
                const state = workspaces.instances.find(
                  (instance) => instance.directory === item.path,
                )?.state
                return (
                  <li key={item.path} data-active={folder === item.path}>
                    <button className="item" onClick={() => selectFolder(item.path)}>
                      <IconFolder size={15} className="nav-icon" />
                      <span className="truncate">{basename(item.path)}</span>
                      {state ? <span className={`dot ${stateClass(state)}`} /> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </aside>

      <main className="main">
        <div className="mobile-tabs">
          <button className="icon-btn" onClick={() => setMobileView('rail')} aria-label={t('nav.projects')}>
            <IconMenu size={18} />
          </button>
          {navItems.map(({ id, label }) => (
            <button key={id} aria-current={tab === id} onClick={() => goTo(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'projects' && (
          <ProjectsView
            folders={workspaces.folders}
            instances={workspaces.instances}
            activeFolder={folder}
            onSelect={selectFolder}
            onChanged={refreshWorkspaces}
          />
        )}

        {tab === 'session' &&
          (folder ? (
            <SessionView
              directory={folder}
              sessionId={sessionId}
              onSessionChange={setSessionId}
              onBack={() => setMobileView('rail')}
              showBack
            />
          ) : (
            <div className="empty">{t('projects.empty')}</div>
          ))}

        {tab === 'tasks' && <TasksView folders={workspaces.folders} initialTasks={tasks} />}

        {tab === 'files' && <FilesView onNotice={showNotice} />}

        {tab === 'stats' && <StatsView />}

        {tab === 'devices' && <DevicesView lanAccess={config?.lanAccess ?? false} onEnableLan={enableLan} />}

        {tab === 'settings' &&
          (config ? (
            <SettingsView
              config={config}
              onConfigChange={setConfig}
              onLogout={logout}
              serverUrl={getServerUrl()}
              onChangeServer={onServerChange}
            />
          ) : (
            <div className="empty">{t('common.loading')}</div>
          ))}
      </main>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
    </div>
  )
}

/** Состояние экземпляра OpenCode → класс для точки состояния. */
const stateClass = (state: 'stopped' | 'starting' | 'ready' | 'error'): string => {
  if (state === 'ready') return 'ready'
  if (state === 'starting') return 'busy'
  if (state === 'error') return 'error'
  return ''
}

export const App = () => {
  const [serverLocale, setServerLocale] = useState<string | null>(null)
  // В мобильном приложении адрес сервера задаётся один раз при первом запуске.
  const [needsServer, setNeedsServer] = useState(() => needsServerAddress())

  const onLocaleResolved = useCallback((locale: string) => {
    setServerLocale((current) => (current === locale ? current : locale))
  }, [])

  /** Сброс к экрану подключения — при смене сервера или выходе из аккаунта. */
  const onServerChange = useCallback(() => {
    writeToken(null)
    setServerUrl(null)
    setNeedsServer(true)
  }, [])

  return (
    <ThemeProvider>
      <I18nProvider serverLocale={serverLocale}>
        {needsServer ? (
          <ConnectView onConnected={() => setNeedsServer(false)} />
        ) : (
          <Shell onLocaleResolved={onLocaleResolved} onServerChange={onServerChange} />
        )}
      </I18nProvider>
    </ThemeProvider>
  )
}

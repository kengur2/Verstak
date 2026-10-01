/**
 * Настройки: оформление, язык, сеть, бинарник OpenCode.
 */
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { localeNames, type Locale } from '../i18n/messages'
import { apiFetch } from '../lib/api'
import { IconCheck, IconLogout, IconMoon, IconMonitor, IconSun } from '../lib/icons'
import { useTheme, type Theme } from '../lib/theme'
import type { AppConfigDto } from '../lib/types'

/** Переключатель темы: три варианта, выбор виден сразу. */
const ThemeSelect = () => {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()

  const options: { id: Theme; label: string; Icon: typeof IconSun }[] = [
    { id: 'light', label: t('settings.theme.light'), Icon: IconSun },
    { id: 'dark', label: t('settings.theme.dark'), Icon: IconMoon },
    { id: 'system', label: t('settings.theme.system'), Icon: IconMonitor },
  ]

  return (
    <div className="segmented" role="group" aria-label={t('settings.theme')}>
      {options.map(({ id, label, Icon }) => (
        <button key={id} aria-pressed={theme === id} onClick={() => setTheme(id)}>
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  )
}

export const SettingsView = ({
  config,
  onConfigChange,
  onLogout,
  serverUrl,
  onChangeServer,
}: {
  config: AppConfigDto
  onConfigChange: (config: AppConfigDto) => void
  onLogout: () => void
  serverUrl: string | null
  onChangeServer: () => void
}) => {
  const { t, locale, setLocale } = useI18n()
  const [port, setPort] = useState(String(config.port))
  const [lanAccess, setLanAccess] = useState(config.lanAccess)
  const [binary, setBinary] = useState(config.opencodeBinaries[0]?.path ?? '')
  const [sftpEnabled, setSftpEnabled] = useState(config.sftpEnabled)
  const [sftpPort, setSftpPort] = useState(String(config.sftpPort))
  const [sftpWrite, setSftpWrite] = useState(config.sftpWrite)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPort(String(config.port))
    setLanAccess(config.lanAccess)
    setBinary(config.opencodeBinaries[0]?.path ?? '')
    setSftpEnabled(config.sftpEnabled)
    setSftpPort(String(config.sftpPort))
    setSftpWrite(config.sftpWrite)
  }, [config])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await apiFetch<AppConfigDto>('/api/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          port: Number(port),
          lanAccess,
          sftpEnabled,
          sftpPort: Number(sftpPort),
          sftpWrite,
          ...(binary ? { opencodeBinaries: [{ path: binary, lastUsed: Date.now() }] } : {}),
        }),
      })
      onConfigChange(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pad">
      <div className="card">
        <div className="card-title">{t('settings.appearance')}</div>

        <div className="field">
          <span>{t('settings.theme')}</span>
          <ThemeSelect />
        </div>

        <div className="field">
          <span>{t('settings.language')}</span>
          <div className="segmented" role="group" aria-label={t('settings.language')}>
            {(Object.keys(localeNames) as Locale[]).map((item) => (
              <button key={item} aria-pressed={locale === item} onClick={() => setLocale(item)}>
                {localeNames[item]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('sftp.title')}</div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={sftpEnabled}
            onChange={(event) => setSftpEnabled(event.target.checked)}
          />
          <span className="checkbox-text">
            {t('sftp.enable')}
            <span className="muted">{t('sftp.hint')}</span>
          </span>
        </label>

        {sftpEnabled && (
          <>
            <div className="field">
              <span>{t('sftp.port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={sftpPort}
                onChange={(event) => setSftpPort(event.target.value)}
                style={{ maxWidth: 180 }}
              />
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={sftpWrite}
                onChange={(event) => setSftpWrite(event.target.checked)}
              />
              <span className="checkbox-text">
                {t('sftp.write')}
                <span className="muted">{t('sftp.writeHint')}</span>
              </span>
            </label>

            <p className="muted">{t('sftp.login')}</p>
            {!lanAccess && <p className="muted">{t('sftp.needLan')}</p>}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('settings.title')}</div>

        {serverUrl && (
          <div className="field">
            <span>{t('connect.server')}</span>
            <div className="row">
              <span className="code-box" style={{ flex: 1, minWidth: 0 }}>
                {serverUrl}
              </span>
              <button className="btn" onClick={onChangeServer}>
                {t('connect.changeServer')}
              </button>
            </div>
          </div>
        )}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={lanAccess}
            onChange={(event) => setLanAccess(event.target.checked)}
          />
          <span className="checkbox-text">
            {t('settings.lanAccess')}
            <span className="muted">{t('settings.lanHint')}</span>
          </span>
        </label>

        <div className="field">
          <span>{t('settings.port')}</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            style={{ maxWidth: 180 }}
          />
        </div>

        <div className="field">
          <span>{t('settings.opencodeBinary')}</span>
          <input
            value={binary}
            onChange={(event) => setBinary(event.target.value)}
            placeholder="opencode"
          />
        </div>

        {error && <div className="banner danger">{error}</div>}

        <div className="row">
          <button className="btn primary" onClick={save} disabled={busy}>
            {t('action.save')}
          </button>
          {saved && (
            <span className="toast">
              <IconCheck size={15} />
              {t('settings.saved')}
            </span>
          )}
          <div className="spacer" />
          <button className="btn ghost" onClick={onLogout}>
            <IconLogout size={16} />
            {t('action.logout')}
          </button>
        </div>
        <p className="muted">{t('settings.saveHint')}</p>
      </div>
    </div>
  )
}

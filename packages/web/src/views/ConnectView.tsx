/**
 * Подключение к серверу — экран мобильного приложения.
 *
 * В браузере этот экран не нужен: страницу отдал сам сервер, адрес уже
 * известен. В приложении адрес вводится один раз и сохраняется; дальше
 * телефон работает по токену устройства.
 *
 * Попасть внутрь можно двумя способами: кодом сопряжения с компьютера или
 * паролем. Оба возвращают постоянный токен — cookie в приложении ненадёжна.
 */
import { useCallback, useState } from 'react'
import { useI18n } from '../i18n'
import { writeToken } from '../lib/api'
import { IconChevron, IconPhone } from '../lib/icons'
import { detectPlatform, normalizeServerUrl, parsePairingLink, probeServer, setServerUrl } from '../lib/server'
import { scanPairingCode } from '../lib/qr'

type Mode = 'code' | 'password'

export const ConnectView = ({ onConnected, initialAddress }: { onConnected: () => void; initialAddress?: string | null }) => {
  const { t } = useI18n()
  const [address, setAddress] = useState(initialAddress ?? '')
  const [mode, setMode] = useState<Mode>('code')
  const [secret, setSecret] = useState('')
  const [username, setUsername] = useState('verstak')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addressOk, setAddressOk] = useState(false)

  /** Проверяет адрес и запоминает его, если сервер ответил. */
  const confirmAddress = useCallback(async (): Promise<string | null> => {
    const base = normalizeServerUrl(address)
    if (!base) {
      setError(t('connect.addressPlaceholder'))
      return null
    }
    const result = await probeServer(base)
    if (!result.ok) {
      setAddressOk(false)
      setError(result.error ?? t('connect.failedToReach'))
      return null
    }
    setAddressOk(true)
    setError(null)
    return base
  }, [address, t])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const base = addressOk ? normalizeServerUrl(address) : await confirmAddress()
      if (!base) return

      const init: RequestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'code'
            ? { secret: secret.trim(), label: deviceLabel(t), deviceName: deviceLabel(t), devicePlatform: detectPlatform() }
            : { username, password, deviceName: deviceLabel(t), devicePlatform: detectPlatform() },
        ),
      }

      const response = await fetch(`${base}/api/pairing/${mode === 'code' ? 'redeem' : 'login'}`, init)
      const payload = (await response.json().catch(() => ({}))) as { token?: string; error?: string }

      if (!response.ok || !payload.token) {
        setError(mode === 'code' ? t('connect.badCode') : payload.error || t('login.error'))
        return
      }

      setServerUrl(base)
      writeToken(payload.token)
      onConnected()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  /** Сканирует QR с экрана компьютера: он содержит адрес и код сразу. */
  const scan = async () => {
    setError(null)
    const scanned = await scanPairingCode()
    if (!scanned) {
      setError(t('connect.scanFailed'))
      return
    }
    const parsed = parsePairingLink(scanned)
    if (!parsed) {
      setError(t('connect.scanFailed'))
      return
    }
    setAddress(parsed.server)
    setSecret(parsed.secret)
    const result = await probeServer(parsed.server)
    if (!result.ok) {
      setAddressOk(false)
      setError(result.error ?? t('common.error'))
      return
    }
    setAddressOk(true)
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">
            <IconPhone size={17} />
          </span>
          <span className="brand-text">
            <span className="brand-name">{t('connect.title')}</span>
            <span className="brand-tag">{t('app.name')}</span>
          </span>
        </div>

        <p className="muted">{t('connect.hint')}</p>

        <div className="field">
          <span>{t('connect.address')}</span>
          <div className="row">
            <input
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
                setAddressOk(false)
              }}
              placeholder={t('connect.addressPlaceholder')}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ flex: 1, minWidth: 150 }}
              onBlur={() => {
                if (address.trim()) void confirmAddress()
              }}
            />
            <button type="button" className="btn" onClick={() => void confirmAddress()} disabled={busy || !address.trim()}>
              {t('connect.check')}
            </button>
          </div>
          {addressOk && <span className="toast">{t('connect.ok')}</span>}
        </div>

        <div className="segmented" role="tablist">
          <button type="button" aria-pressed={mode === 'code'} onClick={() => setMode('code')}>
            {t('connect.mode.code')}
          </button>
          <button type="button" aria-pressed={mode === 'password'} onClick={() => setMode('password')}>
            {t('connect.mode.password')}
          </button>
        </div>

        {mode === 'code' ? (
          <>
            <div className="field">
              <span>{t('connect.code')}</span>
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={t('connect.codePlaceholder')}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => void scan()}>
                {t('connect.scan')}
              </button>
              <span className="muted">{t('connect.codeHint')}</span>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <span>{t('connect.username')}</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
              />
            </div>
            <div className="field">
              <span>{t('connect.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
          </>
        )}

        {error && <div className="banner danger">{error}</div>}

        <button className="btn primary lg" type="submit" disabled={busy || !address.trim()}>
          {busy ? t('connect.checking') : t('connect.submit')}
          <IconChevron size={16} />
        </button>

        <p className="muted">{t('connect.lanHint')}</p>
      </form>
    </div>
  )
}

/** Понятная подпись устройства для списка на компьютере. */
const deviceLabel = (t: (key: never, params?: Record<string, string | number>) => string): string => {
  const platform = detectPlatform()
  return platform
    ? t('connect.deviceWithPlatform' as never, { platform })
    : t('connect.device' as never)
}

/**
 * Форма входа и первичная установка пароля.
 *
 * Пароль хранится только в виде scrypt-хеша, поэтому забытый пароль не
 * восстановить — можно только задать новый.
 */
import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { apiFetch, RequestFailure } from '../lib/api'
import { IconChat } from '../lib/icons'

export const LoginView = ({
  passwordConfigured,
  username,
  onAuthenticated,
}: {
  passwordConfigured: boolean
  username: string
  onAuthenticated: () => void
}) => {
  const { t } = useI18n()
  const [loginName, setLoginName] = useState(username)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: loginName, password }),
      })
      onAuthenticated()
    } catch (failure) {
      setError(
        failure instanceof RequestFailure && failure.status === 401
          ? t('login.error')
          : failure instanceof Error
            ? failure.message
            : t('common.error'),
      )
    } finally {
      setBusy(false)
    }
  }

  const submitSetup = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (newPassword.length < 8) {
      setError(t('login.passwordTooShort'))
      return
    }
    if (newPassword !== repeat) {
      setError(t('login.passwordMismatch'))
      return
    }
    setBusy(true)
    try {
      await apiFetch('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      })
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: loginName, password: newPassword }),
      })
      onAuthenticated()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  if (!passwordConfigured) {
    return (
      <div className="login">
        <form className="card" onSubmit={submitSetup}>
          <div className="brand" style={{ padding: 0 }}>
            <span className="brand-mark">
              <IconChat size={17} />
            </span>
            <span className="brand-text">
              <span className="brand-name">{t('app.name')}</span>
              <span className="brand-tag">{t('app.tagline')}</span>
            </span>
          </div>
          <div className="field">
            <span>{t('login.username')}</span>
            <input value={loginName} onChange={(event) => setLoginName(event.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <span>{t('login.setPassword')}</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <span>{t('login.repeatPassword')}</span>
            <input
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error && <div className="banner danger">{error}</div>}
          <button className="btn primary lg" type="submit" disabled={busy}>
            {t('login.submit')}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submitLogin}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">
            <IconChat size={17} />
          </span>
          <span className="brand-text">
            <span className="brand-name">{t('app.name')}</span>
            <span className="brand-tag">{t('app.tagline')}</span>
          </span>
        </div>
        <div className="field">
          <span>{t('login.username')}</span>
          <input value={loginName} onChange={(event) => setLoginName(event.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <span>{t('login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>
        {error && <div className="banner danger">{error}</div>}
        <button className="btn primary lg" type="submit" disabled={busy || !password}>
          {t('login.submit')}
        </button>
      </form>
    </div>
  )
}
/**
 * Устройства и сопряжение с телефоном.
 *
 * Сценарий: на этом экране появляется код и адрес. Пользователь открывает адрес
 * на телефоне (в той же сети), вводит код, и телефон получает постоянный токен.
 */
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { apiFetch } from '../lib/api'
import { formatRelative } from '../lib/format'
import { IconCheck, IconCopy, IconPhone } from '../lib/icons'
import { QrCode } from '../components/QrCode'
import type { ClientRecordDto, PairingSessionDto, SftpInfoDto } from '../lib/types'

type ServerAddress = { url: string; kind: 'loopback' | 'lan'; interface: string }

type PairingResponse = {
  pairing: PairingSessionDto
  server: {
    port: number
    lanAccess: boolean
    addresses: ServerAddress[]
    suggestedUrl: string | null
  }
}

export const DevicesView = ({ lanAccess, onEnableLan }: { lanAccess: boolean; onEnableLan: () => void }) => {
  const { t, locale } = useI18n()
  const [clients, setClients] = useState<ClientRecordDto[]>([])
  const [pairing, setPairing] = useState<PairingResponse | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [addressIndex, setAddressIndex] = useState(0)
  const [sftp, setSftp] = useState<SftpInfoDto | null>(null)

  const load = useCallback(async () => {
    try {
      const [clientList, pairList, sftpInfo] = await Promise.all([
        apiFetch<{ clients: ClientRecordDto[] }>('/api/clients'),
        apiFetch<{ pending: { id: string; label?: string; fingerprint?: string | null; expiresAt: string }[] }>(
          '/api/pairing/sessions',
        ),
        apiFetch<SftpInfoDto>('/api/sftp').catch(() => null),
      ])
      setClients(clientList.clients ?? [])
      setSftp(sftpInfo)
      if (pairList.pending?.length) {
        // Код показываем только один раз, при создании; повторно его не показать.
        setSecondsLeft(Math.max(0, Math.floor((Date.parse(pairList.pending[0]!.expiresAt) - Date.now()) / 1000)))
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [secondsLeft])

  const createPairing = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch<PairingResponse>('/api/pairing/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Телефон' }),
      })
      setPairing(response)
      setSecondsLeft(Math.max(0, Math.floor((Date.parse(response.pairing.expiresAt) - Date.now()) / 1000)))
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!pairing) return
    setBusy(true)
    try {
      await apiFetch(`/api/pairing/sessions/${encodeURIComponent(pairing.pairing.id)}`, { method: 'DELETE' })
      setPairing(null)
      setSecondsLeft(0)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    setBusy(true)
    try {
      await apiFetch(`/api/clients/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const purge = async () => {
    setBusy(true)
    try {
      await apiFetch('/api/clients', { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  // Адрес для телефона: адреса из локальной сети, а не петля, если они есть.
  const addresses = pairing?.server.addresses?.length
    ? pairing.server.addresses
    : [{ url: origin, kind: 'lan' as const, interface: 'default' }]
  const chosen = addresses[Math.min(addressIndex, addresses.length - 1)] ?? addresses[0]!
  const pairingLink = pairing ? `${chosen.url}/?pair=${encodeURIComponent(pairing.pairing.secret)}` : ''
  const sftpAddresses = (sftp?.addresses ?? [])
    .filter((item) => item.kind === 'lan')
    .map((item) => item.url)
  // Адрес сервера идёт с портом веб-интерфейса, а у SFTP порт свой, поэтому
  // собираем строку подключения заново.
  const sftpHost = sftpAddresses[0]?.replace(/^https?:\/\//, '').split(':')[0] ?? ''
  const sftpAddress = sftpHost ? `sftp://${sftpHost}:${sftp?.port}` : '—'

  return (
    <div className="content">
      <div className="pad">
        <div className="card">
          <div className="card-title">
            <IconPhone size={17} />
            {t('devices.pair')}
            <div className="spacer" />
            <button className="btn primary" onClick={createPairing} disabled={busy || !lanAccess}>
              {t('devices.code')}
            </button>
          </div>

          <p className="muted">{t('devices.pairHint')}</p>

          {!lanAccess && (
            <div className="banner">
              <div>
                <div>{t('devices.lanDisabled')}</div>
                <button className="btn" style={{ marginTop: 8 }} onClick={onEnableLan}>
                  {t('devices.enableLan')}
                </button>
              </div>
            </div>
          )}

          {pairing && secondsLeft > 0 && (
            <div className="pairing">
              <div className="pairing-code">
                <div className="field">
                  <span>{t('devices.code')}</span>
                  <div className="code-box">{pairing.pairing.secret}</div>
                </div>
                <div className="row">
                  <span className="pill warn">
                    {t('devices.code')}: {minutes}:{seconds}
                  </span>
                  <div className="spacer" />
                  <button
                    className="btn"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(pairing.pairing.secret)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    {copied ? t('action.copied') : t('action.copy')}
                  </button>
                  <button className="btn ghost" onClick={cancel} disabled={busy}>
                    {t('action.cancel')}
                  </button>
                </div>
              </div>

              <div className="pairing-qr">
                <QrCode value={pairingLink} />
                <p className="muted">{t('devices.qrHint')}</p>
              </div>

              <div className="field pairing-address">
                <span>{t('devices.address')}</span>
                {addresses.length > 1 ? (
                  <div className="segmented">
                    {addresses.map((item, index) => (
                      <button
                        key={item.url}
                        aria-pressed={index === addressIndex}
                        onClick={() => setAddressIndex(index)}
                      >
                        {item.kind === 'loopback' ? t('devices.thisComputer') : item.url.replace(/^https?:\/\//, '')}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="code-box">{chosen.url}</div>
                <p className="muted">{t('devices.tokenHint')}</p>
              </div>
            </div>
          )}

          {error && <div className="banner danger">{error}</div>}
        </div>

        <div className="card">
          <div className="card-title">
            {t('sftp.title')}
            <div className="spacer" />
            <span className={`pill ${sftp?.running ? 'ready' : ''}`}>
              {sftp?.running ? t('sftp.running') : t('sftp.stopped')}
            </span>
          </div>

          {!sftp?.enabled ? (
            <p className="muted">{t('sftp.hint')}</p>
          ) : (
            <>
              <div className="field">
                <span>{t('sftp.address')}</span>
                <div className="code-box">{sftpAddress}</div>
              </div>
              <div className="row">
                <span className="pill">
                  {t('sftp.user')}: {sftp?.username}
                </span>
                <span className="pill">
                  {t('sftp.port')}: {sftp?.port}
                </span>
              </div>
              {sftp?.fingerprint && (
                <div className="field">
                  <span>{t('sftp.fingerprint')}</span>
                  <span className="path">{sftp.fingerprint}</span>
                </div>
              )}
              <p className="muted">{t('sftp.login')}</p>
              <p className="muted">{t('sftp.tokenHint')}</p>
              {!lanAccess && <p className="muted">{t('sftp.needLan')}</p>}
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            {t('devices.title')}
            <div className="spacer" />
            <button className="btn ghost" onClick={purge} disabled={busy}>
              {t('devices.purge')}
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="empty">{t('devices.empty')}</div>
          ) : (
            <ul className="list">
              {clients.map((client) => (
                <li key={client.id}>
                  <div className="row" style={{ padding: '9px 11px' }}>
                    <IconPhone size={16} className="nav-icon" />
                    <span className="item-main" style={{ flex: 1 }}>
                      <span className="truncate">
                        {client.label}
                        {client.devicePlatform ? ` · ${client.devicePlatform}` : ''}
                      </span>
                      <span className="item-sub">
                        {t('devices.lastUsed')}: {formatRelative(client.lastUsedAt, locale)}
                      </span>
                    </span>
                    {client.revokedAt && <span className="pill error">{t('devices.revoked')}</span>}
                    {!client.revokedAt && (
                      <button className="btn danger" onClick={() => revoke(client.id)} disabled={busy}>
                        {t('devices.revoke')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
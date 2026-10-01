/**
 * Сессии входа и одноразовые коды сопряжения с телефоном.
 *
 * На телефон выдаётся одноразовый код, телефон по нему обменивается на
 * постоянный токен. Код живёт 10 минут, токен — до отзыва.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { defaults, paths } from './paths.ts'
import { readYamlFile, writeYamlFile } from './yaml-store.ts'

export type SessionInfo = {
  id: string
  username: string
  createdAt: number
  lastSeenAt: number
}

export type ClientRecord = {
  id: string
  label: string
  /** Только sha256 токена: сам токен на сервере не хранится. */
  tokenHash: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
  deviceName?: string | null
  devicePlatform?: string | null
  expiresAt: number | null
}

export type PendingPairing = {
  id: string
  label: string
  /** Одноразовый секрет в открытом виде — он и есть код в QR. */
  secret: string
  fingerprint: string
  createdAt: number
  expiresAt: number
}

type ClientsFile = { clients: ClientRecord[] }
type PairingsFile = { pending: PendingPairing[] }

const sessions = new Map<string, SessionInfo>()
const clients = new Map<string, ClientRecord>()
let pairingsLoaded = false

/** sha256 в hex — для хранения отпечатков токенов и кодов. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

// --- загрузка клиентов ---

function loadClients(): void {
  const stored = readYamlFile<ClientsFile>(paths.clientsFile, { clients: [] })
  clients.clear()
  for (const entry of stored.clients) {
    if (typeof entry?.id !== 'string' || typeof entry?.tokenHash !== 'string') continue
    clients.set(entry.id, entry)
  }
}

export function ensureClientsLoaded(): void {
  if (clients.size === 0) loadClients()
  if (!pairingsLoaded) loadPairings()
}

function persistClients(): void {
  writeYamlFile(paths.clientsFile, { clients: [...clients.values()] })
}

// --- сессии входа ---

export function createSession(username: string): SessionInfo {
  const now = Date.now()
  const info: SessionInfo = {
    id: randomBytes(32).toString('base64url'),
    username,
    createdAt: now,
    lastSeenAt: now,
  }
  sessions.set(info.id, info)
  return info
}

export function getSession(id: string | undefined): SessionInfo | undefined {
  if (!id) return undefined
  const info = sessions.get(id)
  if (!info) return undefined
  info.lastSeenAt = Date.now()
  return info
}

export function dropSession(id: string | undefined): boolean {
  if (!id) return false
  return sessions.delete(id)
}

export const SESSION_COOKIE = 'nc_session'

// --- одноразовые коды сопряжения ---

function loadPairings(): void {
  const stored = readYamlFile<PairingsFile>(paths.pairingsFile, { pending: [] })
  const now = Date.now()
  const alive = stored.pending.filter(
    (entry) => typeof entry?.id === 'string' && typeof entry?.secret === 'string' && entry.expiresAt > now,
  )
  pairingsLoaded = true
  pendingPairings.clear()
  for (const entry of alive) pendingPairings.set(entry.id, entry)
}

const pendingPairings = new Map<string, PendingPairing>()

function persistPairings(): void {
  writeYamlFile(paths.pairingsFile, { pending: [...pendingPairings.values()] })
}

/** Создаёт одноразовый код. Ответ идёт в QR на телефоне. */
export function createPairing(label = 'Телефон', ttlMs = defaults.pairingTtlMs): PendingPairing {
  ensureClientsLoaded()
  const secret = randomBytes(24).toString('base64url')
  const now = Date.now()
  const pairing: PendingPairing = {
    id: `pair_${randomBytes(9).toString('base64url')}`,
    label,
    secret,
    fingerprint: sha256(secret).slice(0, 16),
    createdAt: now,
    expiresAt: now + ttlMs,
  }
  pendingPairings.set(pairing.id, pairing)
  persistPairings()
  return pairing
}

export function listPendingPairings(): PendingPairing[] {
  ensureClientsLoaded()
  const now = Date.now()
  let changed = false
  for (const [id, entry] of pendingPairings) {
    if (entry.expiresAt <= now) {
      pendingPairings.delete(id)
      changed = true
    }
  }
  if (changed) persistPairings()
  return [...pendingPairings.values()].map((entry) => ({ ...entry }))
}

export function cancelPairing(id: string): boolean {
  ensureClientsLoaded()
  const removed = pendingPairings.delete(id)
  if (removed) persistPairings()
  return removed
}

/**
 * Обмен кода на постоянный токен клиента. Код одноразовый: после успеха он
 * удаляется, повторное использование того же кода невозможно.
 */
export function redeemPairing(
  secret: string,
  meta: { label?: string; deviceName?: string | null; devicePlatform?: string | null } = {},
): { token: string; client: ClientRecord } | null {
  ensureClientsLoaded()
  const now = Date.now()
  for (const [id, entry] of pendingPairings) {
    if (entry.expiresAt <= now) {
      pendingPairings.delete(id)
      continue
    }
    if (!constantTimeEquals(entry.secret, secret)) continue

    pendingPairings.delete(id)
    persistPairings()

    const issued = issueClientToken({
      label: meta.label?.trim() || entry.label,
      deviceName: meta.deviceName,
      devicePlatform: meta.devicePlatform,
    })
    return issued
  }
  return null
}

export type ClientTokenMeta = {
  label?: string
  deviceName?: string | null
  devicePlatform?: string | null
}

/**
 * Выдаёт постоянный токен устройства.
 *
 * Используется и при обмене кода сопряжения, и при входе по паролю из
 * мобильного приложения: cookie в приложении ненадёжна (свой источник,
 * сторонние cookie могут блокироваться), поэтому телефон всегда работает с
 * токеном.
 */
export function issueClientToken(meta: ClientTokenMeta = {}): { token: string; client: ClientRecord } {
  ensureClientsLoaded()
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const client: ClientRecord = {
    id: `cli_${randomBytes(9).toString('base64url')}`,
    label: meta.label?.trim() || 'Устройство',
    tokenHash: sha256(token),
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    deviceName: meta.deviceName ?? null,
    devicePlatform: meta.devicePlatform ?? null,
    expiresAt: defaults.clientTtlMs > 0 ? now + defaults.clientTtlMs : null,
  }
  clients.set(client.id, client)
  persistClients()
  return { token, client }
}

/** Проверяет токен мобильного клиента. */
export function verifyClientToken(token: string | undefined): ClientRecord | null {
  ensureClientsLoaded()
  if (!token) return null
  const hash = sha256(token)
  const now = Date.now()
  for (const client of clients.values()) {
    if (client.revokedAt) continue
    if (client.expiresAt !== null && client.expiresAt <= now) continue
    if (!constantTimeEquals(client.tokenHash, hash)) continue
    client.lastUsedAt = now
    persistClients()
    return client
  }
  return null
}

export function listClients(): ClientRecord[] {
  ensureClientsLoaded()
  return [...clients.values()]
    .map((client) => ({ ...client }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function revokeClient(id: string): boolean {
  ensureClientsLoaded()
  const client = clients.get(id)
  if (!client || client.revokedAt) return false
  client.revokedAt = Date.now()
  persistClients()
  return true
}

export function purgeRevokedClients(): number {
  ensureClientsLoaded()
  const removed = [...clients.values()].filter((client) => client.revokedAt)
  for (const client of removed) clients.delete(client.id)
  if (removed.length) persistClients()
  return removed.length
}
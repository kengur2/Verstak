/**
 * Управление экземплярами OpenCode — по одному на рабочую папку.
 *
 * Для каждой папки поднимается свой `opencode service`, чтобы параллельные
 * сессии в разных проектах не мешали друг другу.
 * Контракт API — OpenCode v2 (`/api/*`, basic-auth, SSE на `/api/event`).
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { getConfig } from './config.ts'
import { rememberFolder } from './config.ts'

const run = promisify(execFile)

export type Endpoint = {
  url: string
  username: string
  password: string
}

export type Instance = {
  /** Идентификатор инстанса = путь к папке в base64url. */
  id: string
  directory: string
  endpoint: Endpoint | null
  state: 'stopped' | 'starting' | 'ready' | 'error'
  error?: string
  lastUsedAt: number
}

const instances = new Map<string, Instance>()
const starting = new Map<string, Promise<Instance>>()

export const encodeInstanceId = (directory: string): string =>
  Buffer.from(directory, 'utf8').toString('base64url')

export const decodeInstanceId = (id: string): string | null => {
  try {
    const decoded = Buffer.from(id, 'base64url').toString('utf8')
    return decoded.startsWith('/') ? decoded : null
  } catch {
    return null
  }
}

/** Путь к бинарнику OpenCode: сперва настройки, потом стандартные места. */
export function resolveOpencodeBinary(): string {
  const configured = getConfig().opencodeBinaries
    .filter((entry) => entry.path)
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))[0]?.path
  const candidates = [
    configured,
    process.env.VERSTAK_OPENCODE_BIN,
    `${process.env.HOME}/.opencode/bin/opencode`,
    '/usr/local/bin/opencode',
    '/usr/bin/opencode',
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'opencode'
}

const assertLoopbackUrl = (value: string): string => {
  const url = new URL(value)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (!loopback) {
    throw new Error(`OpenCode вернул нелокальный адрес: ${value}`)
  }
  return url.origin
}

/** Читает адрес и пароль запущенной службы OpenCode. */
async function discoverEndpoint(binary: string, cwd: string): Promise<Endpoint | null> {
  const options = { cwd, timeout: 15_000, maxBuffer: 1024 * 256, encoding: 'utf8' as const }

  const status = await run(binary, ['service', 'status'], options).then(
    (result) => result.stdout.trim(),
    () => '',
  )
  if (!status || !/^https?:\/\//.test(status)) return null

  const password = await run(binary, ['service', 'get', 'password'], options)
    .then((result) => result.stdout.trim())
    .catch(() => '')
  if (!password) return null

  return { url: assertLoopbackUrl(status), username: 'opencode', password }
}

/**
 * Поднимает службу OpenCode для папки. Повторные вызовы во время старта
 * возвращают один и тот же промис, поэтому два клиента не создадут две службы.
 */
export async function ensureInstance(directory: string): Promise<Instance> {
  const id = encodeInstanceId(directory)
  const existing = instances.get(id)
  if (existing?.state === 'ready' && existing.endpoint) return existing

  const pending = starting.get(id)
  if (pending) return pending

  const task = (async (): Promise<Instance> => {
    const base: Instance = existing ?? {
      id,
      directory,
      endpoint: null,
      state: 'starting',
      lastUsedAt: Date.now(),
    }
    base.state = 'starting'
    base.error = undefined
    base.lastUsedAt = Date.now()
    instances.set(id, base)

    const binary = resolveOpencodeBinary()
    try {
      const discovered = await discoverEndpoint(binary, directory)
      if (!discovered) {
        const started = await run(binary, ['service', 'start'], {
          cwd: directory,
          timeout: 60_000,
          maxBuffer: 1024 * 256,
          encoding: 'utf8' as const,
        }).then((result) => result.stdout.trim())
        if (!/^https?:\/\//.test(started)) {
          throw new Error(`Служба OpenCode вернула неожиданный ответ: ${started || '(пусто)'}`)
        }
        const password = await run(binary, ['service', 'get', 'password'], {
          cwd: directory,
          timeout: 15_000,
          encoding: 'utf8' as const,
        }).then((result) => result.stdout.trim())
        if (!password) throw new Error('Служба OpenCode не вернула пароль')
        base.endpoint = { url: assertLoopbackUrl(started), username: 'opencode', password }
      } else {
        base.endpoint = discovered
      }

      base.state = 'ready'
      base.error = undefined
      rememberFolder(directory)
      return base
    } catch (error) {
      base.state = 'error'
      base.error = error instanceof Error ? error.message : String(error)
      return base
    } finally {
      starting.delete(id)
    }
  })()

  starting.set(id, task)
  return task
}

export function getInstance(directory: string): Instance | undefined {
  return instances.get(encodeInstanceId(directory))
}

export function listInstances(): Instance[] {
  return [...instances.values()]
    .map((instance) => ({ ...instance }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

/** Останавливает службу OpenCode для папки. */
export async function stopInstance(directory: string): Promise<boolean> {
  const binary = resolveOpencodeBinary()
  await run(binary, ['service', 'stop'], {
    cwd: directory,
    timeout: 30_000,
    encoding: 'utf8' as const,
  }).catch(() => undefined)
  instances.delete(encodeInstanceId(directory))
  return true
}

/** Запрашивает у OpenCode инстанс для каталога (basic-auth, как в API v2). */
export async function opencodeFetch(
  directory: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const instance = await ensureInstance(directory)
  if (!instance.endpoint) {
    throw new Error(instance.error ?? 'Экземпляр OpenCode недоступен')
  }
  const { username, password, url } = instance.endpoint
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
  const target = new URL(path.startsWith('/') ? path : `/${path}`, url)
  const headers = new Headers(init.headers)
  headers.set('authorization', authorization)
  return fetch(target, { ...init, headers })
}
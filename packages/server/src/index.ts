/**
 * HTTP-сервер Verstak.
 *
 * Отдаёт собранный веб-интерфейс, проксирует запросы к OpenCode и держит
 * SSE-поток событий. Доступ из локальной сети (для телефона) включается
 * настройкой `lanAccess`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SESSION_COOKIE,
  cancelPairing,
  createPairing,
  createSession,
  dropSession,
  getSession,
  issueClientToken,
  listClients,
  listPendingPairings,
  purgeRevokedClients,
  redeemPairing,
  revokeClient,
  verifyClientToken,
} from './sessions.ts'
import { isPasswordConfigured, setPassword, validateLogin, getUsername } from './auth.ts'
import { getConfig, resetConfigCache, updateConfig } from './config.ts'
import {
  ensureInstance,
  listInstances,
  opencodeFetch,
  resolveOpencodeBinary,
  stopInstance,
} from './instances.ts'
import { defaults, paths } from './paths.ts'
import { listAddresses } from './network.ts'
import { scheduler } from './scheduler.ts'
import { sftpStatus, startSftpServer, stopSftpServer, hostKeyFingerprint, listProjectRoots } from './sftp.ts'
import { downloadName, ensureReadable, listDirectory, listProjects } from './files.ts'
import { collectStats, resetStatsCache } from './stats.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const json = (res: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

const parseCookies = (header: string | undefined): Record<string, string> => {
  const jar: Record<string, string> = {}
  if (!header) return jar
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) jar[name] = decodeURIComponent(value)
  }
  return jar
}

const readBody = async (req: IncomingMessage, limit: number): Promise<string> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) throw new Error('Тело запроса слишком велико')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const sendLocalAddressHelp = (res: ServerResponse): void => {
  json(res, 403, {
    error: 'Доступ из сети выключен',
    hint: 'Включите lanAccess в настройках Verstak или в ~/.config/verstak/config.yaml',
  })
}

/** Локальные адреса, с которых подключение считается доверенным. */
const isLoopbackRequest = (req: IncomingMessage): boolean => {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

const setSessionCookie = (res: ServerResponse, sessionId: string): void => {
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  )
}

const clearSessionCookie = (res: ServerResponse): void => {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
}

/**
 * Дополняет путь рабочей папкой там, где OpenCode это понимает.
 *
 * Список сессий, проектов, файлов и систем контроля версий без параметра
 * `directory` вернул бы данные всех папок сразу. Модели и агенты намеренно не
 * сужаем: у проекта без собственного opencode.json список оказался бы пустым,
 * хотя глобальные модели доступны.
 */
const scopeToDirectory = (path: string, directory: string): string => {
  const [pathname = '', search = ''] = path.split('?')
  const scoped =
    pathname === '/api/session' ||
    pathname === '/api/project' ||
    pathname.startsWith('/api/fs/') ||
    pathname.startsWith('/api/vcs/')
  if (!scoped) return path

  const params = new URLSearchParams(search)
  if (!params.has('directory')) params.set('directory', directory)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** Проксирует запрос к OpenCode, сохраняя статус, тело и SSE-поток. */
const proxyToOpencode = async (
  req: IncomingMessage,
  res: ServerResponse,
  directory: string,
  target: string,
): Promise<void> => {
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? await readBody(req, defaults.maxBodyBytes) : undefined

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value !== 'string') continue
    const lower = name.toLowerCase()
    if (lower === 'host' || lower === 'cookie' || lower === 'authorization') continue
    // Кодирование ответа отдаём на откуп Node: fetch распаковывает тело сам, и
    // заголовки о сжатии от исходного ответа уже неверны.
    if (lower === 'accept-encoding') continue
    headers[lower] = value
  }

  const upstream = await opencodeFetch(directory, target, {
    method,
    headers,
    body: body || undefined,
  })

  const outgoing: Record<string, string | string[]> = {}
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase()
    // Длину и кодирование тела пересчитывает Node: тело уже распаковано, а
    // исходный content-length относится к сжатому варианту. Если его
    // пробросить, клиент прочитает только часть ответа — JSON оборвётся.
    if (lower === 'transfer-encoding' || lower === 'content-encoding' || lower === 'content-length') return
    outgoing[lower] = value
  })
  res.writeHead(upstream.status, outgoing)

  if (!upstream.body) {
    res.end()
    return
  }
  // SSE: тело нужно проксировать потоком, без буферизации.
  const reader = upstream.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) res.write(Buffer.from(value))
  }
  res.end()
}

const serveStatic = (res: ServerResponse, root: string, pathname: string): boolean => {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  const target = resolve(join(root, relative))
  if (!target.startsWith(root + sep) && target !== root) return false
  if (!existsSync(target)) return false

  const stats = statSync(target)
  if (stats.isDirectory()) return false

  res.writeHead(200, {
    'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stats.size,
    // Собранный бандл иммутабелен, поэтому его можно кэшировать надолго.
    'cache-control': target.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  })
  createReadStream(target).pipe(res)
  return true
}

const handleApi = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
  const method = req.method ?? 'GET'
  const route = url.pathname

  // --- вход ---
  if (route === '/api/auth/status' && method === 'GET') {
    json(res, 200, {
      passwordConfigured: isPasswordConfigured(),
      username: getUsername(),
      locale: getConfig().locale,
    })
    return true
  }

  if (route === '/api/auth/login' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}') as {
      username?: string
      password?: string
    }
    if (!body.username || !body.password) {
      json(res, 400, { error: 'Нужны имя пользователя и пароль' })
      return true
    }
    if (!validateLogin(body.username, body.password)) {
      json(res, 401, { error: 'Неверное имя пользователя или пароль' })
      return true
    }
    const session = createSession(body.username)
    setSessionCookie(res, session.id)
    json(res, 200, { authenticated: true, username: session.username })
    return true
  }

  if (route === '/api/auth/logout' && method === 'POST') {
    const jar = parseCookies(req.headers.cookie)
    dropSession(jar[SESSION_COOKIE])
    clearSessionCookie(res)
    json(res, 200, { authenticated: false })
    return true
  }

  if (route === '/api/auth/password' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}') as {
      currentPassword?: string
      newPassword?: string
    }
    const jar = parseCookies(req.headers.cookie)
    const loopback = isLoopbackRequest(req)
    const authed = Boolean(getSession(jar[SESSION_COOKIE]))
    if (!loopback && !authed) {
      sendLocalAddressHelp(res)
      return true
    }
    if (isPasswordConfigured() && !validateLogin(getUsername(), body.currentPassword ?? '')) {
      json(res, 401, { error: 'Текущий пароль неверен' })
      return true
    }
    if (!body.newPassword || body.newPassword.length < 8) {
      json(res, 400, { error: 'Новый пароль должен быть не короче 8 символов' })
      return true
    }
    setPassword(getUsername(), body.newPassword)
    json(res, 200, { updated: true })
    return true
  }

  const jar = parseCookies(req.headers.cookie)
  const session = getSession(jar[SESSION_COOKIE])
  // EventSource не умеет заголовки, поэтому мобильный клиент передаёт токен
  // параметром адреса. Для обычных запросов предпочтителен заголовок.
  const bearer =
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? (url.searchParams.get('token') ?? undefined)
  const client = verifyClientToken(bearer)

  // Проверка доступности сервера: нужна до входа, чтобы телефон понял, что
  // адрес верный, ещё до сопряжения.
  if (route === '/api/health' && method === 'GET') {
    json(res, 200, {
      healthy: true,
      app: 'Verstak',
      opencodeBinary: resolveOpencodeBinary(),
      lanAccess: getConfig().lanAccess,
      locale: getConfig().locale,
    })
    return true
  }

  // Всё, что ниже, требует входа. Исключения: обмен кода сопряжения и вход по
  // паролю из мобильного приложения — там ещё нет ни сессии, ни токена.
  const opensWithoutSession =
    (route === '/api/pairing/redeem' && method === 'POST') ||
    (route === '/api/pairing/login' && method === 'POST')
  if (!session && !client && !opensWithoutSession) {
    json(res, 401, { error: 'Требуется вход' })
    return true
  }

  // --- сопряжение телефона ---
  if (route === '/api/pairing/sessions' && method === 'POST') {
    if (!session) {
      json(res, 403, { error: 'Создавать коды сопряжения может только вошедший в систему' })
      return true
    }
    const body = JSON.parse((await readBody(req, 8 * 1024)) || '{}') as {
      label?: string
      ttlMs?: number
      serverUrl?: string
    }
    const pairing = createPairing(body.label?.trim() || 'Телефон', body.ttlMs ?? defaults.pairingTtlMs)
    const config = getConfig()
    const addresses = listAddresses(config.port, bindHost(config))
    json(res, 200, {
      pairing: {
        id: pairing.id,
        label: pairing.label,
        secret: pairing.secret,
        fingerprint: pairing.fingerprint,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
      },
      server: {
        port: config.port,
        lanAccess: config.lanAccess,
        // Адреса, по которым сервер виден из сети: телефон сам выбрать не
        // может, а `127.0.0.1` с телефона указывает на сам телефон.
        addresses,
        suggestedUrl: body.serverUrl ?? addresses[0]?.url ?? null,
      },
    })
    return true
  }

  if (route === '/api/pairing/sessions' && method === 'GET') {
    json(res, 200, { pending: listPendingPairings().map((entry) => ({
      id: entry.id,
      label: entry.label,
      fingerprint: entry.fingerprint,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    })) })
    return true
  }

  if (route.startsWith('/api/pairing/sessions/') && method === 'DELETE') {
    const id = route.slice('/api/pairing/sessions/'.length)
    json(res, 200, { cancelled: cancelPairing(decodeURIComponent(id)) })
    return true
  }

  // Обмен одноразового кода на постоянный токен. Открыт без входа:
  // код сопряжения и есть credential, иначе телефон не смог бы войти.
  if (route === '/api/pairing/redeem' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 8 * 1024)) || '{}') as {
      secret?: string
      label?: string
      deviceName?: string | null
      devicePlatform?: string | null
    }
    if (!body.secret) {
      json(res, 400, { error: 'Нужен код сопряжения' })
      return true
    }
    const redeemed = redeemPairing(body.secret, {
      label: body.label,
      deviceName: body.deviceName ?? null,
      devicePlatform: body.devicePlatform ?? null,
    })
    if (!redeemed) {
      json(res, 401, { error: 'Код сопряжения недействителен или истёк' })
      return true
    }
    json(res, 200, { token: redeemed.token, client: redeemed.client })
    return true
  }

  // Вход по паролю из мобильного приложения: cookie там ненадёжна, поэтому
  // сразу выдаём постоянный токен устройства.
  if (route === '/api/pairing/login' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 8 * 1024)) || '{}') as {
      username?: string
      password?: string
      deviceName?: string | null
      devicePlatform?: string | null
    }
    if (!body.username || !body.password) {
      json(res, 400, { error: 'Нужны имя пользователя и пароль' })
      return true
    }
    if (!validateLogin(body.username, body.password)) {
      json(res, 401, { error: 'Неверное имя пользователя или пароль' })
      return true
    }
    if (!isPasswordConfigured()) {
      json(res, 400, { error: 'Пароль ещё не задан' })
      return true
    }
    const issued = issueClientToken({
      label: body.deviceName?.trim() || 'Мобильное приложение',
      deviceName: body.deviceName ?? null,
      devicePlatform: body.devicePlatform ?? null,
    })
    json(res, 200, { token: issued.token, client: issued.client })
    return true
  }

  if (route === '/api/clients' && method === 'GET') {
    json(res, 200, { clients: listClients().map(({ tokenHash: _tokenHash, ...rest }) => rest) })
    return true
  }

  if (route === '/api/clients' && method === 'DELETE') {
    json(res, 200, { purged: purgeRevokedClients() })
    return true
  }

  if (route.startsWith('/api/clients/') && method === 'DELETE') {
    const id = route.slice('/api/clients/'.length)
    json(res, 200, { revoked: revokeClient(decodeURIComponent(id)) })
    return true
  }

  // --- метаданные и настройки ---
  if (route === '/api/me' && method === 'GET') {
    json(res, 200, {
      authenticated: true,
      username: session?.username ?? null,
      client: client
        ? { id: client.id, label: client.label, devicePlatform: client.devicePlatform ?? null }
        : null,
      locale: getConfig().locale,
    })
    return true
  }

  if (route === '/api/config' && method === 'GET') {
    json(res, 200, getConfig())
    return true
  }

  if (route === '/api/config' && method === 'PATCH') {
    const patch = JSON.parse((await readBody(req, 64 * 1024)) || '{}') as Record<string, unknown>
    const before = getConfig()
    const next = updateConfig(patch as never)

    // Порт и доступ по SFTP читаются при запуске, поэтому применяем изменения
    // сразу: иначе новая настройка заработала бы только после перезапуска.
    const sftpChanged =
      before.sftpEnabled !== next.sftpEnabled ||
      before.sftpPort !== next.sftpPort ||
      before.lanAccess !== next.lanAccess
    if (sftpChanged) {
      await startSftpServer().catch((error: unknown) => {
        console.error(`SFTP: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    json(res, 200, next)
    return true
  }

  // --- статистика использования ---
  if (route === '/api/stats' && method === 'GET') {
    const requested = Number.parseInt(url.searchParams.get('days') ?? '7', 10)
    const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 3650) : 0
    try {
      json(res, 200, await collectStats(days))
    } catch (error) {
      json(res, 502, { error: error instanceof Error ? error.message : 'Не удалось собрать статистику' })
    }
    return true
  }

  if (route === '/api/sftp' && method === 'GET') {    const config = getConfig()
    const status = sftpStatus()
    json(res, 200, {
      enabled: config.sftpEnabled,
      running: status.running,
      port: config.sftpPort,
      write: config.sftpWrite,
      username: getUsername(),
      fingerprint: hostKeyFingerprint(),
      // С телефона адрес компьютера нужен целиком: порт у SFTP свой.
      addresses: listAddresses(config.sftpPort, bindHost(config)),
      projects: listProjectRoots().map((root) => root.name),
    })
    return true
  }

  // --- файлы проектов ---
  if (route === '/api/files/projects' && method === 'GET') {
    json(res, 200, { projects: listProjects() })
    return true
  }

  if (route === '/api/files/list' && method === 'GET') {
    const target = url.searchParams.get('path') ?? ''
    try {
      json(res, 200, { path: target, entries: await listDirectory(target) })
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code: number }).code : 4
      json(res, code === 2 ? 404 : code === 3 ? 403 : 400, {
        error: error instanceof Error ? error.message : 'Не удалось прочитать папку',
      })
    }
    return true
  }

  if (route === '/api/files/text' && method === 'GET') {
    const target = url.searchParams.get('path') ?? ''
    try {
      const file = await ensureReadable(target)
      const stats = await stat(file)
      // Предпросмотр нужен для небольших текстовых файлов: читать целиком
      // мегабайты в браузер телефона смысла нет.
      if (stats.size > defaults.maxPreviewBytes) {
        json(res, 413, { error: 'Файл слишком большой для просмотра' })
        return true
      }
      const content = await readFile(file, 'utf8')
      json(res, 200, { path: target, size: stats.size, content })
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : 'Не удалось прочитать файл' })
    }
    return true
  }

  if (route === '/api/files/download' && method === 'GET') {
    const target = url.searchParams.get('path') ?? ''
    try {
      const file = await ensureReadable(target)
      const stats = await stat(file)
      if (!stats.isFile()) {
        json(res, 400, { error: 'Это не файл' })
        return true
      }
      const name = downloadName(file)
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': stats.size,
        // Имя файла в заголовке: по нему браузер и приложение называют файл.
        'content-disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      })
      createReadStream(file).pipe(res)
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : 'Не удалось скачать файл' })
    }
    return true
  }

  // --- папки и инстансы ---
  if (route === '/api/workspaces' && method === 'GET') {
    const config = getConfig()
    json(res, 200, {
      folders: config.recentFolders,
      instances: listInstances(),
      scheduler: scheduler.list(),
    })
    return true
  }

  // --- задачи по расписанию ---
  if (route === '/api/tasks' && method === 'GET') {
    json(res, 200, { tasks: scheduler.list() })
    return true
  }

  if (route === '/api/tasks' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 128 * 1024)) || '{}') as {
      name?: string
      prompt?: string
      directory?: string
      schedule?: never
      model?: string
    }
    if (!body.prompt?.trim() || !body.directory?.startsWith('/')) {
      json(res, 400, { error: 'Нужны текст задачи и папка проекта' })
      return true
    }
    json(res, 201, { task: scheduler.create({
      name: body.name ?? '',
      prompt: body.prompt,
      directory: body.directory,
      schedule: (body.schedule ?? { kind: 'interval', everyMinutes: 60 }) as never,
      model: body.model,
    }) })
    return true
  }

  const taskMatch = /^\/api\/tasks\/([^/]+)(\/run)?$/.exec(route)
  if (taskMatch) {
    const id = decodeURIComponent(taskMatch[1] ?? '')
    if (method === 'DELETE' && !taskMatch[2]) {
      json(res, 200, { deleted: scheduler.remove(id) })
      return true
    }
    if (method === 'PATCH' && !taskMatch[2]) {
      const patch = JSON.parse((await readBody(req, 128 * 1024)) || '{}') as Record<string, unknown>
      json(res, 200, { task: scheduler.update(id, patch as never) })
      return true
    }
    if (method === 'POST' && taskMatch[2]) {
      json(res, 200, await scheduler.runNow(id))
      return true
    }
  }

  const workspaceMatch = /^\/api\/workspaces\/([^/]+)(\/.*)?$/.exec(route)
  if (workspaceMatch) {
    const [, encodedId, tail = ''] = workspaceMatch
    const directory = Buffer.from(decodeURIComponent(encodedId ?? ''), 'base64url').toString('utf8')

    if (method === 'DELETE' && tail === '') {
      json(res, 200, { stopped: await stopInstance(directory) })
      return true
    }

    if (method === 'GET' && tail === '') {
      const instance = await ensureInstance(directory)
      // Список проектов мог пополниться — сводку нужно посчитать заново.
      resetStatsCache()
      json(res, 200, {
        id: instance.id,
        directory: instance.directory,
        state: instance.state,
        error: instance.error ?? null,
      })
      return true
    }

    // Всё остальное — проксирование к OpenCode для этой папки. Строка запроса
    // переносится как есть: от неё зависят limit, type, cursor и поиск.
    const target = tail.startsWith('/opencode') ? tail.slice('/opencode'.length) || '/' : tail
    const upstream = `/api${target === '/' ? '' : target}${url.search}`
    try {
      await proxyToOpencode(req, res, directory, scopeToDirectory(upstream, directory))
    } catch (error) {
      json(res, 502, { error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  json(res, 404, { error: 'Неизвестный маршрут API' })
  return true
}

/**
 * Заголовки CORS.
 *
 * Мобильное приложение открывает интерфейс со своего внутреннего адреса
 * (`https://localhost`), а сервер живёт в локальной сети под другим адресом —
 * без этих заголовков браузер запретил бы такие запросы. Доступ и так защищён
 * паролем или токеном устройства, поэтому источник не ограничиваем.
 */
const applyCors = (req: IncomingMessage, res: ServerResponse): void => {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('access-control-allow-headers', 'authorization, content-type, accept')
  res.setHeader('access-control-max-age', '600')
  res.setHeader('vary', 'origin')
}

export const createVerstakServer = () =>
  createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        const loopback = isLoopbackRequest(req)

        applyCors(req, res)

        // Предварительный запрос браузера перед основным. Отвечаем сразу:
        // сами данные он не запрашивает.
        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        // Вход и статика доступны без авторизации: без них нельзя показать
        // ни форму входа, ни саму PWA-оболочку на телефоне.
        const publicRoute =
          url.pathname.startsWith('/api/auth/') ||
          url.pathname === '/api/pairing/redeem' ||
          url.pathname === '/api/pairing/login' ||
          url.pathname === '/api/health' ||
          !url.pathname.startsWith('/api/')

        if (!publicRoute && !loopback && !getConfig().lanAccess) {
          sendLocalAddressHelp(res)
          return
        }

        if (url.pathname.startsWith('/api/')) {
          const handled = await handleApi(req, res, url)
          if (handled) return
        }

        const root = fileURLToPath(new URL('.', import.meta.url))
        const webRoot = existsSync(paths.webDist)
          ? fileURLToPath(new URL(paths.webDist, 'file://'))
          : join(root, '..', '..', 'web', 'dist')

        if (existsSync(webRoot) && serveStatic(res, webRoot, url.pathname)) return

        // SPA-роутинг: неизвестный путь отдаёт index.html.
        if (existsSync(webRoot) && serveStatic(res, webRoot, '/index.html')) return

        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Verstak: интерфейс не собран. Выполните: npm run build:web')
      } catch (error) {
        if (!res.headersSent) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        } else {
          res.end()
        }
      }
    })()
  })

/**
 * Адрес, на котором слушает сервер.
 *
 * Настройка «доступ из сети» сама по себе ничего не открывает: без неё сервер
 * слушает только этот компьютер, с ней — все интерфейсы. Поэтому реальный
 * адрес прослушивания зависит от неё, а не только от `hostname`.
 */
const bindHost = (config: { hostname: string; lanAccess: boolean }): string =>
  config.lanAccess ? '0.0.0.0' : config.hostname

const main = async (): Promise<void> => {
  // Перечитываем конфиг при старте: он мог быть изменён вручную.
  resetConfigCache()
  const config = getConfig()
  const server = createVerstakServer()

  scheduler.start()

  // SFTP поднимаем вместе с сервером: настройка уже сохранена в конфиге.
  const sftp = await startSftpServer().catch((error: unknown) => {
    console.error(`SFTP: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })

  server.listen(config.port, bindHost(config), () => {
    const config2 = getConfig()
    console.log(`Verstak: http://${config2.hostname}:${config2.port}`)
    console.log(`Конфиг: ${paths.configFile}`)
    if (sftp) {
      console.log(`SFTP: порт ${sftp.port}, папок проектов — ${listProjectRoots().length}`)
    }
    if (!config2.lanAccess) {
      console.log('Доступ из сети выключен. Для телефона включите lanAccess в настройках.')
    } else {
      const addresses = listAddresses(config2.port, '0.0.0.0')
        .filter((address) => address.kind === 'lan')
        .map((address) => address.url)
      console.log('Доступ из сети включён. Адреса для телефона:')
      for (const url of addresses) console.log(`  ${url}`)
      if (!addresses.length) console.log('  (сетевые интерфейсы не найдены)')
    }
  })

  const shutdown = (): void => {
    scheduler.stop()
    void stopSftpServer()
    server.close(() => process.exit(0))
    // Страховка: если сокеты не закроются, выходим принудительно.
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  void main()
}
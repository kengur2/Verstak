/**
 * SFTP-доступ к файлам проектов.
 *
 * Нужен, чтобы с телефона можно было забрать файлы проекта любым файловым
 * менеджером, не открывая веб-интерфейс.
 *
 * Как устроен доступ:
 *   • в корне видно папки проектов — те же, что открывались в Verstak;
 *   • каждая папка ведёт на реальную папку проекта;
 *   • выйти за пределы этих папок нельзя: путь нормализуется и проверяется,
 *     что он остался внутри проекта, включая проверку символических ссылок;
 *   • по умолчанию доступ только на чтение — телефону файлы нужно скачать, а
 *     не изменить. Запись включается отдельной настройкой.
 *
 * Аутентификация та же, что у входа в приложение: имя пользователя и пароль.
 * Вместо пароля принимается и токен подключённого устройства — он уже есть у
 * телефона, поэтому пароль не нужно вводить заново.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { open, readdir, stat as fsStat, lstat as fsLstat, realpath as fsRealpath } from 'node:fs/promises'
import { basename, dirname, posix, resolve, sep } from 'node:path'
import ssh2 from 'ssh2'
import type { Attributes, FileEntry, SFTPWrapper, Server as SshServer } from 'ssh2'
import { getConfig } from './config.ts'
import { getUsername, validateLogin } from './auth.ts'
import { verifyClientToken } from './sessions.ts'
import { paths } from './paths.ts'

// ssh2 — обычный CommonJS-пакет: именованные импорты в ESM Node не находит,
// поэтому берём экспорт целиком.
const { Server, utils } = ssh2

const { OPEN_MODE, STATUS_CODE } = utils.sftp

export type ProjectRoot = {
  /** Имя папки в корне SFTP: может отличаться от реального при совпадении. */
  name: string
  path: string
}

let server: SshServer | null = null
let runningPort: number | null = null

/**
 * Проекты, видимые по SFTP.
 *
 * Берём те же папки, что открывались в программе: список совпадает с тем, что
 * видно в интерфейсе, и его не нужно настраивать отдельно.
 */
export function listProjectRoots(): ProjectRoot[] {
  const used = new Map<string, number>()
  const roots: ProjectRoot[] = []

  for (const folder of getConfig().recentFolders) {
    if (!existsSync(folder.path)) continue
    const base = basename(folder.path) || folder.path
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    roots.push({ name: seen === 0 ? base : `${base}-${seen + 1}`, path: resolve(folder.path) })
  }

  return roots.sort((a, b) => a.name.localeCompare(b.name))
}

/** Ошибка с кодом SFTP — превращается в понятный ответ клиенту. */
export class SftpError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'SftpError'
    this.code = code
  }
}

/**
 * Разрешает виртуальный путь в реальный.
 *
 * Возвращает `null`, если путь выходит за пределы проектов: например,
 * `/../../etc/passwd`. Проверка идёт по нормализованному пути, поэтому обойти
 * её переходами вида `..` нельзя.
 */
export function resolveVirtualPath(virtualPath: string): { root: ProjectRoot; real: string } | null {
  const clean = posix.normalize(virtualPath.replace(/\\/g, '/')).replace(/^\/+/, '')
  if (!clean || clean === '.') return null

  const segments = clean.split('/')
  const name = segments[0]
  if (!name) return null

  const root = listProjectRoots().find((item) => item.name === name)
  if (!root) return null

  const real = resolve(root.path, ...segments.slice(1))
  if (real !== root.path && !real.startsWith(root.path + sep)) return null
  return { root, real }
}

/** Проверяет, что реальный путь принадлежит одному из проектов. */
export function isInsideProjects(realPath: string): boolean {
  const target = resolve(realPath)
  return listProjectRoots().some((root) => target === root.path || target.startsWith(root.path + sep))
}

/**
 * Проверяет путь с учётом символических ссылок.
 *
 * Проверки по строке мало: ссылка внутри проекта может вести наружу. Поэтому у
 * существующих файлов дополнительно разворачиваем ссылки и проверяем результат.
 */
async function assertInsideProjects(realPath: string): Promise<void> {
  if (!isInsideProjects(realPath)) {
    throw new SftpError(STATUS_CODE.PERMISSION_DENIED, 'Путь вне папок проектов')
  }
  try {
    const resolved = await fsRealpath(realPath)
    if (!isInsideProjects(resolved)) {
      throw new SftpError(STATUS_CODE.PERMISSION_DENIED, 'Ссылка ведёт вне папок проектов')
    }
  } catch (error) {
    if (error instanceof SftpError) throw error
    // Файла ещё нет — для REALPATH это нормально, проверки выше достаточно.
  }
}

/** Приводит статистику файла к виду, который понимает SFTP. */
const toAttributes = (stats: { mode: number; size: number; atimeMs: number; mtimeMs: number }): Attributes => ({
  mode: stats.mode,
  uid: 0,
  gid: 0,
  size: stats.size,
  atime: stats.atimeMs,
  mtime: stats.mtimeMs,
})

/** Строка файла в стиле `ls -l`: её показывают клиенты в списке. */
const longName = (stats: { mode: number; size: number; mtimeMs: number }, name: string): string => {
  const isDirectory = (stats.mode & constants.S_IFMT) === constants.S_IFDIR
  const permissions = isDirectory ? 'drwxr-xr-x' : '-rw-r--r--'
  const date = new Date(stats.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')
  return `${permissions} 1 verstak verstak ${String(stats.size).padStart(10)} ${date} ${name}`
}

/** Собирает список файлов папки с атрибутами. */
async function readEntries(directory: string, names: string[]): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  for (const name of names) {
    try {
      const stats = await fsLstat(resolve(directory, name))
      entries.push({ filename: name, longname: longName(stats, name), attrs: toAttributes(stats) })
    } catch {
      // Файл исчез между чтением каталога и проверкой — просто пропускаем.
    }
  }
  return entries
}

/** Открывает приватный ключ сервера, создавая его при первом запуске. */
function loadHostKey(): Buffer {
  if (existsSync(paths.sftpHostKey)) return readFileSync(paths.sftpHostKey)

  const { private: privateKey } = utils.generateKeyPairSync('ed25519')
  mkdirSync(dirname(paths.sftpHostKey), { recursive: true, mode: 0o700 })
  writeFileSync(paths.sftpHostKey, privateKey, { mode: 0o600 })
  return Buffer.from(privateKey)
}

/** Отпечаток ключа — по нему клиент проверяет, что сервер тот самый. */
export function hostKeyFingerprint(): string | null {
  try {
    const parsed = utils.parseKey(readFileSync(paths.sftpHostKey))
    if (parsed instanceof Error) return null
    // Формат как у OpenSSH: SHA256 от открытого ключа в base64 без выравнивания.
    const digest = createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
    return `SHA256:${digest}`
  } catch {
    return null
  }
}

type OpenFile = { kind: 'file'; fd: Awaited<ReturnType<typeof open>> }
type OpenDirectory = { kind: 'directory'; path: string; names: string[]; position: number }
type Handle = OpenFile | OpenDirectory

/** Обрабатывает одну SFTP-сессию: запросы клиента к реальной файловой системе. */
function handleSftpSession(stream: SFTPWrapper): void {
  const handles = new Map<number, Handle>()
  let nextHandle = 0

  const writable = (): boolean => getConfig().sftpWrite

  const makeHandle = (value: Handle): Buffer => {
    const id = nextHandle++
    handles.set(id, value)
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32BE(id, 0)
    return buffer
  }

  const handleId = (handle: Buffer): number => handle.readUInt32BE(0)
  const getHandle = (handle: Buffer): Handle | undefined => handles.get(handleId(handle))

  const replyError = (reqId: number, error: unknown): void => {
    if (error instanceof SftpError) {
      stream.status(reqId, error.code, error.message)
      return
    }
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') stream.status(reqId, STATUS_CODE.NO_SUCH_FILE)
    else if (code === 'EACCES' || code === 'EPERM') stream.status(reqId, STATUS_CODE.PERMISSION_DENIED)
    else stream.status(reqId, STATUS_CODE.FAILURE)
  }

  const isRootPath = (value: string): boolean => {
    const clean = posix.normalize(value.replace(/\\/g, '/'))
    return clean === '/' || clean === '.' || clean === ''
  }

  stream.on('OPEN', (reqId, filename, flags) => {
    void (async () => {
      try {
        const target = resolveVirtualPath(filename)
        if (!target) throw new SftpError(STATUS_CODE.NO_SUCH_FILE, 'Нет такого файла')

        const wantsWrite =
          (flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND | OPEN_MODE.TRUNC | OPEN_MODE.CREAT)) !== 0
        if (wantsWrite && !writable()) {
          throw new SftpError(STATUS_CODE.PERMISSION_DENIED, 'Доступ только на чтение')
        }

        await assertInsideProjects(target.real)
        const file = await open(target.real, 'r')
        stream.handle(reqId, makeHandle({ kind: 'file', fd: file }))
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('READ', (reqId, handle, offset, length) => {
    void (async () => {
      const entry = getHandle(handle)
      if (entry?.kind !== 'file') {
        stream.status(reqId, STATUS_CODE.FAILURE)
        return
      }
      const buffer = Buffer.alloc(length)
      try {
        const { bytesRead } = await entry.fd.read(buffer, 0, length, offset)
        if (bytesRead === 0) stream.status(reqId, STATUS_CODE.EOF)
        else stream.data(reqId, bytesRead === length ? buffer : buffer.subarray(0, bytesRead))
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('WRITE', (reqId) => {
    stream.status(reqId, writable() ? STATUS_CODE.OP_UNSUPPORTED : STATUS_CODE.PERMISSION_DENIED)
  })

  stream.on('FSTAT', (reqId, handle) => {
    void (async () => {
      const entry = getHandle(handle)
      if (entry?.kind !== 'file') {
        stream.status(reqId, STATUS_CODE.FAILURE)
        return
      }
      try {
        stream.attrs(reqId, toAttributes(await entry.fd.stat()))
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('CLOSE', (reqId, handle) => {
    void (async () => {
      const entry = getHandle(handle)
      handles.delete(handleId(handle))
      try {
        if (entry?.kind === 'file') await entry.fd.close()
        stream.status(reqId, STATUS_CODE.OK)
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('OPENDIR', (reqId, path) => {
    void (async () => {
      try {
        // Корень — не папка на диске, а список проектов.
        if (isRootPath(path)) {
          const names = listProjectRoots().map((root) => root.name)
          stream.handle(reqId, makeHandle({ kind: 'directory', path: '/', names, position: 0 }))
          return
        }

        const target = resolveVirtualPath(path)
        if (!target) throw new SftpError(STATUS_CODE.NO_SUCH_FILE, 'Нет такой папки')
        await assertInsideProjects(target.real)

        const stats = await fsStat(target.real)
        if (!stats.isDirectory()) throw new SftpError(STATUS_CODE.FAILURE, 'Это не папка')

        const names = await readdir(target.real)
        stream.handle(reqId, makeHandle({ kind: 'directory', path: target.real, names, position: 0 }))
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('READDIR', (reqId, handle) => {
    void (async () => {
      const entry = getHandle(handle)
      if (entry?.kind !== 'directory') {
        stream.status(reqId, STATUS_CODE.FAILURE)
        return
      }

      // Отдаём порциями: у большой папки ответ целиком не помещается в кадр.
      const batchSize = 32
      const slice = entry.names.slice(entry.position, entry.position + batchSize)
      entry.position += slice.length

      if (!slice.length) {
        stream.status(reqId, STATUS_CODE.EOF)
        return
      }

      try {
        if (entry.path === '/') {
          const roots = listProjectRoots()
          const entries: FileEntry[] = []
          for (const name of slice) {
            const root = roots.find((item) => item.name === name)
            if (!root) continue
            const stats = await fsStat(root.path)
            entries.push({ filename: name, longname: longName(stats, name), attrs: toAttributes(stats) })
          }
          stream.name(reqId, entries)
          return
        }

        stream.name(reqId, await readEntries(entry.path, slice))
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('STAT', (reqId, path) => {
    void (async () => {
      try {
        if (isRootPath(path)) {
          stream.attrs(reqId, { mode: constants.S_IFDIR | 0o755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 })
          return
        }
        const target = resolveVirtualPath(path)
        if (!target) throw new SftpError(STATUS_CODE.NO_SUCH_FILE, 'Нет такого файла')
        await assertInsideProjects(target.real)
        stream.attrs(reqId, toAttributes(await fsStat(target.real)))
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('LSTAT', (reqId, path) => {
    void (async () => {
      try {
        const target = resolveVirtualPath(path)
        if (!target) throw new SftpError(STATUS_CODE.NO_SUCH_FILE, 'Нет такого файла')
        await assertInsideProjects(target.real)
        stream.attrs(reqId, toAttributes(await fsLstat(target.real)))
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  stream.on('REALPATH', (reqId, path) => {
    void (async () => {
      try {
        const resolved = (() => {
          if (isRootPath(path)) return '/'
          // Файла может ещё не быть: клиенты так проверяют, куда ведёт путь.
          const target = resolveVirtualPath(path)
          if (!target) return null
          const suffix = target.real
            .slice(target.root.path.length)
            .split(sep)
            .filter(Boolean)
            .join('/')
          return `/${target.root.name}${suffix ? `/${suffix}` : ''}`
        })()

        if (!resolved) throw new SftpError(STATUS_CODE.NO_SUCH_FILE, 'Нет такого пути')

        // Ответ на REALPATH — это кадр NAME с одним элементом, а не отдельный
        // тип ответа: так устроен протокол.
        stream.name(reqId, [{ filename: resolved, longname: resolved, attrs: {} as Attributes }])
      } catch (error) {
        replyError(reqId, error)
      }
    })()
  })

  // Изменяющие операции: по умолчанию запрещены целиком.
  const denyWrite = (reqId: number): void => {
    stream.status(reqId, writable() ? STATUS_CODE.OP_UNSUPPORTED : STATUS_CODE.PERMISSION_DENIED)
  }

  stream.on('MKDIR', denyWrite)
  stream.on('RMDIR', denyWrite)
  stream.on('REMOVE', denyWrite)
  stream.on('RENAME', denyWrite)
  stream.on('SYMLINK', denyWrite)
  stream.on('SETSTAT', denyWrite)
  stream.on('FSETSTAT', denyWrite)
  // Расширения протокола не поддерживаем, но и не молчим: клиент ждёт ответ.
  stream.on('EXTENDED', (reqId) => stream.status(reqId, STATUS_CODE.OP_UNSUPPORTED))
}

/** Поднимает SFTP-сервер. Повторный вызов перезапускает его с новыми настройками. */
export async function startSftpServer(): Promise<{ port: number } | null> {
  await stopSftpServer()

  const config = getConfig()
  if (!config.sftpEnabled) return null

  const host = config.lanAccess ? '0.0.0.0' : config.hostname
  const ssh = new Server({ hostKeys: [loadHostKey()] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method !== 'password') {
        ctx.reject(['password'])
        return
      }

      const sameUser = ctx.username === getUsername()
      // Пароль сервера либо токен уже подключённого устройства: он есть у
      // телефона, и пароль вводить заново не нужно.
      const allowed =
        sameUser && (validateLogin(ctx.username, ctx.password) || Boolean(verifyClientToken(ctx.password)))
      if (allowed) ctx.accept()
      else ctx.reject()
    })

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('sftp', (acceptSftp) => handleSftpSession(acceptSftp()))
      })
    })

    // Разрыв связи — обычное дело, когда телефон уходит в спящий режим.
    client.on('error', () => undefined)
  })

  await new Promise<void>((done, fail) => {
    const onError = (error: Error): void => fail(error)
    ssh.once('error', onError)
    ssh.listen(config.sftpPort, host, () => {
      ssh.off('error', onError)
      done()
    })
  }).catch((error: unknown) => {
    throw new Error(`Не удалось запустить SFTP на порту ${config.sftpPort}: ${(error as Error).message}`)
  })

  server = ssh
  runningPort = config.sftpPort
  return { port: config.sftpPort }
}

export async function stopSftpServer(): Promise<void> {
  const current = server
  server = null
  runningPort = null
  if (!current) return
  await new Promise<void>((done) => current.close(() => done()))
}

export const sftpStatus = (): { running: boolean; port: number | null } => ({
  running: server !== null,
  port: runningPort,
})

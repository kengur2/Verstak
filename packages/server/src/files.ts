/**
 * Файлы проектов по HTTP.
 *
 * SFTP хорош для сторонних файловых менеджеров, но внутри самого приложения
 * удобнее обычные запросы: они работают и в браузере, и на телефоне, и не
 * требуют отдельного клиента.
 *
 * Правила доступа те же, что у SFTP: видно только папки проектов, выйти за их
 * пределы нельзя.
 */
import { readdir, stat as fsStat, realpath as fsRealpath } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { isInsideProjects, listProjectRoots, SftpError } from './sftp.ts'

export type ProjectDto = {
  name: string
  path: string
}

export type FileEntryDto = {
  name: string
  path: string
  kind: 'file' | 'directory'
  size: number
  modified: number
}

/** Список проектов для выбора в приложении. */
export const listProjects = (): ProjectDto[] =>
  listProjectRoots().map((root) => ({ name: root.name, path: root.path }))

/**
 * Проверяет, что файл или папку вообще можно отдавать.
 *
 * Символические ссылки разворачиваются: иначе ссылка внутри проекта увела бы
 * за его пределы.
 */
export async function ensureReadable(realPath: string): Promise<string> {
  const target = resolve(realPath)
  if (!isInsideProjects(target)) {
    throw new SftpError(3, 'Путь вне папок проектов')
  }

  let resolved = target
  try {
    resolved = await fsRealpath(target)
  } catch {
    throw new SftpError(2, 'Файл не найден')
  }

  if (!isInsideProjects(resolved)) {
    throw new SftpError(3, 'Ссылка ведёт вне папок проектов')
  }
  return resolved
}

/** Содержимое папки: сначала папки, потом файлы, по алфавиту. */
export async function listDirectory(realPath: string): Promise<FileEntryDto[]> {
  const target = await ensureReadable(realPath)
  const stats = await fsStat(target)
  if (!stats.isDirectory()) throw new SftpError(4, 'Это не папка')

  const names = await readdir(target)
  const entries: FileEntryDto[] = []

  for (const name of names) {
    const full = resolve(target, name)
    if (full !== target && !full.startsWith(target + sep)) continue
    try {
      const itemStats = await fsStat(full)
      entries.push({
        name,
        path: full,
        kind: itemStats.isDirectory() ? 'directory' : 'file',
        size: itemStats.size,
        modified: itemStats.mtimeMs,
      })
    } catch {
      // Файл исчез между чтением каталога и проверкой — пропускаем.
    }
  }

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'ru')
  })
}

/** Имя файла для заголовка `Content-Disposition`. */
export const downloadName = (realPath: string): string => basename(realPath)

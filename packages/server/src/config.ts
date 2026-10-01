/**
 * Конфигурация приложения: чтение, нормализация, атомарная запись.
 */
import { defaults, paths, type AppConfig, defaultConfig } from './paths.ts'
import { readYamlFile, writeYamlFile } from './yaml-store.ts'

let cached: AppConfig | null = null

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

const asPort = (value: unknown, fallback: number): number => {
  const port = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback
  return port
}

const asEntries = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

/** Приводит произвольный объект из YAML к валидному AppConfig. */
export function normalizeConfig(value: unknown): AppConfig {
  const base = defaultConfig()
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<AppConfig>

  return {
    port: asPort(raw.port, base.port),
    hostname: asString(raw.hostname, base.hostname),
    locale: asString(raw.locale, defaults.locale),
    lanAccess: raw.lanAccess === true,
    sftpEnabled: raw.sftpEnabled === true,
    sftpPort: asPort(raw.sftpPort, base.sftpPort),
    // Запись по SFTP по умолчанию запрещена: телефону файлы нужны на чтение.
    sftpWrite: raw.sftpWrite === true,
    opencodeBinaries: asEntries<AppConfig['opencodeBinaries'][number]>(raw.opencodeBinaries).filter(
      (entry) => typeof entry?.path === 'string' && entry.path.trim().length > 0,
    ),
    recentFolders: asEntries<AppConfig['recentFolders'][number]>(raw.recentFolders).filter(
      (entry) => typeof entry?.path === 'string' && entry.path.trim().length > 0,
    ),
  }
}

export function getConfig(): AppConfig {
  if (cached) return cached
  cached = normalizeConfig(readYamlFile(paths.configFile, defaultConfig()))
  return cached
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const next = normalizeConfig({ ...getConfig(), ...patch })
  writeYamlFile(paths.configFile, next)
  cached = next
  return next
}

/** Запоминает папку в списке недавних, поднимая её наверх. */
export function rememberFolder(folder: string, limit = 12): AppConfig {
  const current = getConfig()
  const rest = current.recentFolders.filter((entry) => entry.path !== folder)
  const recentFolders = [{ path: folder, lastAccessed: Date.now() }, ...rest].slice(0, limit)
  return updateConfig({ recentFolders })
}

/** Сбрасывает кэш — используется в тестах и после внешнего изменения файла. */
export function resetConfigCache(): void {
  cached = null
}
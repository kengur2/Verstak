/**
 * Пути конфигурации и хранилищ Verstak.
 *
 * Все данные лежат в каталоге XDG-конфига приложения, чтобы десктоп и мобильный
 * клиент работали с одним и тем же состоянием на одной машине.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
const xdgDataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')

export const APP_NAME = 'verstak'
export const APP_SLUG = 'verstak'

export const paths = {
  /** Корень конфигурации: ~/.config/verstak */
  configDir: join(xdgConfigHome, APP_SLUG),
  /** Конфиг приложения (настройки UI, порты, папки). */
  configFile: join(xdgConfigHome, APP_SLUG, 'config.yaml'),
  /** Хеш пароля входа, никогда не хранится открытым текстом. */
  authFile: join(xdgConfigHome, APP_SLUG, 'auth.yaml'),
  /** Каталог состояния: ~/.local/share/verstak */
  dataDir: join(xdgDataHome, APP_SLUG),
  /** Известные мобильные устройства и выданные им токены. */
  clientsFile: join(xdgDataHome, APP_SLUG, 'clients.yaml'),
  /** Одноразовые коды сопряжения (QR). */
  pairingsFile: join(xdgDataHome, APP_SLUG, 'pairings.yaml'),
  /** Расписание запланированных задач. */
  scheduleFile: join(xdgDataHome, APP_SLUG, 'schedule.yaml'),
  /** Приватный ключ SFTP-сервера (создаётся при первом запуске). */
  sftpHostKey: join(xdgConfigHome, APP_SLUG, 'sftp_host_key'),
  /** Встроенные веб-ресурсы (собранный Vite-бандл). */
  webDist: join(import.meta.dirname, '..', '..', 'web', 'dist'),
} as const

export const defaults = {
  /** Порт локального сервера. */
  port: 57311,
  /** Порт SFTP-доступа к файлам проектов. */
  sftpPort: 57312,
  /** Интерфейс по умолчанию — только петля; доступ из сети включается вручную. */
  hostname: '127.0.0.1',
  /** Русский — язык по умолчанию. */
  locale: 'ru',
  /** Время жизни одноразового кода сопряжения, мс. */
  pairingTtlMs: 10 * 60 * 1000,
  /** Время жизни токена мобильного клиента, мс (0 = бессрочно). */
  clientTtlMs: 0,
  /** Максимальный размер тела запроса, байт. */
  maxBodyBytes: 8 * 1024 * 1024,
  /** Предел предпросмотра текстового файла, байт. */
  maxPreviewBytes: 512 * 1024,
} as const

export type AppConfig = {
  port: number
  hostname: string
  locale: string
  /** Разрешить доступ из локальной сети (для телефона). */
  lanAccess: boolean
  /** Открывать ли проекты по SFTP. */
  sftpEnabled: boolean
  /** Порт SFTP. */
  sftpPort: number
  /** Разрешить по SFTP не только чтение, но и запись. */
  sftpWrite: boolean
  /** Несколько бинарников OpenCode на выбор. */
  opencodeBinaries: OpencodeBinary[]
  /** Недавно открытые папки. */
  recentFolders: RecentFolder[]
}

export type OpencodeBinary = {
  path: string
  version?: string
  label?: string
  lastUsed?: number
}

export type RecentFolder = {
  path: string
  lastAccessed?: number
}

export const defaultConfig = (): AppConfig => ({
  port: defaults.port,
  hostname: defaults.hostname,
  locale: defaults.locale,
  lanAccess: false,
  sftpEnabled: false,
  sftpPort: defaults.sftpPort,
  sftpWrite: false,
  opencodeBinaries: [],
  recentFolders: [],
})
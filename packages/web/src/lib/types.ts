/**
 * Типы данных по контракту OpenCode v2 и сервера Verstak.
 *
 * Имена полей повторяют OpenAPI-спецификацию OpenCode без изменений, чтобы
 * прокси не требовал преобразования на границе.
 */

export type ModelRef = {
  id: string
  providerID: string
  variant?: string
}

export type SessionInfo = {
  id: string
  parentID?: string | null
  projectID?: string
  title?: string | null
  agent?: string | null
  model?: ModelRef | null
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  } | null
  outcome?: string | null
  time?: { created?: number; updated?: number; idle?: number }
  location?: { directory?: string } | null
}

export type SessionPage = {
  data: SessionInfo[]
  cursor?: { previous?: string | null; next?: string | null } | null
}

export type ModelInfo = {
  id: string
  modelID?: string
  providerID: string
  name?: string
  enabled?: boolean
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null
}

export type ModelListResponse = {
  location?: { directory?: string }
  data: ModelInfo[]
}

export type AgentInfo = {
  id: string
  name?: string
  description?: string
  mode?: string
  hidden?: boolean
}

/** Часть сообщения. Поля соответствуют OpenCode API v2. */
export type MessagePart =
  | { type: 'text'; text?: string; id?: string }
  | { type: 'reasoning'; text?: string; id?: string }
  | {
      type: 'tool'
      id?: string
      name?: string
      executed?: boolean
      state?: { status?: string; input?: unknown; output?: unknown; error?: unknown }
    }
  | { type: string; [key: string]: unknown }

/**
 * Сообщение. В API v2 это плоская запись, и форма зависит от роли: у
 * пользовательских и системных текст лежит в `text`, у ответов ассистента —
 * в `content` (части: текст, рассуждение, вызов инструмента).
 */
export type MessageInfo = {
  id: string
  type: 'user' | 'assistant' | 'system'
  sessionID?: string
  time?: { created?: number; streamed?: number; completed?: number; updated?: number }
  /** Текст пользовательского или системного сообщения. */
  text?: string
  description?: string
  agent?: string
  model?: ModelRef | null
  content?: MessagePart[]
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  } | null
  cost?: number
  error?: { name?: string; data?: { message?: string } } | null
  summary?: boolean
}

export type MessageListResponse = {
  data: MessageInfo[]
  cursor?: { previous?: string | null; next?: string | null } | null
}

// --- ответы сервера Verstak ---

export type AppConfigDto = {
  port: number
  hostname: string
  locale: string
  lanAccess: boolean
  sftpEnabled: boolean
  sftpPort: number
  sftpWrite: boolean
  opencodeBinaries: { path: string; version?: string; label?: string; lastUsed?: number }[]
  recentFolders: { path: string; lastAccessed?: number }[]
}

export type InstanceDto = {
  id: string
  directory: string
  endpoint: { url: string; username: string; password: string } | null
  state: 'stopped' | 'starting' | 'ready' | 'error'
  error?: string
  lastUsedAt: number
}

export type ClientRecordDto = {
  id: string
  label: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
  deviceName?: string | null
  devicePlatform?: string | null
  expiresAt: number | null
}

export type PairingSessionDto = {
  id: string
  label?: string
  secret: string
  fingerprint?: string | null
  expiresAt: string
}

export type TaskSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekdays: number[]; time: string }
  | { kind: 'once'; at: string }

export type TaskDto = {
  id: string
  name: string
  prompt: string
  directory: string
  model?: string
  schedule: TaskSchedule
  enabled: boolean
  createdAt: number
  lastRunAt: number | null
  nextRunAt: number | null
}

/** Проект, доступный для просмотра файлов. */
export type ProjectDto = {
  name: string
  path: string
}

/** Запись в папке проекта. */
export type FileEntryDto = {
  name: string
  path: string
  kind: 'file' | 'directory'
  size: number
  modified: number
}

/** Состояние SFTP-доступа к файлам проектов. */
export type SftpInfoDto = {
  enabled: boolean
  running: boolean
  port: number
  write: boolean
  username: string
  fingerprint: string | null
  addresses: { url: string; kind: 'loopback' | 'lan'; interface: string }[]
  projects: string[]
}

/** Суммы по одному разрезу статистики. */
export type TokenTotalsDto = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type StatsBucketDto = {
  key: string
  sessions: number
  cost: number
  tokens: TokenTotalsDto
}

export type StatsSnapshotDto = {
  generatedAt: number
  days: number
  totals: StatsBucketDto
  projects: (StatsBucketDto & { directory: string })[]
  models: StatsBucketDto[]
  byDay: StatsBucketDto[]
  errors: string[]
}

/** Событие SSE-потока OpenCode. */
export type ServerEvent = {
  id?: string
  type: string
  data?: unknown
}
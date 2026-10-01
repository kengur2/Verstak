/**
 * Сводка использования OpenCode.
 *
 * Данные не собираются заново: OpenCode уже хранит по каждой сессии и токены,
 * и стоимость. Остаётся сложить их по проектам, моделям и дням.
 *
 * Считаем по тем проектам, что открывались в программе: у каждого свой набор
 * сессий, и складывать их в одну кучу без разделения смысла нет.
 *
 * Ответ кэшируется на несколько секунд: экран статистики можно открыть
 * несколько раз подряд, а обход всех проектов — это отдельный запрос к OpenCode
 * на каждый.
 */
import { getConfig } from './config.ts'
import { opencodeFetch } from './instances.ts'

/** Сколько сессий забирать на проект. */
const SESSION_LIMIT = 500
/** Время жизни кэша, мс. */
const CACHE_TTL_MS = 20_000

export type TokenTotals = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type StatsBucket = {
  /** Идентификатор: путь проекта, модель или дата. */
  key: string
  sessions: number
  cost: number
  tokens: TokenTotals
}

export type StatsSnapshot = {
  /** Когда посчитано. */
  generatedAt: number
  /** Окно в днях: 0 — без ограничения. */
  days: number
  totals: StatsBucket
  projects: (StatsBucket & { directory: string })[]
  models: StatsBucket[]
  byDay: StatsBucket[]
  /** Проекты, которые не удалось опросить, с причиной. */
  errors: string[]
}

type OpenCodeSession = {
  id?: string
  cost?: number
  model?: { id?: string; providerID?: string } | null
  time?: { created?: number }
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  } | null
}

const emptyTokens = (): TokenTotals => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })

const emptyBucket = (key: string): StatsBucket => ({ key, sessions: 0, cost: 0, tokens: emptyTokens() })

/** Добавляет сессию в набор и возвращает его же — так короче накапливать. */
const addToBucket = (bucket: StatsBucket, session: OpenCodeSession): StatsBucket => {
  bucket.sessions += 1
  bucket.cost += session.cost ?? 0
  bucket.tokens.input += session.tokens?.input ?? 0
  bucket.tokens.output += session.tokens?.output ?? 0
  bucket.tokens.reasoning += session.tokens?.reasoning ?? 0
  bucket.tokens.cacheRead += session.tokens?.cache?.read ?? 0
  bucket.tokens.cacheWrite += session.tokens?.cache?.write ?? 0
  return bucket
}

/** Местная дата в виде `2026-10-01`: так день совпадает с календарём пользователя. */
export const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const label = (session: OpenCodeSession): string => {
  if (!session.model?.id) return '—'
  return session.model.providerID ? `${session.model.providerID}/${session.model.id}` : session.model.id
}

const cache = new Map<number, { at: number; value: StatsSnapshot }>()

/** Собирает сводку по всем проектам. */
export async function collectStats(days: number): Promise<StatsSnapshot> {
  const cached = cache.get(days)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

  const config = getConfig()
  const since = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0

  const total = emptyBucket('totals')
  const projects: (StatsBucket & { directory: string })[] = []
  const models = new Map<string, StatsBucket>()
  const daysMap = new Map<string, StatsBucket>()
  const errors: string[] = []

  for (const folder of config.recentFolders) {
    const directory = folder.path
    const bucket = emptyBucket(directory)

    try {
      const query = new URLSearchParams({ limit: String(SESSION_LIMIT), directory })
      const response = await opencodeFetch(directory, `/api/session?${query.toString()}`)
      if (!response.ok) {
        errors.push(`${directory}: OpenCode ответил кодом ${response.status}`)
        continue
      }

      const payload = (await response.json()) as { data?: OpenCodeSession[] }
      for (const session of payload.data ?? []) {
        const created = session.time?.created ?? 0
        if (since && (!created || created < since)) continue

        addToBucket(bucket, session)
        addToBucket(total, session)

        const modelKey = label(session)
        const modelBucket = models.get(modelKey) ?? emptyBucket(modelKey)
        addToBucket(modelBucket, session)
        models.set(modelKey, modelBucket)

        if (created) {
          const key = dayKey(created)
          const dayBucket = daysMap.get(key) ?? emptyBucket(key)
          addToBucket(dayBucket, session)
          daysMap.set(key, dayBucket)
        }
      }

      projects.push({ ...bucket, directory })
    } catch (error) {
      errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Проекты без сессий в окне не показываем — иначе список пустой и шумный.
  const snapshot: StatsSnapshot = {
    generatedAt: Date.now(),
    days,
    totals: total,
    projects: projects.filter((item) => item.sessions > 0).sort((a, b) => b.cost - a.cost),
    models: [...models.values()].sort((a, b) => b.cost - a.cost),
    byDay: [...daysMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    errors,
  }

  cache.set(days, { at: Date.now(), value: snapshot })
  return snapshot
}

/** Сбрасывает кэш — после изменения списка проектов считаем заново. */
export const resetStatsCache = (): void => cache.clear()

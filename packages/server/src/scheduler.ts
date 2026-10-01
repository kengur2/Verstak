/**
 * Планировщик задач.
 *
 * Задача с промптом и расписанием запускается сама и создаёт сессию в указанной
 * папке. Хранение — YAML, без внешних зависимостей.
 */
import { paths } from './paths.ts'
import { readYamlFile, writeYamlFile } from './yaml-store.ts'
import { ensureInstance } from './instances.ts'

export type TaskSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekdays: number[]; time: string }
  | { kind: 'once'; at: string }

export type Task = {
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

type ScheduleFile = { tasks: Task[] }

const tasks = new Map<string, Task>()
let timer: NodeJS.Timeout | null = null
const running = new Set<string>()

/** Разбирает «чч:мм» в минуты с полуночи. */
const parseTime = (value: string): { hours: number; minutes: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

/** Вычисляет время следующего запуска. `from` — отсчётная точка. */
export function computeNextRun(
  schedule: TaskSchedule,
  from: number = Date.now(),
): number | null {
  const date = new Date(from)

  if (schedule.kind === 'interval') {
    const minutes = Math.max(1, Math.floor(schedule.everyMinutes))
    return from + minutes * 60_000
  }

  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.at)
    return Number.isNaN(at) || at <= from ? null : at
  }

  const time = parseTime(schedule.time)
  if (!time) return null
  const at = new Date(date)
  at.setHours(time.hours, time.minutes, 0, 0)

  if (schedule.kind === 'daily') {
    if (at.getTime() <= from) at.setDate(at.getDate() + 1)
    return at.getTime()
  }

  // weekly: 0 — воскресенье, 6 — суббота (как Date#getDay).
  const weekdays = schedule.weekdays.filter((day) => day >= 0 && day <= 6)
  if (!weekdays.length) return null
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(at)
    candidate.setDate(at.getDate() + offset)
    if (candidate.getTime() > from && weekdays.includes(candidate.getDay())) {
      return candidate.getTime()
    }
  }
  return null
}

function persist(): void {
  writeYamlFile(paths.scheduleFile, { tasks: [...tasks.values()] })
}

function load(): void {
  const stored = readYamlFile<ScheduleFile>(paths.scheduleFile, { tasks: [] })
  tasks.clear()
  for (const task of stored.tasks) {
    if (typeof task?.id !== 'string' || typeof task?.prompt !== 'string') continue
    const directory = typeof task.directory === 'string' ? task.directory : ''
    const schedule = task.schedule ?? { kind: 'interval', everyMinutes: 60 }
    tasks.set(task.id, {
      ...task,
      directory,
      schedule,
      enabled: task.enabled !== false,
      nextRunAt: task.enabled !== false ? computeNextRun(schedule) : null,
    })
  }
}

/** Создаёт задачу и сразу планирует её первый запуск. */
export function createTask(input: {
  name: string
  prompt: string
  directory: string
  schedule: TaskSchedule
  model?: string
}): Task {
  const now = Date.now()
  const task: Task = {
    id: `task_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: input.name.trim() || 'Задача',
    prompt: input.prompt,
    directory: input.directory,
    model: input.model,
    schedule: input.schedule,
    enabled: true,
    createdAt: now,
    lastRunAt: null,
    nextRunAt: computeNextRun(input.schedule, now),
  }
  tasks.set(task.id, task)
  persist()
  return task
}

export function listTasks(): Task[] {
  return [...tasks.values()].sort((a, b) => a.createdAt - b.createdAt)
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'name' | 'prompt' | 'enabled' | 'schedule' | 'model'>>,
): Task | null {
  const task = tasks.get(id)
  if (!task) return null
  const next: Task = { ...task, ...patch }
  next.nextRunAt = next.enabled ? computeNextRun(next.schedule) : null
  tasks.set(id, next)
  persist()
  return next
}

export function deleteTask(id: string): boolean {
  const removed = tasks.delete(id)
  if (removed) persist()
  return removed
}

/** Запускает задачу: поднимает OpenCode и отправляет промпт в новую сессию. */
async function runTask(task: Task): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const instance = await ensureInstance(task.directory)
  if (instance.state !== 'ready' || !instance.endpoint) {
    return { ok: false, error: instance.error ?? 'OpenCode недоступен' }
  }

  const session = await opencodeFetchJson(instance, '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `[${task.name}] ${new Date().toLocaleString('ru-RU')}`,
      ...(task.model ? { model: { providerID: 'opencode', id: task.model } } : {}),
    }),
  })
  if (!session.ok) return { ok: false, error: `Не удалось создать сессию: ${session.status}` }

  const created = (await session.json()) as { data?: { id?: string } }
  const sessionId = created.data?.id
  if (!sessionId) return { ok: false, error: 'OpenCode не вернул идентификатор сессии' }

  const prompt = await opencodeFetchJson(instance, `/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: task.prompt }),
  })
  if (!prompt.ok) return { ok: false, sessionId, error: `Промпт отклонён: ${prompt.status}` }

  return { ok: true, sessionId }
}

/** Отправляет JSON-запрос к OpenCode с basic-auth, как в API v2. */
async function opencodeFetchJson(
  instance: { endpoint: { url: string; username: string; password: string } | null },
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (!instance.endpoint) throw new Error('Нет подключения к OpenCode')
  const { url, username, password } = instance.endpoint
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
  const headers = new Headers(init.headers)
  headers.set('authorization', authorization)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(new URL(path, url), { ...init, headers })
}

const tick = async (): Promise<void> => {
  const now = Date.now()
  for (const task of listTasks()) {
    if (!task.enabled || task.nextRunAt === null || task.nextRunAt > now) continue
    // Пропускаем, если предыдущий запуск ещё идёт: один запуск на задачу.
    if (running.has(task.id)) continue

    running.add(task.id)
    try {
      const result = await runTask(task)
      const current = tasks.get(task.id)
      if (current) {
        current.lastRunAt = now
        current.nextRunAt = computeNextRun(current.schedule, now)
        persist()
      }
      if (!result.ok) {
        console.error(`Задача «${task.name}» не выполнена: ${result.error ?? 'неизвестная причина'}`)
      }
    } catch (error) {
      console.error(`Задача «${task.name}» упала:`, error)
    } finally {
      running.delete(task.id)
    }
  }
}

export const scheduler = {
  start(): void {
    if (timer) return
    load()
    // Раз в минуту достаточно: минимальная единица расписания — минута.
    timer = setInterval(() => void tick(), 60_000)
    timer.unref()
    void tick()
  },
  stop(): void {
    if (!timer) return
    clearInterval(timer)
    timer = null
  },
  list: listTasks,
  create: createTask,
  update: updateTask,
  remove: deleteTask,
  /** Принудительный запуск задачи, не дожидаясь расписания. */
  async runNow(id: string): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
    const task = tasks.get(id)
    if (!task) return { ok: false, error: 'Задача не найдена' }
    if (running.has(id)) return { ok: false, error: 'Задача уже выполняется' }
    running.add(id)
    try {
      return await runTask(task)
    } finally {
      running.delete(id)
    }
  },
}
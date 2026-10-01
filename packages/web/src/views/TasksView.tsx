/**
 * Задачи по расписанию: создание, запуск, пауза, удаление.
 */
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { apiFetch } from '../lib/api'
import { describeSchedule, formatDateTime } from '../lib/format'
import { IconClock, IconPlay, IconPlus, IconTrash } from '../lib/icons'
import type { TaskDto, TaskSchedule } from '../lib/types'

const emptyForm = (directory: string) => ({
  name: '',
  prompt: '',
  directory,
  kind: 'interval' as TaskSchedule['kind'],
  everyMinutes: 60,
  time: '09:00',
  at: new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
})

const scheduleFrom = (form: ReturnType<typeof emptyForm>): TaskSchedule => {
  if (form.kind === 'interval') return { kind: 'interval', everyMinutes: Math.max(1, form.everyMinutes) }
  if (form.kind === 'daily') return { kind: 'daily', time: form.time }
  if (form.kind === 'weekly') return { kind: 'weekly', weekdays: [1, 2, 3, 4, 5], time: form.time }
  return { kind: 'once', at: new Date(form.at).toISOString() }
}

export const TasksView = ({
  folders,
  initialTasks,
}: {
  folders: { path: string }[]
  initialTasks: TaskDto[]
}) => {
  const { t, locale } = useI18n()
  const [tasks, setTasks] = useState<TaskDto[]>(initialTasks)
  const [form, setForm] = useState(() => emptyForm(folders[0]?.path ?? ''))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const response = await apiFetch<{ tasks: TaskDto[] }>('/api/tasks')
      setTasks(response.tasks ?? [])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    }
  }, [t])

  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  useEffect(() => {
    if (!form.directory && folders[0]) setForm((current) => ({ ...current, directory: folders[0]!.path }))
  }, [folders, form.directory])

  const create = async () => {
    setError(null)
    if (!form.prompt.trim() || !form.directory) {
      setError(t('tasks.prompt'))
      return
    }
    setBusy(true)
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          prompt: form.prompt,
          directory: form.directory,
          schedule: scheduleFrom(form),
        }),
      })
      setForm(emptyForm(form.directory))
      setOpen(false)
      await reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const runNow = async (id: string) => {
    setBusy(true)
    try {
      await apiFetch(`/api/tasks/${encodeURIComponent(id)}/run`, { method: 'POST' })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (task: TaskDto) => {
    setBusy(true)
    try {
      await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content">
      <div className="pad">
        <div className="card">
          <div className="card-title">
            <IconClock size={17} />
            {t('tasks.title')}
            <div className="spacer" />
            <button className="btn primary" onClick={() => setOpen((value) => !value)}>
              <IconPlus size={16} />
              {t('action.newTask')}
            </button>
          </div>

        {open && (
          <>
            <div className="field">
              <span>{t('tasks.name')}</span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder={t('tasks.name')}
              />
            </div>
            <div className="field">
              <span>{t('tasks.prompt')}</span>
              <textarea
                value={form.prompt}
                onChange={(event) => setForm({ ...form, prompt: event.target.value })}
              />
            </div>
            <div className="field">
              <span>{t('tasks.folder')}</span>
              <select
                value={form.directory}
                onChange={(event) => setForm({ ...form, directory: event.target.value })}
              >
                {folders.map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>{t('tasks.schedule')}</span>
              <div className="row">
                <select
                  value={form.kind}
                  onChange={(event) => setForm({ ...form, kind: event.target.value as TaskSchedule['kind'] })}
                >
                  <option value="interval">{t('tasks.schedule.interval')}</option>
                  <option value="daily">{t('tasks.schedule.daily')}</option>
                  <option value="weekly">{t('tasks.schedule.weekly')}</option>
                  <option value="once">{t('tasks.schedule.once')}</option>
                </select>
                {form.kind === 'interval' && (
                  <input
                    type="number"
                    min={1}
                    value={form.everyMinutes}
                    onChange={(event) => setForm({ ...form, everyMinutes: Number(event.target.value) })}
                    style={{ width: 100 }}
                  />
                )}
                {(form.kind === 'daily' || form.kind === 'weekly') && (
                  <input
                    type="time"
                    value={form.time}
                    onChange={(event) => setForm({ ...form, time: event.target.value })}
                  />
                )}
                {form.kind === 'once' && (
                  <input
                    type="datetime-local"
                    value={form.at}
                    onChange={(event) => setForm({ ...form, at: event.target.value })}
                  />
                )}
              </div>
            </div>
            <div className="row">
              <button className="btn primary" onClick={create} disabled={busy}>
                {t('action.save')}
              </button>
              <button className="btn ghost" onClick={() => setOpen(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </>
        )}

            {error && <div className="banner danger">{error}</div>}
          </div>

          <div className="card">
            {tasks.length === 0 ? (
              <div className="empty">{t('tasks.empty')}</div>
            ) : (
              <ul className="list">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <div className="row" style={{ padding: '9px 11px' }}>
                      <span className="truncate" style={{ flex: 1, minWidth: 160 }}>
                        {task.name}
                        <span className="path"> {describeSchedule(task.schedule, t as never, locale)}</span>
                      </span>
                      <span className={`pill ${task.enabled ? 'ready' : ''}`}>
                        {task.enabled ? t('tasks.enabled') : t('tasks.disabled')}
                      </span>
                      <span className="muted" style={{ minWidth: 150 }}>
                        {t('tasks.nextRun')}: {formatDateTime(task.nextRunAt, locale)}
                      </span>
                      <button className="btn" onClick={() => runNow(task.id)} disabled={busy}>
                        <IconPlay size={15} />
                        {t('tasks.runNow')}
                      </button>
                      <button className="btn ghost" onClick={() => toggle(task)} disabled={busy}>
                        {task.enabled ? t('action.stop') : t('action.run')}
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => remove(task.id)}
                        disabled={busy}
                        title={t('action.delete')}
                        aria-label={t('action.delete')}
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                    <div className="path" style={{ padding: '0 11px 9px' }}>
                      {t('tasks.lastRun')}:{' '}
                      {task.lastRunAt ? formatDateTime(task.lastRunAt, locale) : t('tasks.never')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
  )
}
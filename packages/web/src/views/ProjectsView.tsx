/**
 * Проекты: список папок, добавление новой, состояние экземпляров OpenCode.
 */
import { useState } from 'react'
import { useI18n } from '../i18n'
import { apiFetch, encodeWorkspace } from '../lib/api'
import { basename } from '../lib/format'
import { IconFolder, IconPlus, IconStop } from '../lib/icons'
import type { InstanceDto } from '../lib/types'

const stateLabel = (state: InstanceDto['state'], t: (key: never) => string): string => {
  const key = `projects.instanceState.${state}` as never
  return t(key)
}

export const ProjectsView = ({
  folders,
  instances,
  activeFolder,
  onSelect,
  onChanged,
}: {
  folders: { path: string; lastAccessed?: number }[]
  instances: InstanceDto[]
  activeFolder: string | null
  onSelect: (folder: string) => void
  onChanged: () => void
}) => {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const instanceFor = (folder: string): InstanceDto | undefined =>
    instances.find((instance) => instance.directory === folder)

  const addFolder = async () => {
    const trimmed = path.trim()
    if (!trimmed.startsWith('/')) {
      setError(t('projects.pathPlaceholder'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Запрос поднимает службу OpenCode для папки и проверяет, что путь рабочий.
      await apiFetch(`/api/workspaces/${encodeWorkspace(trimmed)}`, { method: 'GET' })
      setPath('')
      setAdding(false)
      onChanged()
      onSelect(trimmed)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const stopInstance = async (folder: string) => {
    setBusy(true)
    try {
      await apiFetch(`/api/workspaces/${encodeWorkspace(folder)}`, { method: 'DELETE' })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content">
      <div className="pad">
        <div className="card">
          <div className="card-title">
            <IconFolder size={17} />
            {t('projects.instances')}
            <div className="spacer" />
            <button className="btn primary" onClick={() => setAdding((value) => !value)}>
              <IconPlus size={16} />
              {t('action.newProject')}
            </button>
          </div>

          {adding && (
            <div className="row">
              <input
                className="truncate"
                style={{ flex: 1, minWidth: 200 }}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={t('projects.pathPlaceholder')}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addFolder()
                }}
              />
              <button className="btn primary" onClick={addFolder} disabled={busy}>
                {t('action.save')}
              </button>
              <button className="btn ghost" onClick={() => setAdding(false)}>
                {t('action.cancel')}
              </button>
            </div>
          )}

          {error && <div className="banner danger">{error}</div>}

          {folders.length === 0 ? (
            <div className="empty">{t('projects.empty')}</div>
          ) : (
            <ul className="list">
              {folders.map((folder) => {
                const instance = instanceFor(folder.path)
                const state = instance?.state ?? 'stopped'
                const dotClass =
                  state === 'ready' ? 'ready' : state === 'starting' ? 'busy' : state === 'error' ? 'error' : ''
                return (
                  <li key={folder.path} data-active={activeFolder === folder.path}>
                    <div className="row" style={{ padding: '7px 9px' }}>
                      <button
                        className="item"
                        style={{ flex: 1, textAlign: 'left' }}
                        onClick={() => onSelect(folder.path)}
                      >
                        <span className={`dot ${dotClass}`} />
                        <span className="item-main">
                          <span className="truncate">{basename(folder.path)}</span>
                          <span className="path truncate">{folder.path}</span>
                        </span>
                      </button>
                      <span
                        className={`pill ${
                          state === 'ready' ? 'ready' : state === 'error' ? 'error' : state === 'starting' ? 'warn' : ''
                        }`}
                      >
                        {stateLabel(state, t as never)}
                      </span>
                      {state === 'ready' && (
                        <button
                          className="icon-btn"
                          onClick={() => void stopInstance(folder.path)}
                          disabled={busy}
                          title={t('projects.stopInstance')}
                          aria-label={t('projects.stopInstance')}
                        >
                          <IconStop size={15} />
                        </button>
                      )}
                    </div>
                    {instance?.error && <div className="path" style={{ padding: '0 11px 8px' }}>{instance.error}</div>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
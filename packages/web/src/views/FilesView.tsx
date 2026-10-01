/**
 * Файлы проектов.
 *
 * Экран решает две задачи: посмотреть, что лежит в проекте, и забрать файл на
 * телефон. На телефоне файл сохраняется через плагины Capacitor, в браузере —
 * обычным скачиванием; разница спрятана в `lib/download`.
 *
 * Видны только папки проектов: сервер не отдаёт ничего за их пределами.
 */
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { apiFetch, readToken } from '../lib/api'
import { saveFile } from '../lib/download'
import { formatDateTime } from '../lib/format'
import { IconChevron, IconClose, IconDownload, IconFile, IconFolder } from '../lib/icons'
import { apiUrl } from '../lib/server'
import type { FileEntryDto, ProjectDto } from '../lib/types'

/** Размер файла в удобных единицах. */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

/** Один шаг пути: имя папки и её полный путь. */
type Crumb = { name: string; path: string }

export const FilesView = ({ onNotice }: { onNotice: (message: string) => void }) => {
  const { t, locale } = useI18n()
  const [projects, setProjects] = useState<ProjectDto[]>([])
  const [trail, setTrail] = useState<Crumb[]>([])
  const [entries, setEntries] = useState<FileEntryDto[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null)

  const current = trail.length ? trail[trail.length - 1]! : null

  const load = useCallback(
    async (path: string, nextTrail: Crumb[]) => {
      setBusy(true)
      setError(null)
      try {
        const response = await apiFetch<{ entries: FileEntryDto[] }>(
          `/api/files/list?path=${encodeURIComponent(path)}`,
        )
        setEntries(response.entries ?? [])
        setTrail(nextTrail)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t('common.error'))
      } finally {
        setBusy(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch<{ projects: ProjectDto[] }>('/api/files/projects')
        setProjects(response.projects ?? [])
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t('common.error'))
      }
    })()
  }, [t])

  const openProject = (project: ProjectDto) =>
    void load(project.path, [{ name: project.name, path: project.path }])

  const enter = (entry: FileEntryDto) =>
    void load(entry.path, [...trail, { name: entry.name, path: entry.path }])

  /** Возврат на шаг вверх: к папке или к списку проектов. */
  const goTo = (index: number) => {
    if (index < 0) {
      setTrail([])
      setEntries([])
      return
    }
    const target = trail[index]
    if (!target) return
    if (index === 0) {
      void load(target.path, [target])
      return
    }
    void load(target.path, trail.slice(0, index + 1))
  }

  /** Забирает файл на телефон: в браузере — скачивание, в приложении — сохранение. */
  const download = async (entry: FileEntryDto) => {
    setBusy(true)
    setError(null)
    try {
      const result = await saveFile(
        apiUrl(`/api/files/download?path=${encodeURIComponent(entry.path)}`),
        entry.name,
        readToken(),
      )
      if (result === 'saved') onNotice(t('files.savedToDocuments'))
      else if (result === 'shared') onNotice(t('files.shared'))
      else onNotice(t('files.downloaded'))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const showPreview = async (entry: FileEntryDto) => {
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch<{ content: string }>(
        `/api/files/text?path=${encodeURIComponent(entry.path)}`,
      )
      setPreview({ name: entry.name, content: response.content })
    } catch {
      // Большие и нетекстовые файлы сервер целиком не отдаёт — предлагаем скачать.
      setError(t('files.tooBig'))
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
            {t('files.title')}
            <div className="spacer" />
            {trail.length > 0 && (
              <button className="btn" onClick={() => goTo(trail.length - 2)} disabled={busy}>
                <IconChevron size={15} className="flip" />
                {t('files.up')}
              </button>
            )}
          </div>

          {projects.length === 0 ? (
            <div className="empty">{t('files.noProjects')}</div>
          ) : (
            <>
              {trail.length > 0 && (
                <nav className="crumb">
                  <button className="crumb-link" onClick={() => goTo(-1)}>
                    {t('files.title')}
                  </button>
                  {trail.map((step, index) => (
                    <span className="crumb-step" key={step.path}>
                      <IconChevron size={13} />
                      {index === trail.length - 1 ? (
                        <span className="crumb-current">{step.name}</span>
                      ) : (
                        <button className="crumb-link" onClick={() => goTo(index)}>
                          {step.name}
                        </button>
                      )}
                    </span>
                  ))}
                </nav>
              )}

              {trail.length === 0 && (
                <ul className="list">
                  {projects.map((project) => (
                    <li key={project.path}>
                      <button className="item" onClick={() => openProject(project)}>
                        <IconFolder size={16} className="nav-icon" />
                        <span className="item-main">
                          <span className="truncate">{project.name}</span>
                          <span className="path truncate">{project.path}</span>
                        </span>
                        <IconChevron size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {trail.length > 0 && entries.length === 0 && !busy && (
                <div className="empty">{t('files.empty')}</div>
              )}

              {trail.length > 0 && entries.length > 0 && (
                <ul className="list">
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      {entry.kind === 'directory' ? (
                        <button className="item" onClick={() => enter(entry)}>
                          <IconFolder size={16} className="nav-icon" />
                          <span className="truncate">{entry.name}</span>
                          <IconChevron size={15} />
                        </button>
                      ) : (
                        <div className="row" style={{ padding: '8px 11px' }}>
                          <span className="file-icon">
                            <IconFile size={15} />
                          </span>
                          <span className="item-main" style={{ flex: 1, minWidth: 0 }}>
                            <span className="truncate">{entry.name}</span>
                            <span className="item-sub">
                              {formatSize(entry.size)} · {formatDateTime(entry.modified, locale)}
                            </span>
                          </span>
                          <button className="btn ghost" onClick={() => void showPreview(entry)} disabled={busy}>
                            {t('files.preview')}
                          </button>
                          <button className="btn primary" onClick={() => void download(entry)} disabled={busy}>
                            <IconDownload size={15} />
                            {t('files.download')}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {busy && <span className="muted">{t('common.loading')}</span>}
          {error && <div className="banner danger">{error}</div>}
        </div>
      </div>

      {preview && (
        <div className="modal" role="dialog">
          <div className="modal-card">
            <div className="card-title">
              <IconFile size={16} />
              <span className="truncate">{preview.name}</span>
              <div className="spacer" />
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label={t('files.closePreview')}>
                <IconClose size={16} />
              </button>
            </div>
            <pre className="preview">{preview.content}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

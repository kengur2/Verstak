/**
 * Статистика использования.
 *
 * Показывает то, что уже знает OpenCode: сколько было сессий, сколько токенов
 * ушло и сколько это стоило. Данные не собираются отдельно, поэтому история
 * начинается не с момента включения программы, а с самих сессий.
 *
 * Разрезы: по проектам, по моделям и по дням. Дни рисуются столбиками —
 * для этого хватает обычных блоков, отдельная библиотека графиков не нужна.
 */
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { apiFetch } from '../lib/api'
import { basename, formatCost, formatDateTime, formatTokens } from '../lib/format'
import { IconChart, IconRefresh } from '../lib/icons'
import type { StatsBucketDto, StatsSnapshotDto } from '../lib/types'

type Period = { id: string; days: number }

/** Стоимость показываем точнее, чем в ленте: тут суммы за период. */
const money = (value: number): string => (value > 0 ? formatCost(value) : '—')

/** Токены в коротком виде: миллионы и тысячи читаются плохо в таблице. */
const tokens = (bucket: StatsBucketDto): number =>
  bucket.tokens.input + bucket.tokens.output + bucket.tokens.reasoning

export const StatsView = () => {
  const { t, locale } = useI18n()
  const [days, setDays] = useState(7)
  const [snapshot, setSnapshot] = useState<StatsSnapshotDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const periods: Period[] = [
    { id: 'stats.period.day', days: 1 },
    { id: 'stats.period.week', days: 7 },
    { id: 'stats.period.month', days: 30 },
    { id: 'stats.period.all', days: 0 },
  ]

  const load = useCallback(
    async (period: number) => {
      setBusy(true)
      setError(null)
      try {
        const response = await apiFetch<StatsSnapshotDto>(`/api/stats?days=${period}`)
        setSnapshot(response)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t('common.error'))
      } finally {
        setBusy(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void load(days)
  }, [days, load])

  // Столбики дней: высота считается от самого крупного дня в выборке.
  const peak = Math.max(1, ...(snapshot?.byDay ?? []).map((day) => tokens(day)))

  return (
    <div className="content">
      <div className="pad">
        <div className="card">
          <div className="card-title">
            <IconChart size={17} />
            {t('stats.title')}
            <div className="spacer" />
            <button className="btn" onClick={() => void load(days)} disabled={busy}>
              <IconRefresh size={15} />
              {t('stats.refresh')}
            </button>
          </div>
          <p className="muted">{t('stats.subtitle')}</p>

          <div className="segmented" role="group" aria-label={t('stats.period')}>
            {periods.map((period) => (
              <button key={period.days} aria-pressed={days === period.days} onClick={() => setDays(period.days)}>
                {t(period.id as never)}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="banner danger">{error}</div>}

        {snapshot && (
          <>
            <div className="stat-grid">
              <div className="stat">
                <span className="stat-label">{t('stats.sessions')}</span>
                <span className="stat-value">{snapshot.totals.sessions}</span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('stats.tokens')}</span>
                <span className="stat-value">{formatTokens(tokens(snapshot.totals))}</span>
                <span className="stat-hint">
                  {t('stats.input')} {formatTokens(snapshot.totals.tokens.input)} ·{' '}
                  {t('stats.output')} {formatTokens(snapshot.totals.tokens.output)} ·{' '}
                  {t('stats.reasoning')} {formatTokens(snapshot.totals.tokens.reasoning)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('stats.cost')}</span>
                <span className="stat-value">{money(snapshot.totals.cost)}</span>
                <span className="stat-hint">
                  {t('stats.cache')} {formatTokens(snapshot.totals.tokens.cacheRead)}
                </span>
              </div>
            </div>

            {snapshot.byDay.length > 1 && (
              <div className="card">
                <div className="card-title">{t('stats.byDay')}</div>
                <div className="bars">
                  {snapshot.byDay.map((day) => (
                    <div className="bar" key={day.key} title={`${day.key}: ${formatTokens(tokens(day))}, ${money(day.cost)}`}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ height: `${Math.max(4, (tokens(day) / peak) * 100)}%` }} />
                      </div>
                      <span className="bar-label">{day.key.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-title">{t('stats.byProject')}</div>
              {snapshot.projects.length === 0 ? (
                <div className="empty">{t('stats.empty')}</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('stats.project')}</th>
                      <th>{t('stats.sessions')}</th>
                      <th>{t('stats.tokens')}</th>
                      <th>{t('stats.cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.projects.map((project) => (
                      <tr key={project.directory}>
                        <td>
                          <div className="cell-main">
                            <span className="truncate">{basename(project.directory)}</span>
                            <span className="path truncate">{project.directory}</span>
                          </div>
                        </td>
                        <td>{project.sessions}</td>
                        <td>{formatTokens(tokens(project))}</td>
                        <td>{money(project.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="card-title">{t('stats.byModel')}</div>
              {snapshot.models.length === 0 ? (
                <div className="empty">{t('stats.empty')}</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('stats.model')}</th>
                      <th>{t('stats.sessions')}</th>
                      <th>{t('stats.tokens')}</th>
                      <th>{t('stats.cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.models.map((model) => (
                      <tr key={model.key}>
                        <td className="truncate">{model.key}</td>
                        <td>{model.sessions}</td>
                        <td>{formatTokens(tokens(model))}</td>
                        <td>{money(model.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {snapshot.errors.length > 0 && (
              <div className="banner">
                <div>
                  <div>{t('stats.errors')}</div>
                  {snapshot.errors.map((message) => (
                    <div className="path" key={message}>
                      {message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="muted">
              {t('stats.note')} {t('stats.updated')}: {formatDateTime(snapshot.generatedAt, locale)}
            </p>
          </>
        )}

        {!snapshot && !busy && !error && <div className="empty">{t('stats.noData')}</div>}
      </div>
    </div>
  )
}

/**
 * Вспомогательные функции форматирования: время, числа, пути.
 */

export const formatDateTime = (value: number | null | undefined, locale = 'ru-RU'): string => {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export const formatRelative = (value: number | null | undefined, locale = 'ru-RU'): string => {
  if (!value) return '—'
  const delta = Date.now() - value
  const abs = Math.abs(delta)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 1000],
    ['minute', 60_000],
    ['hour', 3_600_000],
    ['day', 86_400_000],
  ]

  let unit: Intl.RelativeTimeFormatUnit = 'second'
  let divisor = 1000
  for (const [name, size] of units) {
    if (abs >= size) {
      unit = name
      divisor = size
    }
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(-delta / divisor),
    unit,
  )
}

export const formatTokens = (value: number | undefined | null): string => {
  if (!value) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export const formatCost = (value: number | undefined | null): string => {
  if (!value) return '$0.00'
  return `$${value.toFixed(4)}`
}

/** Имя папки проекта для показа в списке. */
export const basename = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  const parts = trimmed.split('/')
  return parts[parts.length - 1] || trimmed
}

/**
 * Расписание задачи одной строкой.
 *
 * Названия дней недели берутся из `Intl`, а сам текст — из словаря: иначе
 * русская строка осталась бы и в английском интерфейсе.
 */
export const describeSchedule = (
  schedule: { kind: string; everyMinutes?: number; time?: string; weekdays?: number[] },
  t: (key: never, params?: Record<string, string | number>) => string,
  locale: string,
): string => {
  if (schedule.kind === 'interval') {
    const minutes = schedule.everyMinutes ?? 0
    if (minutes < 60) return t('tasks.schedule.intervalShort' as never, { minutes })
    const hours = Math.round((minutes / 60) * 10) / 10
    return t('tasks.schedule.intervalHours' as never, { hours })
  }

  if (schedule.kind === 'daily') {
    return t('tasks.schedule.dailyShort' as never, { time: schedule.time ?? '' })
  }

  if (schedule.kind === 'weekly') {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    // 2024-01-07 — воскресенье, поэтому день недели совпадает с индексом.
    const days = (schedule.weekdays ?? [])
      .map((day) => formatter.format(new Date(2024, 0, 7 + day)))
      .join(', ')
    return t('tasks.schedule.weeklyShort' as never, { days, time: schedule.time ?? '' })
  }

  return t('tasks.schedule.onceShort' as never)
}
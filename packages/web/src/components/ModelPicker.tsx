/**
 * Выбиратель модели.
 *
 * У OpenCode бывают сотни моделей, и обычный `select` с таким списком
 * неудобен: нужен поиск и компактный выпадающий список. Компонент сам
 * закрывается по щелчку вне области и показывает провайдера каждой модели.
 */
import { useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { IconChevron } from '../lib/icons'
import type { ModelInfo } from '../lib/types'

const MAX_VISIBLE = 200

export const ModelPicker = ({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[]
  value: string
  onChange: (id: string) => void
}) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = models.find((model) => model.id === value)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return models
    return models.filter((model) => {
      const name = (model.name ?? model.id).toLowerCase()
      return name.includes(needle) || model.providerID.toLowerCase().includes(needle)
    })
  }, [models, query])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="picker" ref={containerRef}>
      <button
        className="btn picker-trigger"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{selected ? (selected.name ?? selected.id) : t('models.pick')}</span>
        <IconChevron size={14} className={open ? 'rotate-90' : 'rotate-90 open'} />
      </button>

      {open && (
        <>
          {/* Затемнение ловит щелчок вне списка и закрывает его. */}
          <div className="picker-backdrop" onClick={close} />
          <div className="picker-pop" role="listbox">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('models.search')}
              autoFocus
            />
            <ul className="picker-list">
              <li>
                <button
                  className="picker-option"
                  aria-current={value === ''}
                  onClick={() => {
                    onChange('')
                    close()
                  }}
                >
                  <span className="truncate">{t('models.default')}</span>
                </button>
              </li>
              {filtered.slice(0, MAX_VISIBLE).map((model) => (
                <li key={model.id}>
                  <button
                    className="picker-option"
                    aria-current={model.id === value}
                    onClick={() => {
                      onChange(model.id)
                      close()
                    }}
                  >
                    <span className="truncate">{model.name ?? model.id}</span>
                    <span className="item-sub">{model.providerID}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="picker-empty">{t('models.nothingFound')}</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

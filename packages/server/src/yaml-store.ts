/**
 * Чтение и запись YAML-конфигурации.
 *
 * Формат YAML выбран ради правки конфига руками: он читается без инструментов,
 * а комментарии в нём сохраняются.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse, stringify } from 'yaml'

/** Читает YAML-файл. Отсутствующий или повреждённый файл даёт `fallback`. */
export function readYamlFile<T>(file: string, fallback: T): T {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return fallback
  }
  try {
    const parsed = parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(fallback as object), ...(parsed as object) } as T
    }
    return fallback
  } catch {
    return fallback
  }
}

/**
 * Пишет YAML атомарно: сначала во временный файл рядом, затем переименование.
 * Так внезапная остановка процесса не оставит обрезанный конфиг.
 */
export function writeYamlFile(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  writeFileSync(temp, stringify(value, { indent: 2 }), 'utf8')
  renameSync(temp, file)
}
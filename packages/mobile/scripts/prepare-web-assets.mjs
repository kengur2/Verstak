/**
 * Готовит веб-сборку для мобильного приложения.
 *
 * Приложение переиспользует тот же интерфейс, что и браузер, поэтому здесь
 * ничего не собирается — только копируется готовая сборка пакета `web`.
 * Благодаря этому экраны, оформление и логика в приложении и в браузере
 * не расходятся.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDist = path.resolve(mobileRoot, '../web/dist')
const mobileDist = path.resolve(mobileRoot, 'dist')

const exists = async (target) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

if (!(await exists(webDist))) {
  console.error('Не найдена сборка веб-интерфейса. Сначала выполните: npm run build:web')
  process.exit(1)
}

await rm(mobileDist, { recursive: true, force: true })
await mkdir(mobileDist, { recursive: true })
await cp(webDist, mobileDist, { recursive: true })

console.log(`Веб-интерфейс скопирован: ${path.relative(mobileRoot, mobileDist)}`)

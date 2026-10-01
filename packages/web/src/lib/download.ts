/**
 * Сохранение файла на телефон.
 *
 * В браузере файл просто скачивается обычной ссылкой. В приложении этого мало:
 * нужно положить файл туда, где его видно, поэтому используются плагины
 * Capacitor — файловая система и системное «Поделиться».
 *
 * Порядок такой: сначала пытаемся записать в общую папку «Документы», а если
 * система не разрешает — кладём во внутренний кэш и открываем окно «Поделиться»,
 * откуда файл можно отправить куда угодно.
 */
import { isNativePlatform } from './server'

export type SaveResult = 'saved' | 'shared' | 'downloaded'

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader()
    reader.onerror = () => rejectPromise(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      const result = String(reader.result)
      // FileReader отдаёт data:URL — плагину нужна только часть с данными.
      const comma = result.indexOf(',')
      resolvePromise(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })

/**
 * Скачивает файл с сервера и сохраняет его на устройстве.
 *
 * `url` должен вести на сервер Verstak: запрос идёт с токеном устройства,
 * иначе сервер ответит отказом.
 */
export const saveFile = async (
  url: string,
  name: string,
  token: string | null,
): Promise<SaveResult> => {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)

  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Сервер ответил кодом ${response.status}`)
  const blob = await response.blob()

  if (!isNativePlatform()) {
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
    return 'downloaded'
  }

  const { Directory, Filesystem } = await import('@capacitor/filesystem')
  const data = await blobToBase64(blob)

  try {
    // Общая папка «Документы»: файл потом видно в файловом менеджере.
    await Filesystem.writeFile({ path: name, data, directory: Directory.Documents, recursive: true })
    return 'saved'
  } catch {
    // Система не разрешила записать в общую папку — сохраняем во внутреннюю и
    // предлагаем отправить файл через системное окно.
    const { uri } = await Filesystem.writeFile({
      path: name,
      data,
      directory: Directory.Cache,
      recursive: true,
    })
    const { Share } = await import('@capacitor/share')
    await Share.share({ title: name, url: uri })
    return 'shared'
  }
}

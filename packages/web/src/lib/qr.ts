/**
 * Сканирование кода сопряжения камерой телефона.
 *
 * Плагин подключается динамически: в браузере его нет и он не нужен, а в
 * мобильном приложении он есть. Поэтому любая неудача — не ошибка, а просто
 * «отсканировать не получилось»: рядом всегда остаётся ручной ввод кода.
 */
import { isNativePlatform } from './server'

export const scanPairingCode = async (): Promise<string | null> => {
  if (!isNativePlatform()) return null

  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')

    const supported = await BarcodeScanner.isSupported()
    if (!supported.supported) return null

    const permission = await BarcodeScanner.requestPermissions()
    if (permission.camera !== 'granted' && permission.camera !== 'limited') return null

    const { barcodes } = await BarcodeScanner.scan()
    return barcodes[0]?.rawValue ?? null
  } catch {
    // Плагин недоступен или пользователь закрыл камеру — это не ошибка.
    return null
  }
}

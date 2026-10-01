/**
 * QR-код с адресом и кодом сопряжения.
 *
 * Телефон наводит камеру и подключается сам: в коде лежит обычная ссылка
 * `http://адрес:порт/?pair=КОД`. Она же открывается в браузере телефона, так
 * что один код подходит и приложению, и браузеру.
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export const QrCode = ({ value, size = 168 }: { value: string; size?: number }) => {
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0d12', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setSource(url)
      })
      .catch(() => {
        // Если код не построился, остаётся ручной ввод.
        if (!cancelled) setSource(null)
      })
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (!source) return null

  return (
    <img
      className="qr"
      src={source}
      width={size}
      height={size}
      alt=""
      // Код всегда на светлом фоне: так его читает камера при любой теме.
      style={{ background: '#fff' }}
    />
  )
}

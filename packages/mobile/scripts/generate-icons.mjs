/**
 * Рисует иконки и заставку Android в фирменном стиле Verstak.
 *
 * Внешних инструментов вроде ImageMagick здесь нет и не хочется их требовать:
 * иконки простые, поэтому PNG собирается вручную — zlib входит в Node.
 *
 * Знак повторяет `packages/web/public/icon.svg`: три полосы акцента и точка
 * состояния. Он же используется в браузере, поэтому приложение и интерфейс
 * выглядят одинаково.
 */
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const res = path.join(root, 'android/app/src/main/res')

// Цвета совпадают с тёмной темой интерфейса.
const BACKGROUND = [11, 13, 18]
const BARS = [
  { x: 136, y: 176, width: 240, height: 40, color: [92, 124, 250] },
  { x: 136, y: 256, width: 168, height: 40, color: [143, 164, 255] },
  { x: 136, y: 336, width: 96, height: 40, color: [195, 206, 255] },
]
const DOT = { cx: 392, cy: 356, r: 34, color: [62, 207, 142] }

// Центр знака отличается от центра холста 512×512, поэтому при выводе по
// центру экрана его нужно сместить — иначе знак выглядит сдвинутым вправо.
const MARK_CENTER = { x: 281, y: 283 }

/** Собирает PNG из готовой функции цвета. */
const encodePng = (width, height, pixelAt) => {
  const raw = Buffer.alloc(height * (width * 4 + 1))
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0 // фильтр строки: без предсказания
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y)
      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
      raw[offset++] = a
    }
  }

  const chunk = (tag, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(tag, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // бит на канал
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let crcTable = null
const crc32 = (buffer) => {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return crc ^ -1
}

/** Смешивает цвет с тем, что уже нарисовано, по коэффициенту покрытия. */
const blend = (under, over, alpha) => {
  if (alpha <= 0) return under
  if (alpha >= 1) return over
  return [
    Math.round(under[0] + (over[0] - under[0]) * alpha),
    Math.round(under[1] + (over[1] - under[1]) * alpha),
    Math.round(under[2] + (over[2] - under[2]) * alpha),
  ]
}

const insideRoundedRect = (x, y, rect, radius) => {
  const left = rect.x
  const top = rect.y
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  if (x < left || x > right || y < top || y > bottom) return false
  const dx = Math.max(left + radius - x, 0, x - (right - radius))
  const dy = Math.max(top + radius - y, 0, y - (bottom - radius))
  return dx * dx + dy * dy <= radius * radius
}

/**
 * Знак в системе координат 512×512, как в SVG.
 *
 * `scale` уменьшает знак целиком: в заставке он занимает меньшую часть экрана.
 */
const drawMark = (px, py, scale) => {
  const x = (px - 256) / scale + 256
  const y = (py - 256) / scale + 256

  const dx = x - DOT.cx
  const dy = y - DOT.cy
  if (dx * dx + dy * dy <= DOT.r * DOT.r) return DOT.color

  for (const bar of BARS) {
    if (insideRoundedRect(x, y, bar, bar.height / 2)) return bar.color
  }
  return null
}

/** Знак без фона — для адаптивной иконки (фон рисует система). */
const renderForeground = (size) => {
  const scale = size / 512
  return encodePng(size, size, (px, py) => {
    // Сглаживание по 4 подвыборкам: края полос остаются ровными.
    let r = 0
    let g = 0
    let b = 0
    let hits = 0
    for (const [ox, oy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      const color = drawMark((px + ox) / scale, (py + oy) / scale, 1)
      if (color) {
        r += color[0]
        g += color[1]
        b += color[2]
        hits += 1
      }
    }
    if (!hits) return [0, 0, 0, 0]
    return [Math.round(r / hits), Math.round(g / hits), Math.round(b / hits), Math.round((hits / 4) * 255)]
  })
}

/** Полная иконка: скруглённый фон и знак. */
const renderLauncher = (size, rounded) => {
  const scale = size / 512
  const radius = rounded ? size / 2 : size * 0.22
  return encodePng(size, size, (px, py) => {
    if (!insideRoundedRect(px, py, { x: 0, y: 0, width: size - 1, height: size - 1 }, radius)) {
      return [0, 0, 0, 0]
    }
    let color = BACKGROUND
    for (const [ox, oy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      const mark = drawMark((px + ox) / scale, (py + oy) / scale, 0.72)
      if (mark) color = blend(color, mark, 1)
    }
    return [...color, 255]
  })
}

/** Заставка: тёмный фон и знак по центру. */
const renderSplash = (width, height) =>
  encodePng(width, height, (px, py) => {
    // Знак занимает примерно четверть меньшей стороны экрана.
    const unit = Math.min(width, height)
    const scale = unit / 512
    const centerX = width / 2
    const centerY = height / 2
    const mark = drawMarkForSplash(px, py, centerX, centerY, scale)
    return mark ? [...mark, 255] : [...BACKGROUND, 255]
  })

const drawMarkForSplash = (px, py, centerX, centerY, scale) => {
  // Знак занимает примерно четверть меньшей стороны экрана.
  const k = scale * 0.5 * 1.6
  const x = (px - centerX) / k + MARK_CENTER.x
  const y = (py - centerY) / k + MARK_CENTER.y
  const dx = x - DOT.cx
  const dy = y - DOT.cy
  if (dx * dx + dy * dy <= DOT.r * DOT.r) return DOT.color
  for (const bar of BARS) {
    if (insideRoundedRect(x, y, bar, bar.height / 2)) return bar.color
  }
  return null
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

const write = async (target, buffer) => {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, buffer)
}

for (const [density, factor] of Object.entries(DENSITIES)) {
  const launcher = Math.round(48 * factor)
  const foreground = Math.round(108 * factor)
  await write(path.join(res, `mipmap-${density}/ic_launcher.png`), renderLauncher(launcher, false))
  await write(path.join(res, `mipmap-${density}/ic_launcher_round.png`), renderLauncher(launcher, true))
  await write(path.join(res, `mipmap-${density}/ic_launcher_foreground.png`), renderForeground(foreground))
}

const SPLASHES = {
  'drawable': [480, 320],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
}

for (const [folder, [width, height]] of Object.entries(SPLASHES)) {
  await write(path.join(res, folder, 'splash.png'), renderSplash(width, height))
}

// Адаптивный фон задаётся цветом, а не картинкой.
await write(
  path.join(res, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B0D12</color>\n</resources>\n`,
)

console.log('Иконки и заставки обновлены')

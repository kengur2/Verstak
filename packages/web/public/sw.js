/**
 * Service worker Verstak.
 *
 * Стратегия подобрана так, чтобы обновление приложения не ломало загрузку:
 *
 *   • переходы между страницами (`navigate`) — всегда из сети, кэш только как
 *     запасной вариант. Иначе после обновления браузер получит старый
 *     index.html со ссылками на уже удалённые файлы сборки, и экран будет пуст;
 *   • файлы сборки в `/assets/` содержат хеш в имени и неизменны — их можно
 *     брать из кэша сразу, а обновлять в фоне;
 *   • остальная статика (иконки, манифест) — из кэша с фоновым обновлением;
 *   • запросы к API и поток событий — всегда в сеть, иначе на телефоне не было
 *     бы видно новых сообщений.
 *
 * Файл намеренно написан на JS без типов: он не входит в сборку Vite, а
 * копируется в dist как есть.
 */

/* eslint-env serviceworker */

const CACHE = 'verstak-v2'
const PRECACHE = ['./manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

/** Кладёт успешный ответ в кэш, не мешая текущему запросу. */
const putInCache = (request, response) => {
  if (!response || !response.ok) return
  const copy = response.clone()
  caches.open(CACHE).then((cache) => cache.put(request, copy))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  // API и поток событий всегда из сети.
  if (url.pathname.startsWith('/api/')) return

  // Переходы: сеть в приоритете, кэш — только если сети нет.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putInCache(request, response)
          return response
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached ?? caches.match('./index.html'))
            .then((fallback) => fallback ?? Response.error()),
        ),
    )
    return
  }

  const isHashedAsset = url.pathname.includes('/assets/')

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Хешированные файлы неизменны — обновлять их незачем.
        if (!isHashedAsset) fetch(request).then((response) => putInCache(request, response)).catch(() => undefined)
        return cached
      }
      return fetch(request)
        .then((response) => {
          putInCache(request, response)
          return response
        })
        .catch(() => Response.error())
    }),
  )
})

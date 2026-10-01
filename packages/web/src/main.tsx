import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isNativePlatform } from './lib/server'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Не найден корневой элемент #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker нужен, чтобы интерфейс на телефоне открывался без сети
// (через оверлей Wi-Fi/мобильных данных) и устанавливался как приложение.
// В мобильном приложении он не нужен: файлы уже лежат на устройстве, а
// лишний кэш только мешал бы обновлению после установки новой версии.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Без service worker приложение тоже работает, просто без офлайн-режима.
    })
  })
}
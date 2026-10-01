import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Сборка веб-интерфейса Verstak.
 *
 * Один и тот же бандл обслуживает и десктоп (в окне Electron), и телефон
 * (установленная PWA), поэтому относительные пути в base — обязательны.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:57311',
        changeOrigin: false,
        ws: true,
      },
    },
  },
})
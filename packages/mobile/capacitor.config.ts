import { CapacitorConfig } from '@capacitor/cli';

/**
 * Настройка мобильного приложения.
 *
 * Приложение — оболочка вокруг того же веб-интерфейса, что открывается в
 * браузере: отдельная сборка не нужна, поэтому экраны и поведение совпадают.
 * Адрес сервера пользователь вводит один раз при первом запуске.
 */
const config: CapacitorConfig = {
  appId: 'com.verstak.app',
  appName: 'Verstak',
  webDir: 'dist',
  // Интерфейс отдаётся по https://localhost, а сервер живёт в локальной сети
  // по обычному http. Без этого разрешения браузер внутри приложения
  // заблокировал бы такие запросы как небезопасные.
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;

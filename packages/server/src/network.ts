/**
 * Сетевые адреса машины.
 *
 * Телефону нужен адрес компьютера в локальной сети: `127.0.0.1` с телефона
 * указывает на сам телефон. Поэтому сервер сам перечисляет свои адреса, а
 * клиент выбирает подходящий или показывает список пользователю.
 */
import { networkInterfaces } from 'node:os'

export type AddressCandidate = {
  url: string
  /** `loopback` — только для этого компьютера, `lan` — доступен в сети. */
  kind: 'loopback' | 'lan'
  /** Имя интерфейса, например `wlan0` — помогает выбрать нужную сеть. */
  interface: string
}

const isPrivate = (url: string): boolean => {
  const host = url.replace(/^https?:\/\//, '').split(':')[0] ?? ''
  if (host.startsWith('10.')) return true
  if (host.startsWith('192.168.')) return true
  const match = /^172\.(\d+)\./.exec(host)
  if (match) {
    const second = Number(match[1])
    return second >= 16 && second <= 31
  }
  return false
}

/**
 * Интерфейсы, которые телефону бесполезны.
 *
 * Мосты Docker и виртуальные сети контейнеров существуют только внутри
 * компьютера: адреса вроде `172.17.0.1` с телефона не открываются. Показывать
 * их — только путать.
 */
const IGNORED_INTERFACE = /^(docker|br-|virbr|veth|vmnet|vboxnet|tun\d|tap\d)/

/**
 * Список адресов, по которым сервер доступен.
 *
 * Первыми идут адреса локальной сети: именно они нужны телефону. Адрес петли
 * добавлен последним — он пригодится при отладке на том же компьютере.
 */
export function listAddresses(port: number, hostname: string): AddressCandidate[] {
  // Если сервер слушает только петлю, снаружи он недоступен: не показываем
  // недостижимые адреса, иначе телефон будет упорно пробовать их.
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
    return [{ url: `http://127.0.0.1:${port}`, kind: 'loopback', interface: 'loopback' }]
  }

  const candidates: AddressCandidate[] = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (IGNORED_INTERFACE.test(name)) continue
    for (const address of addresses ?? []) {
      // IPv6 пропускаем: адреса редко совпадают между устройствами в одной
      // сети, а адрес в квадратных скобках нужно ещё правильно экранировать.
      if (address.family !== 'IPv4' || address.internal) continue
      candidates.push({
        url: `http://${address.address}:${port}`,
        kind: 'lan',
        interface: name,
      })
    }
  }

  // Домашние адреса понятнее пользователю, поэтому показываем их первыми.
  candidates.sort((a, b) => Number(isPrivate(b.url)) - Number(isPrivate(a.url)))
  candidates.push({ url: `http://127.0.0.1:${port}`, kind: 'loopback', interface: 'loopback' })
  return candidates
}

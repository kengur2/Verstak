/**
 * Хранение пароля входа.
 *
 * Взят подход: пароль не сохраняется, хранится только scrypt-хеш с солью.
 * Сравнение — constant-time, чтобы по времени ответа нельзя было подобрать
 * пароль перебором.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { paths } from './paths.ts'
import { readYamlFile, writeYamlFile } from './yaml-store.ts'

/** Параметры scrypt. N=16384 — компромисс между стойкостью и временем входа. */
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const

const KEY_LENGTH = 64

export type PasswordRecord = {
  algorithm: 'scrypt'
  saltBase64: string
  hashBase64: string
  keyLength: number
  params: { N: number; r: number; p: number; maxmem: number }
}

type AuthFile = {
  version: number
  username: string
  password: PasswordRecord
}

const emptyAuth = (username: string): AuthFile => ({
  version: 1,
  username,
  // Заглушка: случайный хеш, чтобы непарольный вход всегда проваливался,
  // а не падал с исключением.
  password: hashPassword(randomBytes(32).toString('base64')),
})

export function hashPassword(password: string): PasswordRecord {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS)
  return {
    algorithm: 'scrypt',
    saltBase64: salt.toString('base64'),
    hashBase64: Buffer.from(derived).toString('base64'),
    keyLength: KEY_LENGTH,
    params: { ...SCRYPT_PARAMS },
  }
}

export function verifyPassword(password: string, record: PasswordRecord): boolean {
  if (record.algorithm !== 'scrypt') return false
  try {
    const salt = Buffer.from(record.saltBase64, 'base64')
    const expected = Buffer.from(record.hashBase64, 'base64')
    const derived = scryptSync(password, salt, record.keyLength, record.params)
    if (expected.length !== derived.length) return false
    return timingSafeEqual(expected, Buffer.from(derived))
  } catch {
    return false
  }
}

export function readAuth(): AuthFile {
  return readYamlFile(paths.authFile, emptyAuth('verstak'))
}

/** Возвращает true, если пароль уже задан, то есть auth.yaml существует. */
export function isPasswordConfigured(): boolean {
  return existsSync(paths.authFile)
}

export function setPassword(username: string, password: string): void {
  writeYamlFile(paths.authFile, { version: 1, username, password: hashPassword(password) })
}

export function validateLogin(username: string, password: string): boolean {
  const auth = readAuth()
  return auth.username === username && verifyPassword(password, auth.password)
}

export function getUsername(): string {
  return readAuth().username
}
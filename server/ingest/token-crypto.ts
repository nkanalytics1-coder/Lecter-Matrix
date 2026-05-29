import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM wire format: base64( IV[12] ‖ ciphertext[N] ‖ authTag[16] )

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, body, tag]).toString('base64')
}

export function decrypt(encoded: string, key: Buffer): string {
  const buf = Buffer.from(encoded, 'base64')
  if (buf.length < 28) throw new Error('token-crypto: ciphertext too short')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const body = buf.subarray(12, buf.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

export function getEncKey(): Buffer {
  const raw = process.env['TOKEN_ENC_KEY'] ?? ''
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(`TOKEN_ENC_KEY must decode to 32 bytes (got ${key.length})`)
  }
  return key
}

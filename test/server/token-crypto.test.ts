import { describe, it, expect } from 'vitest'

vi.mock('server-only', () => ({}))

import { encrypt, decrypt } from '../../server/ingest/token-crypto'

// vitest globals are false; import vi explicitly
import { vi } from 'vitest'

function makeKey(): Buffer {
  return Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64')
}

describe('encrypt / decrypt round-trip', () => {
  it('decrypts to the original plaintext', () => {
    const key = makeKey()
    const plaintext = 'ya29.a0AfH6SMBxxxxxxRefreshTokenValue'
    const enc = encrypt(plaintext, key)
    expect(decrypt(enc, key)).toBe(plaintext)
  })

  it('produces different ciphertext on each call (random IV)', () => {
    const key = makeKey()
    const a = encrypt('same', key)
    const b = encrypt('same', key)
    expect(a).not.toBe(b)
  })

  it('round-trips an empty string', () => {
    const key = makeKey()
    expect(decrypt(encrypt('', key), key)).toBe('')
  })

  it('round-trips a long token', () => {
    const key = makeKey()
    const long = 'x'.repeat(512)
    expect(decrypt(encrypt(long, key), key)).toBe(long)
  })
})

describe('tampering detection', () => {
  it('throws when the auth tag is corrupted', () => {
    const key = makeKey()
    const enc = encrypt('secret', key)
    const buf = Buffer.from(enc, 'base64')
    // flip a bit in the auth tag (last 16 bytes)
    buf[buf.length - 1] ^= 0xff
    const tampered = buf.toString('base64')
    expect(() => decrypt(tampered, key)).toThrow()
  })

  it('throws when the ciphertext body is corrupted', () => {
    const key = makeKey()
    const enc = encrypt('secret', key)
    const buf = Buffer.from(enc, 'base64')
    // flip a byte in the body (between IV and tag)
    buf[12] ^= 0x01
    const tampered = buf.toString('base64')
    expect(() => decrypt(tampered, key)).toThrow()
  })

  it('throws when decrypted with a wrong key', () => {
    const key = makeKey()
    const wrongKey = Buffer.alloc(32, 0xff)
    const enc = encrypt('secret', key)
    expect(() => decrypt(enc, wrongKey)).toThrow()
  })

  it('throws when the encoded string is too short', () => {
    const key = makeKey()
    expect(() => decrypt('dG9vc2hvcnQ=', key)).toThrow('too short')
  })
})

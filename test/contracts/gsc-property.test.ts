import { describe, it, expect } from 'vitest'
import { derivePropertyType } from '../../src/contracts/lib/gsc-property'

describe('derivePropertyType', () => {
  it('classifies an sc-domain: URI as a domain property', () => {
    expect(derivePropertyType('sc-domain:example.com')).toBe('domain')
  })

  it('classifies an https:// URI as a url_prefix property', () => {
    expect(derivePropertyType('https://www.example.com/')).toBe('url_prefix')
  })

  it('classifies an http:// URI as a url_prefix property', () => {
    expect(derivePropertyType('http://example.com/')).toBe('url_prefix')
  })

  it('treats anything not starting with sc-domain: as url_prefix', () => {
    expect(derivePropertyType('example.com')).toBe('url_prefix')
  })

  it('is case-sensitive on the sc-domain: prefix (GSC always lowercases it)', () => {
    expect(derivePropertyType('SC-DOMAIN:example.com')).toBe('url_prefix')
  })
})

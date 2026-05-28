import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  normalizeQuery,
  classifyPage,
  slugTokens,
  isPersonalized,
  detectIntent,
} from '../../server/ingest/normalize'
import type { ClassifyRule, IntentSignals } from '../../server/ingest/normalize'
import type { PageType, Intent } from '../../src/contracts/types/domain'

// ── normalizeQuery ──────────────────────────────────────────────────────────

describe('normalizeQuery', () => {
  const cases: Array<[string, string, string]> = [
    ['NFKC + lowercase',                       'Carta Velina',                      'carta velina'],
    ['collapses internal whitespace',           '  carta   velina  ',                'carta velina'],
    ['removes wrapping straight double-quotes', '"carta velina"',                   'carta velina'],
    ['removes wrapping straight single-quotes', "'carta velina'",                   'carta velina'],
    ['normalizes smart double quotes',          '“Carta Velina”',          'carta velina'],
    ['normalizes smart single quotes',          '‘Carta’',                'carta'],
    ['preserves internal straight apostrophe',  "cos'è il packaging",               "cos'è il packaging"],
    ['normalizes curly apostrophe to straight', "cos’è il packaging",     "cos'è il packaging"],
    ['NFKC fi ligature',                        'ﬁle',                          'file'],
    ['strips leading punctuation',              '...carta velina',                   'carta velina'],
    ['strips trailing question mark',           'carta velina?',                     'carta velina'],
    ['handles uppercase with accent',           'COSÈ IL PACKAGING',            'cosè il packaging'],
    ['strips wrapping parens',                  '(carta velina)',                    'carta velina'],
    ['empty string',                            '',                                  ''],
  ]

  it.each(cases)('%s', (_label, input, expected) => {
    expect(normalizeQuery(input)).toBe(expected)
  })

  it('is idempotent', () => {
    const inputs = [
      'Carta Velina',
      '"cos\'è il packaging?"',
      '“Guida alla carta velina”!',
      '  carta   velina  ',
      '...packaging...',
      '',
    ]
    for (const input of inputs) {
      const once = normalizeQuery(input)
      expect(normalizeQuery(once)).toBe(once)
    }
  })

  it('does not stem or remove stopwords', () => {
    expect(normalizeQuery('come si usa la carta velina')).toBe('come si usa la carta velina')
  })
})

// ── classifyPage ────────────────────────────────────────────────────────────

describe('classifyPage', () => {
  const cases: Array<[string, string, PageType]> = [
    ['collection path',                        '/collections/carta-velina',                               'collection'],
    ['collection personalizzata path',         '/collections/carta-velina-personalizzata',                'collection'],
    ['blog single-segment',                    '/blogs/magazine',                                         'blog'],
    ['blog nested path',                       '/blogs/magazine/cos-e-il-packaging',                      'blog'],
    ['product path',                           '/products/carta-velina',                                  'product'],
    ['pages path',                             '/pages/chi-siamo',                                        'other'],
    ['unknown custom path',                    '/custom/path',                                            'unknown'],
    ['root path',                              '/',                                                       'unknown'],
    ['full URL collection — eurofides',        'https://www.eurofides.it/collections/carta-velina',       'collection'],
    ['full URL blog — eurofides',              'https://www.eurofides.it/blogs/magazine/packaging-guide', 'blog'],
    ['full URL product',                       'https://www.eurofides.it/products/buste',                 'product'],
    ['full URL pages',                         'https://www.eurofides.it/pages/contatti',                 'other'],
  ]

  it.each(cases)('%s', (_label, url, expected) => {
    expect(classifyPage(url)).toBe(expected)
  })

  it('custom rules override defaults — first match wins', () => {
    const rules: ClassifyRule[] = [
      { pattern: /^\/categorie\//, type: 'collection' },
      { pattern: /^\/articoli\//, type: 'blog' },
    ]
    expect(classifyPage('/categorie/carta', rules)).toBe('collection')
    expect(classifyPage('/articoli/guida', rules)).toBe('blog')
    expect(classifyPage('/collections/carta-velina', rules)).toBe('unknown')
  })
})

// ── slugTokens ──────────────────────────────────────────────────────────────

describe('slugTokens', () => {
  const cases: Array<[string, string, string[]]> = [
    ['hyphenated slug',           '/collections/carta-velina',                          ['carta', 'velina']],
    ['blog nested path',          '/blogs/magazine/cos-e-il-packaging',                 ['cos', 'e', 'il', 'packaging']],
    ['underscore slug',           '/products/carta_velina_rosa',                        ['carta', 'velina', 'rosa']],
    ['mixed hyphens+underscores', '/collections/carta-velina_personalizzata',           ['carta', 'velina', 'personalizzata']],
    ['single token',              '/pages/contact',                                     ['contact']],
    ['root path',                 '/',                                                  []],
    ['full URL — eurofides',      'https://www.eurofides.it/collections/carta-velina',  ['carta', 'velina']],
  ]

  it.each(cases)('%s', (_label, url, expected) => {
    expect(slugTokens(url)).toEqual(expected)
  })
})

// ── isPersonalized ──────────────────────────────────────────────────────────

describe('isPersonalized', () => {
  const cases: Array<[string, string, boolean]> = [
    ['personalizzata slug — eurofides',     '/collections/carta-velina-personalizzata',    true],
    ['plain collection slug',               '/collections/carta-velina',                   false],
    ['con-logo slug',                       '/collections/buste-con-logo',                 true],
    ['con-il-tuo-logo slug',                '/collections/buste-con-il-tuo-logo',          true],
    ['product personalizzati',              '/products/biglietti-personalizzati',           true],
    ['unrelated product slug',              '/products/carta-rosa',                        false],
    ['blog slug not personalized',          '/blogs/magazine/cos-e-il-packaging',          false],
    ['full URL personalizzata — eurofides', 'https://www.eurofides.it/collections/carta-velina-personalizzata', true],
  ]

  it.each(cases)('%s', (_label, url, expected) => {
    expect(isPersonalized(url)).toBe(expected)
  })

  it('custom markers override defaults', () => {
    expect(isPersonalized('/collections/buste-brandizzate', ['brandizzat'])).toBe(true)
    expect(isPersonalized('/collections/carta-velina',      ['brandizzat'])).toBe(false)
    expect(isPersonalized('/collections/carta-velina-personalizzata', ['brandizzat'])).toBe(false)
  })
})

// ── detectIntent ────────────────────────────────────────────────────────────

describe('detectIntent', () => {
  const cases: Array<[string, string, Intent]> = [
    ['how-to query — come',          'come scegliere la carta velina',          'informational'],
    ['cosa query',                   'cosa si intende per packaging',            'informational'],
    ["cos'è query — eurofides",      "cos'è il packaging alimentare",            'informational'],
    ['guida query',                  'guida alla carta velina',                  'informational'],
    ['differenza query',             'differenza tra carta velina e tissue',      'informational'],
    ['price query — prezzo',         'carta velina prezzo',                      'transactional'],
    ['price query — prezzi',         'carta velina prezzi',                      'transactional'],
    ['personalizzata query',         'carta velina personalizzata',              'transactional'],
    ['comprare query',               'comprare carta velina online',             'transactional'],
    ['acquisto query',               'acquisto carta velina',                    'transactional'],
    ['online query',                 'carta velina online',                      'transactional'],
    ['sconto query',                 'carta velina sconto',                      'transactional'],
    ['neutral brand query',          'eurofides packaging',                      'unknown'],
    ['neutral category query',       'carta velina',                             'unknown'],
    ['signal not substring of word', 'ecommerce packaging',                      'unknown'],
  ]

  it.each(cases)('%s', (_label, queryNorm, expected) => {
    expect(detectIntent(queryNorm)).toBe(expected)
  })

  it('custom signals override defaults', () => {
    const signals: IntentSignals = {
      informational: ['tutorial'],
      transactional: ['buynow'],
    }
    expect(detectIntent('tutorial packaging',      signals)).toBe('informational')
    expect(detectIntent('carta buynow online',     signals)).toBe('transactional')
    expect(detectIntent('come comprare',           signals)).toBe('unknown')
  })

  it('informational takes priority over transactional when both signals present', () => {
    expect(detectIntent('guida ai prezzi migliori')).toBe('informational')
  })
})

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  normalizeQuery,
  normalizePageUrl,
  classifyPage,
  slugTokens,
  isPersonalized,
  detectIntent,
  DEFAULT_SIGNALS,
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

// ── normalizePageUrl ─────────────────────────────────────────────────────────

describe('normalizePageUrl', () => {
  const cases: Array<[string, string, string]> = [
    ['strips ?page=N from full URL',           'https://x.it/collections/buste?page=2',              'https://x.it/collections/buste'],
    ['strips ?page=N from relative path',      '/collections/buste?page=2',                          '/collections/buste'],
    ['strips ?page=N&sort=…',                  '/collections/buste?page=3&sort=name:asc',            '/collections/buste'],
    ['strips ?sort only',                      '/collections/buste?sort=price:desc',                 '/collections/buste'],
    ['strips ?view=quick',                     '/collections/buste?view=quick',                      '/collections/buste'],
    ['strips ?view=list',                      '/collections/buste?view=list',                       '/collections/buste'],
    ['strips page+sort+view together',         '/collections/buste?page=2&sort=price:asc&view=grid', '/collections/buste'],
    ['no-op when no pagination params',        '/collections/buste',                                 '/collections/buste'],
    ['preserves unrelated query param',        '/collections/buste?foo=bar',                         '/collections/buste?foo=bar'],
    ['full URL with page and extra param',     'https://x.it/p?page=1&ref=nav',                      'https://x.it/p?ref=nav'],
    ['full URL no params',                     'https://x.it/collections/buste',                     'https://x.it/collections/buste'],
  ]

  it.each(cases)('%s', (_label, input, expected) => {
    expect(normalizePageUrl(input)).toBe(expected)
  })

  it('collapses page=2 and page=3 to same URL', () => {
    const base = '/collections/buste'
    expect(normalizePageUrl(`${base}?page=2`)).toBe(normalizePageUrl(`${base}?page=3`))
    expect(normalizePageUrl(`${base}?page=2`)).toBe(normalizePageUrl(base))
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
    // informational — default linguistic signals
    ['how-to query — come',               'come scegliere il prodotto',               'informational'],
    ['cosa query',                        'cosa si intende per packaging',             'informational'],
    ["cos'è query",                       "cos'è il packaging alimentare",             'informational'],
    ['quando query',                      'quando si usa questo materiale',            'informational'],
    ['quale query',                       'quale materiale scegliere',                 'informational'],
    ['quali query',                       'quali sono i tipi di imballaggi',           'informational'],
    ['significato query',                 'significato di packaging',                  'informational'],
    ['differenza query',                  'differenza tra due materiali',              'informational'],
    ['differenze query',                  'differenze tra i materiali',                'informational'],
    ['guida query',                       'guida alla scelta',                         'informational'],
    ['idee query',                        'idee regalo',                               'informational'],
    ['idea query',                        'idea regalo originale',                     'informational'],
    ['tipi di query',                     'tipi di imballaggi alimentari',             'informational'],
    ['migliore query',                    'migliore materiale per alimenti',           'informational'],
    ['migliori query',                    'migliori soluzioni per la spedizione',      'informational'],
    // transactional — default universal commercial modifiers
    ['price query — prezzo',              'articolo prezzo',                           'transactional'],
    ['price query — prezzi',              'prezzi ingrosso',                           'transactional'],
    ['personalizzata query',              'prodotto personalizzato',                   'transactional'],
    ['comprare query',                    'comprare online',                           'transactional'],
    ['acquisto query',                    'acquisto articolo',                         'transactional'],
    ['acquist prefix',                    'acquistare materiali',                      'transactional'],
    ['online query',                      'ordine online',                             'transactional'],
    ['offerta query',                     'offerta speciale',                          'transactional'],
    ['ingrosso query',                    'vendita ingrosso',                          'transactional'],
    ['fornitura query',                   'fornitura materiali',                       'transactional'],
    ['vendita query',                     'vendita articoli',                          'transactional'],
    ['b2b query',                         'servizio b2b',                              'transactional'],
    ['su misura query',                   'prodotto su misura',                        'transactional'],
    ['con logo query',                    'articolo con logo aziendale',               'transactional'],
    // informational — enriched signals
    ['dove query',                          'dove si usa la carta velina',               'informational'],
    ['vantaggi query',                      'vantaggi del packaging biodegradabile',     'informational'],
    ['svantaggi query',                     'svantaggi del packaging plastico',          'informational'],
    ['caratteristich query',                'caratteristiche tecniche del cartone',      'informational'],
    // transactional — enriched signals
    ['catalogo query',                      'catalogo buste personalizzate',             'transactional'],
    ['preventiv query',                     'preventivo imballaggi personalizzati',      'transactional'],
    ['listino query',                       'listino prezzi ingrosso',                   'transactional'],
    ['campion query',                       'campioni gratuiti disponibili',             'transactional'],
    ['sconto query',                        'sconto sul prezzo del packaging',           'transactional'],
    ['sconti query',                        'sconti ingrosso buste',                     'transactional'],
    ['ordine query',                        'ordine minimo buste personalizzate',        'transactional'],
    ['ordini query',                        'ordini all ingrosso',                       'transactional'],
    // unknown — no default signal in query
    ['packaging alone → unknown',         'packaging',                                 'unknown'],
    ['prezzo buste — transactional via prezzo, not buste', 'prezzo buste',            'transactional'],
    ['neutral brand query',               'eurofides packaging',                       'unknown'],
    ['neutral category query',            'materiale',                                 'unknown'],
    ['signal not substring of word',      'ecommerce packaging',                       'unknown'],
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

  it('navigational when brand term matches — wins over all other signals', () => {
    const signals: IntentSignals = { ...DEFAULT_SIGNALS, brandTerms: ['acme'] }
    expect(detectIntent('acme packaging',     signals)).toBe('navigational')
    expect(detectIntent('prezzo acme',        signals)).toBe('navigational')  // brand > transactional
    expect(detectIntent('come usare acme',    signals)).toBe('navigational')  // brand > informational
    expect(detectIntent('packaging',          signals)).toBe('unknown')       // no brand match
  })

  it('no navigational when brandTerms is empty (default)', () => {
    expect(detectIntent('eurofides packaging')).toBe('unknown')
  })

  it('brand term requires right word boundary — no substring match inside a word', () => {
    const signals: IntentSignals = { ...DEFAULT_SIGNALS, brandTerms: ['acme'] }
    expect(detectIntent('acmeshopper packaging', signals)).toBe('unknown')     // 'acme' is prefix of a word
    expect(detectIntent('acme.it packaging',     signals)).toBe('navigational') // '.' is non-word char
  })

  it('sector signals via extra params — never in defaults', () => {
    const signals: IntentSignals = {
      ...DEFAULT_SIGNALS,
      transactional: [...DEFAULT_SIGNALS.transactional, 'buste', 'sacchetti'],
    }
    expect(detectIntent('buste personalizzate', signals)).toBe('transactional')
    // without extra signals, domain nouns alone are unknown
    expect(detectIntent('buste personalizzate')).toBe('transactional')  // "personalizzat" is a default signal
    expect(detectIntent('buste sacchetti')).toBe('unknown')              // no default signal matches
  })
})

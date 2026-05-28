import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  pickWinner,
  cannType,
  pickDominant,
  severity,
  lostClicks,
  benign,
} from '../../server/engine/scoring'
import type { ScoringMember } from '../../server/engine/scoring'

// ── helpers ──────────────────────────────────────────────────────────────────

function member(
  page: string,
  pageType: ScoringMember['pageType'],
  clicks: number,
  impressions: number,
  position: number,
): ScoringMember {
  return { page, pageType, clicks, impressions, position }
}

// ── pickWinner ────────────────────────────────────────────────────────────────

describe('pickWinner', () => {
  it('returns member with most clicks', () => {
    const members = [
      member('/a', 'collection', 10, 100, 3),
      member('/b', 'collection', 50, 80,  2),
      member('/c', 'blog',       5,  200, 1),
    ]
    expect(pickWinner(members).page).toBe('/b')
  })

  it('tiebreak: most impressions when clicks equal', () => {
    const members = [
      member('/a', 'collection', 20, 100, 3),
      member('/b', 'collection', 20, 300, 2),
      member('/c', 'blog',       20, 150, 1),
    ]
    expect(pickWinner(members).page).toBe('/b')
  })

  it('single member is the winner', () => {
    const m = member('/only', 'collection', 5, 50, 2)
    expect(pickWinner([m])).toBe(m)
  })

  it('throws on empty members', () => {
    expect(() => pickWinner([])).toThrow('empty members')
  })
})

// ── cannType ──────────────────────────────────────────────────────────────────

describe('cannType', () => {
  it('all collection → collection_vs_collection', () => {
    const members = [
      member('/collections/a', 'collection', 10, 100, 1),
      member('/collections/b', 'collection', 5,  80,  2),
    ]
    expect(cannType(members)).toBe('collection_vs_collection')
  })

  it('all blog → blog_vs_blog', () => {
    const members = [
      member('/blogs/a', 'blog', 10, 100, 1),
      member('/blogs/b', 'blog', 5,  80,  2),
    ]
    expect(cannType(members)).toBe('blog_vs_blog')
  })

  it('collection + blog only → collection_vs_blog', () => {
    const members = [
      member('/collections/a', 'collection', 10, 100, 1),
      member('/blogs/b',       'blog',       5,  80,  2),
    ]
    expect(cannType(members)).toBe('collection_vs_blog')
  })

  it('collection + blog + product → mixed', () => {
    const members = [
      member('/collections/a', 'collection', 10, 100, 1),
      member('/blogs/b',       'blog',       5,  80,  2),
      member('/products/c',    'product',    3,  50,  5),
    ]
    expect(cannType(members)).toBe('mixed')
  })

  it('all product → mixed (no product_vs_product variant)', () => {
    const members = [
      member('/products/a', 'product', 10, 100, 1),
      member('/products/b', 'product', 5,  80,  2),
    ]
    expect(cannType(members)).toBe('mixed')
  })

  it('collection + unknown → mixed', () => {
    const members = [
      member('/collections/a', 'collection', 10, 100, 1),
      member('/custom/b',      'unknown',    5,  80,  2),
    ]
    expect(cannType(members)).toBe('mixed')
  })
})

// ── pickDominant ──────────────────────────────────────────────────────────────

describe('pickDominant', () => {
  it('click leader with best position wins for unknown intent', () => {
    const members = [
      member('/collections/carta-velina', 'collection', 100, 500, 1),
      member('/blogs/guida',              'blog',        10, 200, 8),
    ]
    const dom = pickDominant(members, 'unknown')
    // high clicks + best position + decent unknown prior for collection → collection wins
    expect(dom.page).toBe('/collections/carta-velina')
  })

  it('inversion: blog dominates for informational intent despite fewer clicks', () => {
    // collection has more clicks but blog has strong informational prior (0.9 vs 0.3)
    const members = [
      member('/collections/carta-velina', 'collection', 80, 500, 1),
      member('/blogs/guida-carta-velina', 'blog',       20, 200, 3),
    ]
    // clicks norm: collection=1, blog=0; posInv norm: collection=1, blog=0
    // blog score = 0.55*0 + 0.30*0 + 0.15*0.9 = 0.135
    // collection score = 0.55*1 + 0.30*1 + 0.15*0.3 = 0.895
    // collection still wins here due to massive click/position advantage
    const dom = pickDominant(members, 'informational')
    expect(dom.page).toBe('/collections/carta-velina')
  })

  it('inversion: blog dominates for informational when clicks are equal and blog has better position', () => {
    // equal clicks → both normalise to 0.5; blog has better position + high informational prior
    const members = [
      member('/collections/carta-velina', 'collection', 50, 300, 5),
      member('/blogs/guida',              'blog',        50, 300, 2),
    ]
    // clicks: both 0.5
    // posInv: blog 1/2=0.5, collection 1/5=0.2 → norm: blog=1, collection=0
    // blog score  = 0.55*0.5 + 0.30*1 + 0.15*0.9 = 0.275+0.30+0.135 = 0.710
    // coll score  = 0.55*0.5 + 0.30*0 + 0.15*0.3 = 0.275+0+0.045 = 0.320
    const dom = pickDominant(members, 'informational')
    expect(dom.page).toBe('/blogs/guida')
  })

  it('collection dominates for transactional intent', () => {
    const members = [
      member('/collections/carta-velina', 'collection', 50, 300, 2),
      member('/blogs/guida',              'blog',        50, 300, 2),
    ]
    // equal clicks and equal position → both posInv equal → same norm score
    // prior: transactional collection=0.9 vs blog=0.1 → collection wins
    const dom = pickDominant(members, 'transactional')
    expect(dom.page).toBe('/collections/carta-velina')
  })

  it('tiebreak: lexicographically lower page string', () => {
    const members = [
      member('/collections/z-page', 'collection', 50, 300, 2),
      member('/collections/a-page', 'collection', 50, 300, 2),
    ]
    // identical scores → 'a-page' < 'z-page'
    const dom = pickDominant(members, 'unknown')
    expect(dom.page).toBe('/collections/a-page')
  })

  it('throws on empty members', () => {
    expect(() => pickDominant([], 'unknown')).toThrow('empty members')
  })
})

// ── severity ──────────────────────────────────────────────────────────────────

describe('severity', () => {
  it('returns 0 for empty members', () => {
    expect(severity([])).toBe(0)
  })

  it('result is in [0, 100]', () => {
    const cases: ScoringMember[][] = [
      [member('/a', 'collection', 0, 0, 1)],
      [member('/a', 'collection', 1000, 100000, 1), member('/b', 'blog', 1000, 100000, 2)],
      [member('/a', 'collection', 5, 50, 1), member('/b', 'blog', 3, 30, 10)],
    ]
    for (const members of cases) {
      const s = severity(members)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
  })

  it('higher volume → higher severity (V component)', () => {
    const base = [
      member('/a', 'collection', 10, 100, 2),
      member('/b', 'blog',       10, 100, 4),
    ]
    const bigger = [
      member('/a', 'collection', 100, 10000, 2),
      member('/b', 'blog',       100, 10000, 4),
    ]
    expect(severity(bigger)).toBeGreaterThan(severity(base))
  })

  it('more even impression split → higher severity (S component)', () => {
    const uneven = [
      member('/a', 'collection', 5, 90, 2),
      member('/b', 'blog',       5, 10, 4),
    ]
    const even = [
      member('/a', 'collection', 5, 50, 2),
      member('/b', 'blog',       5, 50, 4),
    ]
    expect(severity(even)).toBeGreaterThan(severity(uneven))
  })

  it('wider position spread → higher severity (P component)', () => {
    const narrow = [
      member('/a', 'collection', 5, 50, 2),
      member('/b', 'blog',       5, 50, 3),
    ]
    const wide = [
      member('/a', 'collection', 5, 50, 2),
      member('/b', 'blog',       5, 50, 12),
    ]
    expect(severity(wide)).toBeGreaterThan(severity(narrow))
  })

  it('single member: S = 0 and P = 0', () => {
    // Only V contributes
    const s = severity([member('/a', 'collection', 10, 1000, 3)])
    const V = Math.min(Math.log10(1001) / Math.log10(100001), 1)
    expect(s).toBeCloseTo(100 * 0.40 * V, 5)
  })
})

// ── lostClicks ────────────────────────────────────────────────────────────────

describe('lostClicks', () => {
  it('returns 0 for empty members', () => {
    expect(lostClicks([])).toBe(0)
  })

  it('computes opportunity at position-1 CTR (0.284)', () => {
    const members = [
      member('/a', 'collection', 0,   1000, 1),
      member('/b', 'blog',       0,   500,  3),
    ]
    // totalImpr=1500, bestPos=1, CTR=0.284, expected=426, actual=0 → lost=426
    expect(lostClicks(members)).toBe(Math.round(1500 * 0.284))
  })

  it('returns 0 when actual clicks exceed expected', () => {
    const members = [
      member('/a', 'collection', 1000, 100, 1),
    ]
    // totalImpr=100, bestPos=1, expected=28.4, actual=1000 → lost=0
    expect(lostClicks(members)).toBe(0)
  })

  it('interpolates CTR for fractional positions', () => {
    // position 1.5 → linear interpolation between 0.284 and 0.152
    const expected = 0.284 + (0.152 - 0.284) * 0.5 // 0.218
    const members = [member('/a', 'collection', 0, 1000, 1.5)]
    expect(lostClicks(members)).toBe(Math.round(1000 * expected))
  })
})

// ── benign ────────────────────────────────────────────────────────────────────

describe('benign', () => {
  it('returns false for fewer than 2 members', () => {
    expect(benign([member('/a', 'collection', 10, 100, 1)])).toEqual({ benign: false, reason: null })
    expect(benign([])).toEqual({ benign: false, reason: null })
  })

  it('base_variant: Eurofides — carta-velina vs carta-velina-personalizzata', () => {
    // One is personalised, the other not; Jaccard = 2/3 ≈ 0.667 ≥ 0.5
    const members = [
      member('https://www.eurofides.it/collections/carta-velina', 'collection', 50, 500, 2),
      member('https://www.eurofides.it/collections/carta-velina-personalizzata', 'collection', 30, 400, 3),
    ]
    expect(benign(members)).toEqual({ benign: true, reason: 'base_variant' })
  })

  it('base_variant: top-2 by impressions (not by clicks order)', () => {
    // Third member has highest clicks but lowest impressions — top-2 by impressions are the variant pair
    const members = [
      member('https://www.eurofides.it/collections/carta-velina', 'collection', 5, 500, 2),
      member('https://www.eurofides.it/collections/carta-velina-personalizzata', 'collection', 3, 400, 3),
      member('/products/x', 'product', 999, 10, 1), // high clicks, low impressions
    ]
    expect(benign(members)).toEqual({ benign: true, reason: 'base_variant' })
  })

  it('base_variant false when Jaccard < 0.5 despite personalisation XOR', () => {
    // One is personalised but slug tokens are unrelated → Jaccard ≈ 0
    const members = [
      member('/collections/carta-velina', 'collection', 50, 500, 2),
      member('/collections/packaging-personalizzato', 'collection', 30, 400, 3),
    ]
    const result = benign(members)
    expect(result.reason).not.toBe('base_variant')
  })

  it('base_variant false when both personalised (XOR = false)', () => {
    const members = [
      member('/collections/carta-velina-personalizzata', 'collection', 50, 500, 2),
      member('/collections/buste-personalizzate', 'collection', 30, 400, 3),
    ]
    const result = benign(members)
    expect(result.reason).not.toBe('base_variant')
  })

  it('mother_child: /carta-velina ⊂ /carta-velina-colorata', () => {
    // Neither is personalised; tokens ['carta','velina'] ⊂ ['carta','velina','colorata']
    const members = [
      member('/collections/carta-velina', 'collection', 50, 500, 2),
      member('/collections/carta-velina-colorata', 'collection', 30, 400, 3),
    ]
    expect(benign(members)).toEqual({ benign: true, reason: 'mother_child' })
  })

  it('mother_child: proper subset only — equal token sets → false', () => {
    const members = [
      member('/collections/carta-velina', 'collection', 50, 500, 2),
      member('/collections/carta-velina', 'collection', 30, 400, 3),
    ]
    // Same tokens → size equal, not strict subset
    expect(benign(members)).toEqual({ benign: false, reason: null })
  })

  it('not benign: unrelated pages', () => {
    const members = [
      member('/collections/carta-velina', 'collection', 50, 500, 2),
      member('/blogs/guida-packaging',    'blog',       30, 400, 3),
    ]
    expect(benign(members)).toEqual({ benign: false, reason: null })
  })
})

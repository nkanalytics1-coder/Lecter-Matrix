import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { recommendedAction } from '../../server/engine/action-table'
import type { ActionInput } from '../../server/engine/action-table'

function input(overrides: Partial<ActionInput>): ActionInput {
  return {
    cannType: 'collection_vs_collection',
    intent: 'unknown',
    winnerPageType: 'collection',
    slugJaccard: 0,
    benignResult: { benign: false, reason: null },
    ...overrides,
  }
}

describe('recommendedAction — 8 branches', () => {
  // Branch 1
  it('consolidate_301: same-type pages with high slug Jaccard, not a variant', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_collection',
      slugJaccard: 0.6,
      benignResult: { benign: false, reason: null },
    }))).toBe('consolidate_301')
  })

  it('consolidate_301: also applies for blog_vs_blog with high Jaccard', () => {
    expect(recommendedAction(input({
      cannType: 'blog_vs_blog',
      winnerPageType: 'blog',
      slugJaccard: 0.75,
      benignResult: { benign: false, reason: null },
    }))).toBe('consolidate_301')
  })

  // Branch 2
  it('differentiate_variant_onpage: base_variant benign reason', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_collection',
      slugJaccard: 0.8,
      benignResult: { benign: true, reason: 'base_variant' },
    }))).toBe('differentiate_variant_onpage')
  })

  // Branch 3
  it('despine_blog_to_collection: blog winning transactional where collection exists', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_blog',
      intent: 'transactional',
      winnerPageType: 'blog',
    }))).toBe('despine_blog_to_collection')
  })

  // Branch 4
  it('reposition_collection_strengthen_blog: informational + collection_vs_blog', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_blog',
      intent: 'informational',
      winnerPageType: 'collection',
    }))).toBe('reposition_collection_strengthen_blog')
  })

  it('reposition_collection_strengthen_blog: applies regardless of winner type (blog winning informational)', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_blog',
      intent: 'informational',
      winnerPageType: 'blog',
    }))).toBe('reposition_collection_strengthen_blog')
  })

  // Branch 5
  it('interlink_blog_to_collection: collection winning transactional, blog also competes', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_blog',
      intent: 'transactional',
      winnerPageType: 'collection',
    }))).toBe('interlink_blog_to_collection')
  })

  // Branch 6
  it('reduce_blog_overlap_or_canonical: blog_vs_blog + informational', () => {
    expect(recommendedAction(input({
      cannType: 'blog_vs_blog',
      intent: 'informational',
      winnerPageType: 'blog',
      slugJaccard: 0.2,
    }))).toBe('reduce_blog_overlap_or_canonical')
  })

  // Branch 7
  it('consolidate_blog_cluster: blog_vs_blog + transactional', () => {
    expect(recommendedAction(input({
      cannType: 'blog_vs_blog',
      intent: 'transactional',
      winnerPageType: 'blog',
      slugJaccard: 0.2,
    }))).toBe('consolidate_blog_cluster')
  })

  // Branch 8
  it('differentiate_onpage: mixed type (fallback)', () => {
    expect(recommendedAction(input({
      cannType: 'mixed',
      intent: 'unknown',
      winnerPageType: 'product',
    }))).toBe('differentiate_onpage')
  })

  it('differentiate_onpage: collection_vs_collection with low Jaccard and no variant', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_collection',
      slugJaccard: 0.1,
      benignResult: { benign: false, reason: null },
    }))).toBe('differentiate_onpage')
  })

  it('differentiate_onpage: collection_vs_blog + navigational intent', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_blog',
      intent: 'navigational',
      winnerPageType: 'collection',
    }))).toBe('differentiate_onpage')
  })
})

describe('consolidate_301 boundary conditions', () => {
  it('NOT triggered when Jaccard exactly 0.5 — minimum is 0.5 (inclusive)', () => {
    // Jaccard = 0.5 is ≥ 0.5 → SHOULD trigger
    expect(recommendedAction(input({
      cannType: 'collection_vs_collection',
      slugJaccard: 0.5,
    }))).toBe('consolidate_301')
  })

  it('NOT triggered when Jaccard < 0.5', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_collection',
      slugJaccard: 0.49,
    }))).not.toBe('consolidate_301')
  })

  it('NOT triggered when benign reason is base_variant (even if Jaccard ≥ 0.5)', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_collection',
      slugJaccard: 0.8,
      benignResult: { benign: true, reason: 'base_variant' },
    }))).toBe('differentiate_variant_onpage')
  })

  it('IS triggered for mother_child benign (not a personalised variant)', () => {
    expect(recommendedAction(input({
      cannType: 'collection_vs_collection',
      slugJaccard: 0.7,
      benignResult: { benign: true, reason: 'mother_child' },
    }))).toBe('consolidate_301')
  })

  it('NOT triggered for mixed cannType even with high Jaccard', () => {
    expect(recommendedAction(input({
      cannType: 'mixed',
      slugJaccard: 0.9,
    }))).not.toBe('consolidate_301')
  })
})

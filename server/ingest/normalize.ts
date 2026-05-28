import 'server-only'
import type { Intent, PageType } from '../../src/contracts/types/domain'

// ── normalizeQuery ──────────────────────────────────────────────────────────

export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFKC')
    // typographic single quotes → straight
    .replace(/[‘’‚‛′‵]/g, "'")
    // typographic double quotes → straight
    .replace(/[“”„‟″‶]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    // strip leading/trailing non-letter, non-digit, non-space characters
    .replace(/^[^\p{L}\p{N}\s]+|[^\p{L}\p{N}\s]+$/gu, '')
    .trim()
}

// ── classifyPage ────────────────────────────────────────────────────────────

export interface ClassifyRule {
  pattern: RegExp
  type: PageType
}

const DEFAULT_CLASSIFY_RULES: ClassifyRule[] = [
  { pattern: /^\/collections\//, type: 'collection' },
  { pattern: /^\/blogs\//, type: 'blog' },
  { pattern: /^\/products\//, type: 'product' },
  { pattern: /^\/pages\//, type: 'other' },
]

export function classifyPage(url: string, rules?: ClassifyRule[]): PageType {
  const { pathname } = new URL(url, 'https://x')
  const effectiveRules = rules ?? DEFAULT_CLASSIFY_RULES
  for (const rule of effectiveRules) {
    if (rule.pattern.test(pathname)) return rule.type
  }
  return 'unknown'
}

// ── slugTokens ──────────────────────────────────────────────────────────────

export function slugTokens(url: string): string[] {
  const { pathname } = new URL(url, 'https://x')
  const slug = pathname.split('/').filter(Boolean).at(-1) ?? ''
  if (!slug) return []
  return slug.split(/[-_]/).map(t => t.toLowerCase()).filter(Boolean)
}

// ── isPersonalized ──────────────────────────────────────────────────────────

const DEFAULT_MARKERS: string[] = ['personalizzat', 'con-logo', 'con-il-tuo-logo']

export function isPersonalized(url: string, markers?: string[]): boolean {
  const { pathname } = new URL(url, 'https://x')
  const slug = pathname.split('/').filter(Boolean).at(-1) ?? ''
  const effectiveMarkers = markers ?? DEFAULT_MARKERS
  return effectiveMarkers.some(m => slug.includes(m))
}

// ── detectIntent ────────────────────────────────────────────────────────────

export interface IntentSignals {
  informational: string[]
  transactional: string[]
}

const DEFAULT_SIGNALS: IntentSignals = {
  informational: [
    'come', 'cosa', "cos'", 'guida', 'differenza', 'tutorial',
    'quando', 'dove', 'perché', 'perche', 'chi', 'spiegazione',
  ],
  transactional: [
    'prezzo', 'prezzi', 'comprare', 'acquistare', 'acquisto',
    'online', 'personalizzat', 'offerta', 'sconto', 'vendita',
    'economico', 'economici', 'shop', 'ordine', 'spedizione',
  ],
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasSignal(query: string, signal: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegex(signal)}`).test(query)
}

export function detectIntent(queryNorm: string, signals?: IntentSignals): Intent {
  const effectiveSignals = signals ?? DEFAULT_SIGNALS
  for (const signal of effectiveSignals.informational) {
    if (hasSignal(queryNorm, signal)) return 'informational'
  }
  for (const signal of effectiveSignals.transactional) {
    if (hasSignal(queryNorm, signal)) return 'transactional'
  }
  return 'unknown'
}

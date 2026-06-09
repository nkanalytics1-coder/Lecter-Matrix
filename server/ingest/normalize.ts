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

// ── normalizePageUrl ─────────────────────────────────────────────────────────

export function normalizePageUrl(url: string): string {
  const parsed = new URL(url, 'https://x')
  parsed.searchParams.delete('page')
  parsed.searchParams.delete('sort')
  parsed.searchParams.delete('view')
  const isAbsolute = /^https?:\/\//i.test(url)
  return isAbsolute
    ? parsed.origin + parsed.pathname + parsed.search
    : parsed.pathname + parsed.search
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
  brandTerms?: string[]
}

export const DEFAULT_SIGNALS: IntentSignals = {
  informational: [
    'come', 'cosa', "cos'", 'cos-e', 'cos e',
    'perche', 'perché', 'quando', 'quale', 'quali',
    'significato', 'differenza', 'differenze',
    'idee', 'idea', 'guida', 'tipi-di', 'tipi di',
    'migliore', 'migliori',
    'dove', 'vantaggi', 'svantaggi', 'caratteristich',
  ],
  transactional: [
    'prezzo', 'prezzi', 'comprare', 'acquist', 'acquisto',
    'online', 'offerta', 'offerte', 'economic', 'economici',
    'ingrosso', 'fornitura', 'forniture', 'fornitore',
    'produzione', 'produttori', 'grossista', 'vendita',
    'shop', 'b2b', 'su-misura', 'su misura',
    'personalizzat', 'con-logo', 'con logo',
    'catalogo', 'preventiv', 'listino', 'campion',
    'sconto', 'sconti', 'ordine', 'ordini',
  ],
  brandTerms: [],
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasSignal(query: string, signal: string): boolean {
  return new RegExp('(?:^|\\s)' + escapeRegex(signal)).test(query)
}

// Brand terms require a right-word boundary so "acmeshopper" doesn't match brand "acme".
function hasBrandSignal(query: string, term: string): boolean {
  return new RegExp('(?:^|\\s)' + escapeRegex(term) + '(?!\\w)').test(query)
}

// Priority: navigational > informational > transactional > unknown
export function detectIntent(queryNorm: string, signals?: IntentSignals): Intent {
  const s = signals ?? DEFAULT_SIGNALS
  for (const term of s.brandTerms ?? []) {
    if (hasBrandSignal(queryNorm, term)) return 'navigational'
  }
  for (const signal of s.informational) {
    if (hasSignal(queryNorm, signal)) return 'informational'
  }
  for (const signal of s.transactional) {
    if (hasSignal(queryNorm, signal)) return 'transactional'
  }
  return 'unknown'
}

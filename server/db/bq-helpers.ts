export function bqTimestampToISO(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  // BigQueryTimestamp { value: string } shape
  if (typeof v === 'object' && 'value' in v && typeof (v as { value: unknown }).value === 'string') {
    return (v as { value: string }).value
  }
  throw new Error(`Unsupported timestamp shape: ${typeof v} ${JSON.stringify(v)}`)
}

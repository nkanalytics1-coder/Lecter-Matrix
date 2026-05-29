import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
} from 'nuqs'
import {
  CannType,
  GroupStatus,
  Intent,
  SeverityBand,
} from '@/src/contracts/types/domain'

/**
 * nuqs parsers for GroupFilterSchema (T7).
 * Mirrors the zod schema field-for-field; do not add fields here that are not
 * in GroupFilterSchema — the zod schema is the source of truth.
 */
export const groupFilterParsers = {
  severityBand:  parseAsArrayOf(parseAsStringEnum([...SeverityBand])),
  severityMin:   parseAsInteger,
  cannType:      parseAsArrayOf(parseAsStringEnum([...CannType])),
  intent:        parseAsArrayOf(parseAsStringEnum([...Intent])),
  status:        parseAsArrayOf(parseAsStringEnum([...GroupStatus])),
  pathPrefix:    parseAsString,
  inversionOnly: parseAsBoolean,
  hideBenign:    parseAsBoolean,
  q:             parseAsString,
} as const

/**
 * nuqs parsers for GroupListQuerySchema (T7) — extends groupFilterParsers
 * with pagination/sort fields.
 */
export const groupListQueryParsers = {
  ...groupFilterParsers,
  limit:  parseAsInteger.withDefault(50),
  cursor: parseAsString,
  sort:   parseAsString.withDefault('severity:desc'),
} as const

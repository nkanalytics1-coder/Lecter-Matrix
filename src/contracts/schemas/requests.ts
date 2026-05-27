import { z } from 'zod'
import {
  CannType,
  GroupStatus,
  Intent,
  PropertyType,
  SeverityBand,
} from '../types/domain'

/**
 * Accepts a CSV string ("a,b,c") or a repeated-param array (["a","b"]).
 * Splits on commas, trims whitespace, drops empty segments, then validates
 * every element against the supplied enum values.
 */
function csvEnum<T extends string>(values: readonly [T, ...T[]]) {
  return z.preprocess(
    (val) => {
      if (val === undefined) return undefined
      if (Array.isArray(val)) {
        return (val as unknown[]).flatMap(v =>
          typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : [],
        )
      }
      if (typeof val === 'string') {
        return val.split(',').map(s => s.trim()).filter(Boolean)
      }
      return val
    },
    z.array(z.enum(values)).optional(),
  )
}

// ── Projects ──────────────────────────────────────────────────────────────────

export const CreateProjectSchema = z.object({
  name:         z.string().min(1).max(200),
  gscProperty:  z.string().min(3).max(255),
  propertyType: z.enum(PropertyType),
  timezone:     z.string().optional(),
})
export type CreateProject = z.infer<typeof CreateProjectSchema>

export const UpdateProjectSchema = z
  .object({
    name:     z.string().min(1).max(200).optional(),
    timezone: z.string().optional(),
    status:   z.enum(['active', 'paused'] as const).optional(),
    config:   z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (d) => Object.values(d).some(v => v !== undefined),
    { message: 'At least one field must be provided' },
  )
export type UpdateProject = z.infer<typeof UpdateProjectSchema>

// ── GSC ───────────────────────────────────────────────────────────────────────

export const GscConnectSchema = z.object({
  code:        z.string().min(10),
  redirectUri: z.string().url(),
})
export type GscConnect = z.infer<typeof GscConnectSchema>

// ── Sync / Detect ─────────────────────────────────────────────────────────────

export const SyncSchema = z.object({
  mode:         z.enum(['backfill', 'incremental'] as const).default('incremental'),
  backfillDays: z.coerce.number().int().min(1).max(480).optional(),
})
export type Sync = z.infer<typeof SyncSchema>

export const DetectSchema = z
  .object({
    windowStart: z.string().date().optional(),
    windowEnd:   z.string().date().optional(),
  })
  .refine(
    (d) => {
      if (d.windowStart !== undefined && d.windowEnd !== undefined) {
        return d.windowStart <= d.windowEnd
      }
      return true
    },
    { message: 'windowStart must be ≤ windowEnd', path: ['windowEnd'] },
  )
export type Detect = z.infer<typeof DetectSchema>

// ── Group state ───────────────────────────────────────────────────────────────

export const UpdateGroupStateSchema = z
  .object({
    status: z.enum(GroupStatus).optional(),
    notes:  z.string().nullable().optional(),
  })
  .refine(
    (d) => d.status !== undefined || d.notes !== undefined,
    { message: 'At least one field must be provided' },
  )
export type UpdateGroupState = z.infer<typeof UpdateGroupStateSchema>

// ── Filters / list query ──────────────────────────────────────────────────────

export const GroupFilterSchema = z.object({
  severityBand:  csvEnum(SeverityBand),
  severityMin:   z.coerce.number().min(0).max(100).optional(),
  cannType:      csvEnum(CannType),
  intent:        csvEnum(Intent),
  status:        csvEnum(GroupStatus),
  pathPrefix:    z.string().optional(),
  inversionOnly: z.coerce.boolean().optional(),
  hideBenign:    z.coerce.boolean().optional(),
  q:             z.string().optional(),
})
export type GroupFilter = z.infer<typeof GroupFilterSchema>

export const GroupListQuerySchema = GroupFilterSchema.extend({
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  sort:   z
    .string()
    .regex(/^(severity|impressions|lostClicks):(asc|desc)$/)
    .default('severity:desc'),
})
export type GroupListQuery = z.infer<typeof GroupListQuerySchema>

import { z } from 'zod'

export const ProjectConfigSchema = z.object({
  intent_signals_extra:     z.array(z.string()).optional(),
  brand_terms:              z.array(z.string()).optional(),
  min_members:              z.number().int().min(2).max(10).optional(),
  min_group_impressions:    z.number().int().min(0).optional(),
  min_member_impressions:   z.number().int().min(0).optional(),
  max_members:              z.number().int().min(2).max(20).optional(),
  slug_jaccard_consolidate: z.number().min(0).max(1).optional(),
})

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>

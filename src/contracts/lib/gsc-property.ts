import type { PropertyType } from '../types/domain'

// GSC site URIs come in two shapes:
//   - Domain properties:     "sc-domain:example.com"      → PropertyType 'domain'
//   - URL-prefix properties: "https://www.example.com/"   → PropertyType 'url_prefix'
const DOMAIN_PREFIX = 'sc-domain:'

/**
 * Derive the PropertyType from a GSC site URI. Pure and deterministic — used by
 * the onboarding wizard after the operator picks a property from sites.list.
 */
export function derivePropertyType(siteUrl: string): PropertyType {
  return siteUrl.startsWith(DOMAIN_PREFIX) ? 'domain' : 'url_prefix'
}

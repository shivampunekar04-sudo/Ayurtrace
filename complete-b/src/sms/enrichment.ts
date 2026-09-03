/**
 * Request enrichment for Tier-3 SMS (component 1).
 *
 * The frozen `CollectionRequest` requires `season` and `plantPart`, but the SMS grammar
 * carries neither. Rather than add contract fields, the gateway FILLS them server-side:
 *   - plantPart  → the species' GACP-permitted part (chaincode still validates it).
 *   - season     → resolved from the event date via a season calendar.
 *
 * HONESTY TAG: 🟢 BUILT (pure); the defaults themselves are 🔵 DESIGNED reference data —
 * the season boundaries and per-species canonical parts need NMPB confirmation.
 * [ASSUMPTION] tags mark values needing a real source.
 */

import { SEASON_WINDOWS, SPECIES_DEFAULT_PART } from '../policy/policy.js';

export { SPECIES_DEFAULT_PART };

/** Resolve a default plant part; falls back to 'WHOLE' if the species is unknown here. */
export function defaultPlantPart(speciesCode: string): string {
  return SPECIES_DEFAULT_PART[speciesCode.toUpperCase()] ?? 'WHOLE';
}

/**
 * Resolve the harvest season from a date, using the governed season windows in policy.ts.
 * (PENDING: NMPB per-species harvest windows should replace the placeholder calendar.)
 */
export function resolveSeason(date: Date): 'RABI' | 'KHARIF' | 'ZAID' {
  const m = date.getMonth() + 1; // 1..12
  const w = SEASON_WINDOWS.value;
  if (w.KHARIF.includes(m)) return 'KHARIF';
  if (w.ZAID.includes(m)) return 'ZAID';
  return 'RABI';
}

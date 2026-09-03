/**
 * WHO / AYUSH reference limits for CP-5 lab checks.
 *
 * HONESTY TAG: 🔵 DESIGNED reference data. These are the commonly cited WHO/AYUSH
 * ceilings for Ayurvedic raw material (heavy metals in mg/kg = ppm; moisture as %;
 * pesticide as an aggregate mg/kg placeholder). They are used ONLY as a sanity
 * cross-check: the authoritative per-batch limit is the `limit` field carried on
 * each frozen-contract `QualityMetric`. If a submitted metric's limit is more
 * lenient than the reference here, CP-5 flags it (a config/tamper guard) but still
 * enforces against the stricter of the two.
 *
 * Sources to confirm before any real-world use:
 *   - WHO "Quality control methods for medicinal plant materials"
 *   - AYUSH / API (Ayurvedic Pharmacopoeia of India) heavy-metal limits
 *   - [ASSUMPTION] pesticide aggregate ceiling is a placeholder pending an
 *     analyte-specific MRL table; NMPB/AYUSH policy number needed.
 */
import type { QualityMetric } from '../../contracts/index.js';
import {
  HEAVY_METAL_LIMITS,
  MOISTURE_LIMIT,
  PESTICIDE_AGGREGATE_LIMIT,
} from '../policy/policy.js';

export type MetricName = QualityMetric['name'];

export interface ReferenceLimit {
  /** Inclusive maximum permitted value. */
  max: number;
  unit: string;
  note: string;
}

/** Derived from the governed policy source (src/policy/policy.ts) — one place to change. */
export const WHO_AYUSH_REFERENCE_LIMITS: Record<MetricName, ReferenceLimit> = {
  moisture: { max: MOISTURE_LIMIT.value, unit: MOISTURE_LIMIT.unit ?? '%', note: MOISTURE_LIMIT.source },
  lead: { max: HEAVY_METAL_LIMITS.lead.value, unit: 'mg/kg', note: HEAVY_METAL_LIMITS.lead.source },
  arsenic: { max: HEAVY_METAL_LIMITS.arsenic.value, unit: 'mg/kg', note: HEAVY_METAL_LIMITS.arsenic.source },
  mercury: { max: HEAVY_METAL_LIMITS.mercury.value, unit: 'mg/kg', note: HEAVY_METAL_LIMITS.mercury.source },
  cadmium: { max: HEAVY_METAL_LIMITS.cadmium.value, unit: 'mg/kg', note: HEAVY_METAL_LIMITS.cadmium.source },
  pesticide: { max: PESTICIDE_AGGREGATE_LIMIT.value, unit: 'mg/kg', note: PESTICIDE_AGGREGATE_LIMIT.source },
};

/** The metrics CP-5 requires to be present before it can clear a batch. */
export const CP5_REQUIRED_METRICS: readonly MetricName[] = [
  'moisture',
  'lead',
  'arsenic',
  'mercury',
  'cadmium',
  'pesticide',
] as const;

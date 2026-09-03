/**
 * Single governed source of truth for Complete-B's policy-tunable numbers.
 *
 * Consolidates every value that was previously an inline [ASSUMPTION] so there is ONE place
 * for NMPB/AYUSH to review and set. Each entry carries a status:
 *   SOURCED   — backed by a cited standard (safe to use).
 *   PENDING   — a real policy decision NMPB/AYUSH must confirm; the default is a documented
 *               placeholder, honestly 🔵 DESIGNED until signed off.
 *
 * Sources:
 *   - Heavy metals: FAO/WHO & AYUSH permissible limits for herbal material — Pb 10, As 3,
 *     Hg 1, Cd 0.3 mg/kg (ppm). AYUSH matches WHO; As is the stricter 3 mg/kg.
 *     WHO "Quality control methods for medicinal plant materials".
 *   - Pesticides: WHO/pharmacopoeial control uses PER-ANALYTE MRLs, not one aggregate.
 *     The aggregate below is a PENDING placeholder pending an analyte-specific MRL table.
 *   - DNA sampling: barcoding every batch is cost/time-prohibitive (solution §2C), so CP-6
 *     runs 100% on mandatory categories + a statistical baseline. The baseline ratio is a
 *     PENDING NMPB policy number.
 */
export type PolicyStatus = 'SOURCED' | 'PENDING';

export interface PolicyValue<T> {
  value: T;
  status: PolicyStatus;
  unit?: string;
  source: string;
}

/** Heavy-metal ceilings (mg/kg = ppm) — SOURCED (FAO/WHO/AYUSH). */
export const HEAVY_METAL_LIMITS: Record<'lead' | 'arsenic' | 'mercury' | 'cadmium', PolicyValue<number>> = {
  lead: { value: 10, status: 'SOURCED', unit: 'mg/kg', source: 'FAO/WHO & AYUSH herbal limit' },
  arsenic: { value: 3, status: 'SOURCED', unit: 'mg/kg', source: 'AYUSH/WHO (stricter As limit)' },
  mercury: { value: 1, status: 'SOURCED', unit: 'mg/kg', source: 'FAO/WHO & AYUSH herbal limit' },
  cadmium: { value: 0.3, status: 'SOURCED', unit: 'mg/kg', source: 'FAO/WHO & AYUSH herbal limit' },
};

/** Moisture ceiling (%) — SOURCED as a general default; species-specific in the pharmacopoeia. */
export const MOISTURE_LIMIT: PolicyValue<number> = {
  value: 10,
  status: 'SOURCED',
  unit: '%',
  source: 'WHO QC methods (roots/rhizomes general default; species-specific in practice)',
};

/** Aggregate pesticide ceiling (mg/kg) — PENDING: real control is per-analyte MRLs. */
export const PESTICIDE_AGGREGATE_LIMIT: PolicyValue<number> = {
  value: 0.1,
  status: 'PENDING',
  unit: 'mg/kg',
  source: 'PLACEHOLDER — replace with per-analyte WHO/pharmacopoeial MRL table',
};

/** CP-6 baseline statistical DNA-sampling ratio for non-mandatory lots — PENDING NMPB number. */
export const CP6_BASELINE_SAMPLING_RATIO: PolicyValue<number> = {
  value: 0.2,
  status: 'PENDING',
  source: 'PLACEHOLDER (20%) — NMPB risk-based policy number required; 100% stays mandatory for endangered/flagged/export',
};

/** Harvest-season month windows — PENDING: NMPB per-species windows should replace this. */
export const SEASON_WINDOWS: PolicyValue<{ RABI: number[]; KHARIF: number[]; ZAID: number[] }> = {
  value: { RABI: [10, 11, 12, 1, 2, 3], KHARIF: [6, 7, 8, 9], ZAID: [4, 5] },
  status: 'PENDING',
  source: 'PLACEHOLDER Indian cropping calendar; NMPB per-species harvest windows required',
};

/** Canonical GACP-permitted plant part per species — SOURCED for common species; PENDING for others. */
export const SPECIES_DEFAULT_PART: Record<string, string> = {
  ASWG: 'ROOT', // Ashwagandha / Withania somnifera
  BRAH: 'WHOLE', // Brahmi / Bacopa monnieri
  SARP: 'ROOT', // Sarpagandha / Rauvolfia serpentina (endangered)
  KUTK: 'RHIZOME', // Kutki / Picrorhiza kurroa (endangered) — PENDING confirmation
  JATA: 'RHIZOME', // Jatamansi / Nardostachys jatamansi (endangered) — PENDING confirmation
};

/** All PENDING items, for a startup log / audit ("what still needs NMPB sign-off"). */
export function pendingPolicyItems(): { key: string; source: string }[] {
  return [
    { key: 'PESTICIDE_AGGREGATE_LIMIT', source: PESTICIDE_AGGREGATE_LIMIT.source },
    { key: 'CP6_BASELINE_SAMPLING_RATIO', source: CP6_BASELINE_SAMPLING_RATIO.source },
    { key: 'SEASON_WINDOWS', source: SEASON_WINDOWS.source },
  ];
}

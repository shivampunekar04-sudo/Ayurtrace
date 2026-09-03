/**
 * Deterministic AyurTrace seed (execution plan §3, §6.5, Phase 0).
 * 5 species (incl. Ashwagandha), 3 non-overlapping approved zones with GeoJSON,
 * per-(species,zone,season) quotas, 4 collectors. The pilot herb is Ashwagandha.
 *
 * Determinism matters: `reset-demo` re-seeds from this so every dry run is identical.
 */
import type { SpeciesRule, Zone, Collector, Quota } from '@ayurtrace/contracts';

export const SPECIES: SpeciesRule[] = [
  { code: 'ASWG', botanicalName: 'Withania somnifera', commonName: 'Ashwagandha', allowedParts: ['ROOT'], allowedSeasons: ['RABI'], endangered: false },
  { code: 'BRAH', botanicalName: 'Bacopa monnieri', commonName: 'Brahmi', allowedParts: ['WHOLE_PLANT', 'LEAF'], allowedSeasons: ['KHARIF', 'RABI'], endangered: false },
  { code: 'SARP', botanicalName: 'Rauvolfia serpentina', commonName: 'Sarpagandha', allowedParts: ['ROOT'], allowedSeasons: ['RABI'], endangered: true },
  { code: 'KUTK', botanicalName: 'Picrorhiza kurroa', commonName: 'Kutki', allowedParts: ['RHIZOME', 'ROOT'], allowedSeasons: ['POST_MONSOON'], endangered: true },
  { code: 'JATA', botanicalName: 'Nardostachys jatamansi', commonName: 'Jatamansi', allowedParts: ['RHIZOME'], allowedSeasons: ['POST_MONSOON'], endangered: true },
];

// Non-overlapping polygons (closed rings, [lon, lat]) so point-in-polygon resolves one zone.
export const ZONES: Zone[] = [
  {
    id: 'NMPB-KA-ZONE-07', name: 'Tumakuru Cultivation Belt (Zone 7)',
    polygon: [[77.0, 13.2], [77.2, 13.2], [77.2, 13.5], [77.0, 13.5], [77.0, 13.2]],
  },
  {
    id: 'NMPB-KA-ZONE-09', name: 'Chikkamagaluru Foothills (Zone 9)',
    polygon: [[75.6, 13.2], [75.9, 13.2], [75.9, 13.5], [75.6, 13.5], [75.6, 13.2]],
  },
  {
    id: 'NMPB-KA-ZONE-13', name: 'Western Ghats Wild Collection (Zone 13, endangered)',
    polygon: [[74.9, 12.7], [75.2, 12.7], [75.2, 13.0], [74.9, 13.0], [74.9, 12.7]],
  },
];

export const COLLECTORS: Collector[] = [
  { id: 'NMPB-COL-KA-8823', cluster: 'CLUSTER-TUMKUR-04', licenseActive: true, licenseExpiry: '2027-12-31' },
  { id: 'NMPB-COL-KA-9910', cluster: 'CLUSTER-CHIK-02', licenseActive: true, licenseExpiry: '2027-12-31' },
  { id: 'NMPB-COL-KA-7745', cluster: 'CLUSTER-TUMKUR-04', licenseActive: true, licenseExpiry: '2027-12-31' },
  { id: 'NMPB-COL-KA-3321', cluster: 'CLUSTER-GHATS-01', licenseActive: false, licenseExpiry: '2024-06-30' }, // expired: demonstrates LICENSE_INVALID
];

export const QUOTAS: Quota[] = [
  { speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-07', season: 'RABI', annualLimitKg: 312, consumedKg: 220 }, // ~70% → AMBER
  { speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-09', season: 'RABI', annualLimitKg: 260, consumedKg: 30 },  // ~12% → GREEN
  { speciesCode: 'BRAH', zoneId: 'NMPB-KA-ZONE-09', season: 'RABI', annualLimitKg: 180, consumedKg: 150 }, // ~83% → RED
  { speciesCode: 'SARP', zoneId: 'NMPB-KA-ZONE-13', season: 'RABI', annualLimitKg: 40, consumedKg: 38 },   // endangered, near cap
];

export interface SeedRefs {
  species: SpeciesRule[];
  zones: Zone[];
  collectors: Collector[];
  quotas: Quota[];
}

/** Fresh, deep-cloned reference data so a reset never mutates the source constants. */
export function seedRefs(): SeedRefs {
  return {
    species: structuredClone(SPECIES),
    zones: structuredClone(ZONES),
    collectors: structuredClone(COLLECTORS),
    quotas: structuredClone(QUOTAS),
  };
}

/** Point known to be inside a given zone, for demo collection submissions. */
export const DEMO_POINTS = {
  zone07: { lat: 13.3409, lon: 77.1018, altitudeM: 842 },
  zone09: { lat: 13.3401, lon: 75.7700, altitudeM: 910 },
  zone13: { lat: 12.8500, lon: 75.0500, altitudeM: 1180 },
  outside: { lat: 19.0760, lon: 72.8777, altitudeM: 14 }, // Mumbai — no approved zone → ZONE_VIOLATION
} as const;

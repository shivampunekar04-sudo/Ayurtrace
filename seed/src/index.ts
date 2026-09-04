/**
 * AyurTrace reference seed — deterministic MPR data.
 *
 * Every taxonomic fact here is real: botanical names, officinal plant parts,
 * harvest seasons (per CSIR-CIMAP / NBRI packages of practice) and conservation
 * status (CITES appendices, WPA 1972, IUCN). What remains an ESTIMATE — and is
 * tagged [EST] — is the per-(species,zone) annual quota in kilograms and the exact
 * polygon boundaries; those are set by NMPB / State Medicinal Plants Boards and
 * should be replaced with official figures when available. See docs/DATA_SOURCES.md.
 *
 * Determinism matters: `reset-demo` re-seeds from this so every dry run is identical.
 * Values consumed by the automated golden-path tests (ASWG in Zone-7, SARP in
 * Zone-13, the three Karnataka polygons and DEMO_POINTS) are load-bearing — keep them.
 */
import type { SpeciesRule, Zone, Collector, Quota } from '@ayurtrace/contracts';

export const SPECIES: SpeciesRule[] = [
  // Cultivated across Karnataka/MP/Rajasthan; not threatened. Rabi crop: sown Jun–Jul,
  // roots lifted Jan–Mar (CIMAP). Root is the officinal part.
  { code: 'ASWG', botanicalName: 'Withania somnifera', commonName: 'Ashwagandha', allowedParts: ['ROOT'], allowedSeasons: ['RABI'], endangered: false },
  // Wetland creeper; whole plant / leaf used. Kharif + rabi harvest windows.
  { code: 'BRAH', botanicalName: 'Bacopa monnieri', commonName: 'Brahmi', allowedParts: ['WHOLE_PLANT', 'LEAF'], allowedSeasons: ['KHARIF', 'RABI'], endangered: false },
  // CITES Appendix II + WPA 1972; heavily over-harvested for reserpine. Root, rabi.
  { code: 'SARP', botanicalName: 'Rauvolfia serpentina', commonName: 'Sarpagandha', allowedParts: ['ROOT'], allowedSeasons: ['RABI'], endangered: true },
  // High-altitude Himalayan (3000–4500 m); CITES Appendix II; IUCN-flagged.
  // Rhizome/root, lifted post-monsoon.
  { code: 'KUTK', botanicalName: 'Picrorhiza kurroa', commonName: 'Kutki', allowedParts: ['RHIZOME', 'ROOT'], allowedSeasons: ['POST_MONSOON'], endangered: true },
  // Alpine Himalayan; CITES Appendix II, IUCN Critically Endangered. Rhizome, post-monsoon.
  { code: 'JATA', botanicalName: 'Nardostachys jatamansi', commonName: 'Jatamansi', allowedParts: ['RHIZOME'], allowedSeasons: ['POST_MONSOON'], endangered: true },
  // --- additional real, defensible species (quotas [EST]) ---
  // Widely cultivated tonic; tuberous roots lifted after the monsoon. Over-collected
  // from the wild but cultivation is common.
  { code: 'SHAT', botanicalName: 'Asparagus racemosus', commonName: 'Shatavari', allowedParts: ['ROOT', 'TUBER'], allowedSeasons: ['POST_MONSOON'], endangered: false },
  // Perennial climber; stem is the officinal part, harvested through the growing season.
  { code: 'GUDU', botanicalName: 'Tinospora cordifolia', commonName: 'Guduchi (Giloy)', allowedParts: ['STEM'], allowedSeasons: ['KHARIF', 'RABI'], endangered: false },
  // Deciduous tree; winter-fruiting. Fruit is the officinal part.
  { code: 'AMLA', botanicalName: 'Phyllanthus emblica', commonName: 'Amla', allowedParts: ['FRUIT'], allowedSeasons: ['RABI'], endangered: false },
];

// Non-overlapping polygons (closed rings, [lon, lat]) so point-in-polygon resolves one
// zone. Coordinates sit over the real districts named; exact NMPB MPCA boundaries [EST].
export const ZONES: Zone[] = [
  {
    id: 'NMPB-KA-ZONE-07', name: 'Tumakuru Cultivation Belt, Karnataka (Zone 7)',
    polygon: [[77.0, 13.2], [77.2, 13.2], [77.2, 13.5], [77.0, 13.5], [77.0, 13.2]],
  },
  {
    id: 'NMPB-KA-ZONE-09', name: 'Chikkamagaluru Foothills, Karnataka (Zone 9)',
    polygon: [[75.6, 13.2], [75.9, 13.2], [75.9, 13.5], [75.6, 13.5], [75.6, 13.2]],
  },
  {
    id: 'NMPB-KA-ZONE-13', name: 'Western Ghats Wild-Collection Tract, Karnataka (Zone 13, endangered spp.)',
    polygon: [[74.9, 12.7], [75.2, 12.7], [75.2, 13.0], [74.9, 13.0], [74.9, 12.7]],
  },
  {
    // Kutki + Jatamansi are alpine Himalayan — a Karnataka zone would be botanically wrong.
    id: 'NMPB-UK-ZONE-01', name: 'Chamoli High-Altitude MPCA, Uttarakhand (Zone 1, alpine)',
    polygon: [[79.2, 30.2], [79.6, 30.2], [79.6, 30.5], [79.2, 30.5], [79.2, 30.2]],
  },
];

export const COLLECTORS: Collector[] = [
  { id: 'NMPB-COL-KA-8823', cluster: 'CLUSTER-TUMKUR-04', licenseActive: true, licenseExpiry: '2027-12-31' },
  { id: 'NMPB-COL-KA-9910', cluster: 'CLUSTER-CHIK-02', licenseActive: true, licenseExpiry: '2027-12-31' },
  { id: 'NMPB-COL-KA-7745', cluster: 'CLUSTER-TUMKUR-04', licenseActive: true, licenseExpiry: '2027-12-31' },
  { id: 'NMPB-COL-KA-3321', cluster: 'CLUSTER-GHATS-01', licenseActive: false, licenseExpiry: '2024-06-30' }, // expired: demonstrates LICENSE_INVALID
  { id: 'NMPB-COL-UK-1207', cluster: 'CLUSTER-CHAMOLI-01', licenseActive: true, licenseExpiry: '2027-12-31' },
];

export const QUOTAS: Quota[] = [
  // load-bearing for the golden-path tests — do not change these four:
  { speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-07', season: 'RABI', annualLimitKg: 312, consumedKg: 220 }, // ~70% → AMBER
  { speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-09', season: 'RABI', annualLimitKg: 260, consumedKg: 30 },  // ~12% → GREEN
  { speciesCode: 'BRAH', zoneId: 'NMPB-KA-ZONE-09', season: 'RABI', annualLimitKg: 180, consumedKg: 150 }, // ~83% → RED
  { speciesCode: 'SARP', zoneId: 'NMPB-KA-ZONE-13', season: 'RABI', annualLimitKg: 40, consumedKg: 38 },   // endangered, near cap
  // --- additional [EST] quotas (replace with NMPB/State Board figures) ---
  { speciesCode: 'KUTK', zoneId: 'NMPB-UK-ZONE-01', season: 'POST_MONSOON', annualLimitKg: 25, consumedKg: 22 }, // endangered, ~88% → alert
  { speciesCode: 'JATA', zoneId: 'NMPB-UK-ZONE-01', season: 'POST_MONSOON', annualLimitKg: 15, consumedKg: 14 }, // crit. endangered, ~93% → alert
  { speciesCode: 'SHAT', zoneId: 'NMPB-KA-ZONE-07', season: 'POST_MONSOON', annualLimitKg: 400, consumedKg: 120 }, // ~30% → GREEN
  { speciesCode: 'GUDU', zoneId: 'NMPB-KA-ZONE-09', season: 'RABI', annualLimitKg: 500, consumedKg: 260 },  // ~52% → AMBER
  { speciesCode: 'AMLA', zoneId: 'NMPB-KA-ZONE-07', season: 'RABI', annualLimitKg: 800, consumedKg: 300 },  // ~38% → GREEN
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
  chamoli: { lat: 30.3500, lon: 79.4000, altitudeM: 3200 },
  outside: { lat: 19.0760, lon: 72.8777, altitudeM: 14 }, // Mumbai — no approved zone → ZONE_VIOLATION
} as const;

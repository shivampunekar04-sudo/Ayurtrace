/**
 * Analytics feedback loop (component 5, solution §3E).
 *
 * HONESTY TAG: 🟢 BUILT — pure, deterministic aggregation over anonymized inputs,
 * unit-tested. Read-only with respect to the ledger: it consumes the §6.4 read shapes
 * (`Zone`, `Quota`/`ZoneQuotaResponse`, `SpeciesRule`) plus an anonymized scan feed and
 * emits signals. It never writes, and it adds no contract fields.
 *
 * Four signals:
 *   1. Premium-price — cluster engagement (scans per product) → premium eligibility.
 *   2. Recall geo-targeting — where a recalled product was actually scanned.
 *   3. Cultivation-demand — scan demand vs quota band → NMPB expand/hold guidance.
 *   4. Conservation — harvest pressure on endangered species → CSIR-NBRI input.
 *
 * PRIVACY (spec §5): the scan feed carries NO PII by construction — no consumer id, no
 * device id, no precise coordinates (zone-level only). On top of that, any group that
 * could re-identify a small population (per-cluster, per-region) is SUPPRESSED below a
 * k-anonymity threshold. Sparse groups are dropped, not published.
 */
import type {
  Quota,
  SpeciesRule,
  ZoneQuotaResponse,
} from '../../contracts/index.js';

/**
 * An anonymized consumer scan. Deliberately excludes any identifier that could link a
 * scan to an individual; location is zone-level, region is a coarse bucket.
 */
export interface ScanEvent {
  productEpc: string;
  zoneId: string;
  /** Originating collector cluster (for the premium-price signal). */
  clusterId: string;
  speciesCode: string;
  scannedAtMs: number;
  /** Coarse consumer region bucket (for recall geo-targeting). */
  region: string;
}

export interface AnalyticsOptions {
  /** Minimum group size to publish a re-identifying (cluster/region) stat. Default 5. */
  kAnonymity?: number;
  /** Scans-per-product at/above which a cluster is premium-eligible. Default 3. */
  premiumEngagementThreshold?: number;
  /** Scan count at/above which species demand counts as "high". Default 10. */
  highDemandThreshold?: number;
}

export interface ClusterEngagementSignal {
  clusterId: string;
  scans: number;
  distinctProducts: number;
  scansPerProduct: number;
  premiumEligible: boolean;
}

export interface RecallGeoTarget {
  region: string;
  scans: number;
}

export type DemandRecommendation = 'EXPAND_CULTIVATION' | 'HOLD' | 'MONITOR';

export interface SpeciesDemandSignal {
  speciesCode: string;
  zoneId: string;
  scanDemand: number;
  quotaBand: 'GREEN' | 'AMBER' | 'RED';
  consumedPct: number;
  recommendation: DemandRecommendation;
}

export type ConservationPressure = 'HIGH' | 'MODERATE' | 'LOW';

export interface ConservationSignal {
  speciesCode: string;
  zoneId: string;
  endangered: boolean;
  consumedPct: number;
  pressure: ConservationPressure;
}

export interface AnalyticsReport {
  clusterEngagement: ClusterEngagementSignal[];
  speciesDemand: SpeciesDemandSignal[];
  conservation: ConservationSignal[];
  /** Groups suppressed for k-anonymity, for an auditable "why is this empty" trail. */
  suppressed: { kind: 'cluster' | 'region'; key: string; count: number }[];
}

const DEFAULTS = {
  kAnonymity: 5,
  premiumEngagementThreshold: 3,
  highDemandThreshold: 10,
};

/** Premium-price signal: engaged clusters, k-anonymity suppressed. */
export function computeClusterEngagement(
  scans: ScanEvent[],
  options: AnalyticsOptions = {},
): { signals: ClusterEngagementSignal[]; suppressed: { key: string; count: number }[] } {
  const k = options.kAnonymity ?? DEFAULTS.kAnonymity;
  const threshold = options.premiumEngagementThreshold ?? DEFAULTS.premiumEngagementThreshold;

  const byCluster = new Map<string, { scans: number; products: Set<string> }>();
  for (const s of scans) {
    let g = byCluster.get(s.clusterId);
    if (!g) {
      g = { scans: 0, products: new Set() };
      byCluster.set(s.clusterId, g);
    }
    g.scans++;
    g.products.add(s.productEpc);
  }

  const signals: ClusterEngagementSignal[] = [];
  const suppressed: { key: string; count: number }[] = [];
  for (const [clusterId, g] of byCluster) {
    if (g.scans < k) {
      suppressed.push({ key: clusterId, count: g.scans });
      continue;
    }
    const distinctProducts = g.products.size;
    const scansPerProduct = distinctProducts === 0 ? 0 : g.scans / distinctProducts;
    signals.push({
      clusterId,
      scans: g.scans,
      distinctProducts,
      scansPerProduct,
      premiumEligible: scansPerProduct >= threshold,
    });
  }
  signals.sort((a, b) => b.scansPerProduct - a.scansPerProduct || a.clusterId.localeCompare(b.clusterId));
  return { signals, suppressed };
}

/** Recall geo-targeting: regions where recalled products were scanned, k-anon suppressed. */
export function computeRecallGeoTargets(
  scans: ScanEvent[],
  recalledEpcs: Iterable<string>,
  options: AnalyticsOptions = {},
): { targets: RecallGeoTarget[]; suppressed: { key: string; count: number }[] } {
  const k = options.kAnonymity ?? DEFAULTS.kAnonymity;
  const recalled = new Set(recalledEpcs);

  const byRegion = new Map<string, number>();
  for (const s of scans) {
    if (!recalled.has(s.productEpc)) continue;
    byRegion.set(s.region, (byRegion.get(s.region) ?? 0) + 1);
  }

  const targets: RecallGeoTarget[] = [];
  const suppressed: { key: string; count: number }[] = [];
  for (const [region, count] of byRegion) {
    if (count < k) suppressed.push({ key: region, count });
    else targets.push({ region, scans: count });
  }
  targets.sort((a, b) => b.scans - a.scans || a.region.localeCompare(b.region));
  return { targets, suppressed };
}

function bandOf(consumedPct: number): 'GREEN' | 'AMBER' | 'RED' {
  if (consumedPct > 80) return 'RED';
  if (consumedPct >= 50) return 'AMBER';
  return 'GREEN';
}

/** Cultivation-demand: scan demand per (species, zone) vs quota band → NMPB guidance. */
export function computeSpeciesDemand(
  scans: ScanEvent[],
  quotaResponses: ZoneQuotaResponse[],
  options: AnalyticsOptions = {},
): SpeciesDemandSignal[] {
  const highDemand = options.highDemandThreshold ?? DEFAULTS.highDemandThreshold;

  const demand = new Map<string, number>(); // `${species}~${zone}` → scans
  for (const s of scans) {
    const key = `${s.speciesCode}~${s.zoneId}`;
    demand.set(key, (demand.get(key) ?? 0) + 1);
  }

  const signals: SpeciesDemandSignal[] = [];
  for (const zr of quotaResponses) {
    for (const q of zr.quotas) {
      const scanDemand = demand.get(`${q.speciesCode}~${q.zoneId}`) ?? 0;
      const consumedPct = q.consumedPct ?? pctConsumed(q);
      const quotaBand = q.band ?? bandOf(consumedPct);
      const isHigh = scanDemand >= highDemand;
      let recommendation: DemandRecommendation;
      if (quotaBand === 'RED') recommendation = isHigh ? 'EXPAND_CULTIVATION' : 'HOLD';
      else recommendation = isHigh ? 'EXPAND_CULTIVATION' : 'MONITOR';
      signals.push({ speciesCode: q.speciesCode, zoneId: q.zoneId, scanDemand, quotaBand, consumedPct, recommendation });
    }
  }
  signals.sort((a, b) => b.scanDemand - a.scanDemand || a.speciesCode.localeCompare(b.speciesCode));
  return signals;
}

function pctConsumed(q: Quota): number {
  return q.annualLimitKg === 0 ? 0 : (q.consumedKg / q.annualLimitKg) * 100;
}

/** Conservation input: harvest pressure on endangered species per zone. */
export function computeConservation(
  quotaResponses: ZoneQuotaResponse[],
  speciesRules: SpeciesRule[],
): ConservationSignal[] {
  const endangeredByCode = new Map<string, boolean>();
  for (const r of speciesRules) endangeredByCode.set(r.code, r.endangered);

  const signals: ConservationSignal[] = [];
  for (const zr of quotaResponses) {
    for (const q of zr.quotas) {
      const endangered = endangeredByCode.get(q.speciesCode) ?? false;
      const consumedPct = q.consumedPct ?? pctConsumed(q);
      let pressure: ConservationPressure;
      if (consumedPct > 80) pressure = 'HIGH';
      else if (consumedPct >= 50) pressure = 'MODERATE';
      else pressure = 'LOW';
      signals.push({ speciesCode: q.speciesCode, zoneId: q.zoneId, endangered, consumedPct, pressure });
    }
  }
  // Surface endangered + high-pressure first.
  signals.sort((a, b) => {
    if (a.endangered !== b.endangered) return a.endangered ? -1 : 1;
    return b.consumedPct - a.consumedPct;
  });
  return signals;
}

/** Run the full analytics pass over a dataset. */
export function runAnalytics(
  input: {
    scans: ScanEvent[];
    quotaResponses?: ZoneQuotaResponse[];
    speciesRules?: SpeciesRule[];
  },
  options: AnalyticsOptions = {},
): AnalyticsReport {
  const quotaResponses = input.quotaResponses ?? [];
  const speciesRules = input.speciesRules ?? [];

  const engagement = computeClusterEngagement(input.scans, options);
  const speciesDemand = computeSpeciesDemand(input.scans, quotaResponses, options);
  const conservation = computeConservation(quotaResponses, speciesRules);

  return {
    clusterEngagement: engagement.signals,
    speciesDemand,
    conservation,
    suppressed: engagement.suppressed.map((s) => ({ kind: 'cluster' as const, key: s.key, count: s.count })),
  };
}

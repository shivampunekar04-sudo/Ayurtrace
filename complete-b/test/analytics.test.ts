import { describe, it, expect } from 'vitest';
import {
  computeClusterEngagement,
  computeRecallGeoTargets,
  computeSpeciesDemand,
  computeConservation,
  runAnalytics,
  type ScanEvent,
} from '../src/analytics/analytics.js';
import type { SpeciesRule, ZoneQuotaResponse } from '../contracts/index.js';

let seq = 0;
const scan = (over: Partial<ScanEvent> = {}): ScanEvent => ({
  productEpc: 'PROD-1',
  zoneId: 'NMPB-KA-ZONE-07',
  clusterId: 'CLUSTER-TUMKUR-04',
  speciesCode: 'ASWG',
  scannedAtMs: 1_700_000_000_000 + seq++,
  region: 'KA-SOUTH',
  ...over,
});

/** n scans for a cluster spread across `products` distinct product EPCs. */
function scansFor(clusterId: string, n: number, products: number, region = 'KA-SOUTH'): ScanEvent[] {
  return Array.from({ length: n }, (_, i) =>
    scan({ clusterId, productEpc: `${clusterId}-P${i % products}`, region }),
  );
}

describe('cluster engagement (premium signal) + k-anonymity', () => {
  it('suppresses a cluster below the k-anonymity threshold', () => {
    const { signals, suppressed } = computeClusterEngagement(scansFor('C-SMALL', 3, 3), { kAnonymity: 5 });
    expect(signals).toHaveLength(0);
    expect(suppressed).toContainEqual({ key: 'C-SMALL', count: 3 });
  });

  it('marks a high-engagement cluster premium-eligible', () => {
    // 9 scans over 3 products → 3 scans/product ≥ threshold 3.
    const { signals } = computeClusterEngagement(scansFor('C-HOT', 9, 3), { kAnonymity: 5, premiumEngagementThreshold: 3 });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ clusterId: 'C-HOT', premiumEligible: true, scansPerProduct: 3 });
  });

  it('does not mark a low-engagement (but populous) cluster premium-eligible', () => {
    // 8 scans over 8 products → 1 scan/product < threshold 3.
    const { signals } = computeClusterEngagement(scansFor('C-FLAT', 8, 8), { kAnonymity: 5, premiumEngagementThreshold: 3 });
    expect(signals[0]).toMatchObject({ clusterId: 'C-FLAT', premiumEligible: false });
  });
});

describe('recall geo-targeting', () => {
  it('reports regions where a recalled product was scanned, above k', () => {
    const scans = [
      ...Array.from({ length: 6 }, () => scan({ productEpc: 'BAD', region: 'KA-SOUTH' })),
      ...Array.from({ length: 2 }, () => scan({ productEpc: 'BAD', region: 'KA-NORTH' })),
      scan({ productEpc: 'GOOD', region: 'KA-SOUTH' }),
    ];
    const { targets, suppressed } = computeRecallGeoTargets(scans, ['BAD'], { kAnonymity: 5 });
    expect(targets).toEqual([{ region: 'KA-SOUTH', scans: 6 }]);
    expect(suppressed).toContainEqual({ key: 'KA-NORTH', count: 2 }); // below k, suppressed
  });
});

const quotaResp = (over: Partial<ZoneQuotaResponse['quotas'][number]> = {}): ZoneQuotaResponse => ({
  zoneId: 'NMPB-KA-ZONE-07',
  quotas: [
    {
      speciesCode: 'ASWG',
      zoneId: 'NMPB-KA-ZONE-07',
      season: 'RABI',
      annualLimitKg: 312,
      consumedKg: 280,
      consumedPct: 89.7,
      band: 'RED',
      ...over,
    },
  ],
});

describe('species cultivation-demand', () => {
  it('recommends EXPAND_CULTIVATION when demand is high and quota band is RED', () => {
    const scans = Array.from({ length: 12 }, () => scan({ speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-07' }));
    const signals = computeSpeciesDemand(scans, [quotaResp()], { highDemandThreshold: 10 });
    expect(signals[0]).toMatchObject({ speciesCode: 'ASWG', recommendation: 'EXPAND_CULTIVATION' });
  });

  it('recommends HOLD when quota is RED but demand is low', () => {
    const signals = computeSpeciesDemand([], [quotaResp()], { highDemandThreshold: 10 });
    expect(signals[0]!.recommendation).toBe('HOLD');
  });

  it('recommends MONITOR for a GREEN band with low demand', () => {
    const green = quotaResp({ consumedKg: 40, consumedPct: 12.8, band: 'GREEN' });
    const signals = computeSpeciesDemand([], [green], { highDemandThreshold: 10 });
    expect(signals[0]!.recommendation).toBe('MONITOR');
  });
});

describe('conservation input', () => {
  const rules: SpeciesRule[] = [
    { code: 'SARP', botanicalName: 'Rauvolfia serpentina', commonName: 'Sarpagandha', allowedParts: ['ROOT'], allowedSeasons: ['RABI'], endangered: true },
    { code: 'ASWG', botanicalName: 'Withania somnifera', commonName: 'Ashwagandha', allowedParts: ['ROOT'], allowedSeasons: ['RABI'], endangered: false },
  ];

  it('flags HIGH pressure on an endangered species near quota exhaustion, ranked first', () => {
    const qr: ZoneQuotaResponse = {
      zoneId: 'NMPB-KA-ZONE-13',
      quotas: [
        { speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-07', season: 'RABI', annualLimitKg: 312, consumedKg: 100, consumedPct: 32, band: 'GREEN' },
        { speciesCode: 'SARP', zoneId: 'NMPB-KA-ZONE-13', season: 'RABI', annualLimitKg: 40, consumedKg: 38, consumedPct: 95, band: 'RED' },
      ],
    };
    const signals = computeConservation([qr], rules);
    expect(signals[0]).toMatchObject({ speciesCode: 'SARP', endangered: true, pressure: 'HIGH' });
  });
});

describe('runAnalytics end-to-end', () => {
  it('produces all signal groups deterministically', () => {
    const scans = [...scansFor('C-HOT', 9, 3), ...scansFor('C-SMALL', 2, 2)];
    const report = runAnalytics(
      { scans, quotaResponses: [quotaResp()], speciesRules: [] },
      { kAnonymity: 5 },
    );
    expect(report.clusterEngagement.map((c) => c.clusterId)).toEqual(['C-HOT']);
    expect(report.suppressed).toContainEqual({ kind: 'cluster', key: 'C-SMALL', count: 2 });
    expect(report.speciesDemand).toHaveLength(1);
    // Deterministic: same input, same output.
    const again = runAnalytics({ scans, quotaResponses: [quotaResp()], speciesRules: [] }, { kAnonymity: 5 });
    expect(again).toEqual(report);
  });
});

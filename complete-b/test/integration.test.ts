/**
 * Integration — the 8 Complete-B components composed into one batch lifecycle.
 *
 * This proves the slices interlock: an SMS collection is parsed, authorized, and submitted;
 * PoLK corroborates it; the weighbridge aggregates it; CP-5/CP-6 gate the lab result;
 * RFC-3161 anchors the certificate; and analytics turns scans into signals. Every step uses
 * the REAL module (only the network submitter and the TSA transport are injected doubles,
 * exactly the boundary that stays SIMULATED in production).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { parseHerbSms } from '../src/sms/parser.js';
import {
  handleInboundSms,
  InMemoryDirectory,
  InMemoryIdempotencyStore,
  WindowRateLimiter,
  type CollectionSubmitter,
} from '../src/sms/gateway.js';
import { authorizeWrite, type Identity } from '../src/rbac/rbac.js';
import { evaluatePolk, capGacpScore, type PolkClaim, type PolkPeerVote } from '../src/polk/polk.js';
import { MockBroker } from '../src/weighbridge/broker.js';
import { Weighbridge } from '../src/weighbridge/weighbridge.js';
import { evaluateCp5 } from '../src/enforcement/cp5.js';
import { evaluateCp6 } from '../src/enforcement/cp6.js';
import { anchorTimestamp, encodeTstInfo, type TsaClient } from '../src/rfc3161/rfc3161.js';
import { runAnalytics, type ScanEvent } from '../src/analytics/analytics.js';
import { GacpStatus, type QualityMetric, type ZoneQuotaResponse } from '../contracts/index.js';

const T0 = 1_712_000_000_000;

const fullPanel = (): QualityMetric[] => [
  { name: 'moisture', value: 8, unit: '%', limit: 10, withinLimit: true },
  { name: 'lead', value: 2, unit: 'mg/kg', limit: 10, withinLimit: true },
  { name: 'arsenic', value: 1, unit: 'mg/kg', limit: 3, withinLimit: true },
  { name: 'mercury', value: 0.2, unit: 'mg/kg', limit: 1, withinLimit: true },
  { name: 'cadmium', value: 0.1, unit: 'mg/kg', limit: 0.3, withinLimit: true },
  { name: 'pesticide', value: 0.02, unit: 'mg/kg', limit: 0.1, withinLimit: true },
];

const collectorSubmitter = (epc: string): CollectionSubmitter => ({
  async submit() {
    return { ok: true, data: { epc, txId: 'tx-int-1', gacpScore: 40 } };
  },
});

describe('Complete-B end-to-end golden path', () => {
  it('carries an SMS collection all the way to a passing, anchored, analyzed batch', async () => {
    const epc = 'urn:ayurtrace:lot:CE-KA-ASWG-2026-000007';
    const container = 'urn:ayurtrace:container:AG-000009';

    // 1 · Tier-3 SMS collection — parse + authorize + submit.
    const collector: Identity = { msp: 'CollectorMSP', role: 'COLLECTOR', active: true };
    expect(authorizeWrite(collector, 'collection', { entryMethod: 'TIER3_SMS' }).allowed).toBe(true);

    const smsReply = await handleInboundSms(
      {
        from: '+919000000001',
        body: 'HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823',
        messageSid: 'SM-int-1',
        receivedAt: new Date('2026-01-15T06:47:00+05:30'),
      },
      {
        directory: new InMemoryDirectory({ '+919000000001': 'NMPB-COL-KA-8823' }),
        submitter: collectorSubmitter(epc),
        idempotency: new InMemoryIdempotencyStore(),
        rateLimiter: new WindowRateLimiter(),
      },
    );
    expect(smsReply.outcome).toBe('COMMITTED');
    expect(smsReply.text).toContain(epc);

    // 2 · PoLK — two peers confirm → CONFIRMED, no GACP cap.
    const claim: PolkClaim = {
      collectorId: 'NMPB-COL-KA-8823',
      cluster: 'CLUSTER-TUMKUR-04',
      speciesCode: 'ASWG',
      quantityKg: 45,
      localityLabel: 'Tumakuru belt',
      openedAtMs: T0,
    };
    const votes: PolkPeerVote[] = [
      { peerId: 'p1', response: 'CONFIRM', respondedAtMs: T0 + 1000 },
      { peerId: 'p2', response: 'CONFIRM', respondedAtMs: T0 + 2000 },
    ];
    const polk = evaluatePolk(claim, votes, T0 + 3600_000);
    expect(polk.attestation.status).toBe('CONFIRMED');
    expect(capGacpScore(95, polk)).toBe(95);

    // 3 · Weighbridge — scale reading aggregates within tolerance.
    const broker = new MockBroker();
    const wb = new Weighbridge(broker);
    broker.publish(
      'ayurtrace/weighbridge/SCALE-1',
      JSON.stringify({ scaleId: 'SCALE-1', containerEpc: container, weightKg: 98, ts: T0 }),
    );
    const agg = wb.buildAggregation({
      parentEpc: container,
      childEpcs: [epc],
      declaredKg: 100,
      zoneId: 'NMPB-KA-ZONE-07',
      scaleId: 'SCALE-1',
      atMs: T0 + 500,
    });
    expect(agg.weigh.result).toBe('PASSED');
    expect(agg.flags).toEqual([]);

    // 4 · CP-5 lab limits — full panel within limits.
    const cp5 = evaluateCp5(fullPanel());
    expect(cp5.status).toBe('PASSED');
    expect(cp5.gacpStatus).toBe(GacpStatus.ACTIVE);

    // 5 · CP-6 DNA identity — export lot forces 100% sampling, barcode matches.
    const cp6 = evaluateCp6({
      epc,
      declaredSpecies: 'ASWG',
      conservationStatus: 'NORMAL',
      lotFlags: { export: true },
      dna: { markers: ['ITS2', 'psbA-trnH'], confirmedSpecies: 'ASWG' },
    });
    expect(cp6.status).toBe('PASSED');
    expect(cp6.sampling.reason).toBe('EXPORT');

    // 6 · RFC-3161 — anchor the certificate hash (fail-open client returns a good token).
    const certHash = createHash('sha256').update('lab-certificate-QmCert123').digest('hex');
    const goodTsa: TsaClient = {
      async requestToken() {
        return encodeTstInfo({ hashHex: certHash, serialNumber: 7n, genTime: new Date('2026-04-15T06:47:00Z') });
      },
    };
    const anchor = await anchorTimestamp(goodTsa, { hashHex: certHash });
    expect(anchor.status).toBe('ANCHORED');
    expect(anchor.tokenBase64).toBeTruthy();

    // 7 · Analytics — scans of the finished product yield a premium + demand signal.
    const scans: ScanEvent[] = Array.from({ length: 9 }, (_, i) => ({
      productEpc: `PROD-${i % 3}`,
      zoneId: 'NMPB-KA-ZONE-07',
      clusterId: 'CLUSTER-TUMKUR-04',
      speciesCode: 'ASWG',
      scannedAtMs: T0 + i,
      region: 'KA-SOUTH',
    }));
    const quotaResponses: ZoneQuotaResponse[] = [
      {
        zoneId: 'NMPB-KA-ZONE-07',
        quotas: [
          { speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-07', season: 'RABI', annualLimitKg: 312, consumedKg: 280, consumedPct: 89.7, band: 'RED' },
        ],
      },
    ];
    const report = runAnalytics({ scans, quotaResponses, speciesRules: [] }, { kAnonymity: 5, highDemandThreshold: 5 });
    expect(report.clusterEngagement.some((c) => c.premiumEligible)).toBe(true);
    expect(report.speciesDemand[0]?.recommendation).toBe('EXPAND_CULTIVATION');

    // Composite (illustrative, local — chaincode remains authoritative): all checkpoints
    // passed and PoLK confirmed → a full-confidence batch.
    const allPassed = cp5.status === 'PASSED' && cp6.status !== 'FAILED' && agg.weigh.result === 'PASSED';
    expect(allPassed && polk.attestation.status === 'CONFIRMED').toBe(true);
  });
});

describe('Complete-B guardrails compose too', () => {
  it('a lead-over-limit lab result holds the batch', () => {
    const metrics = fullPanel();
    metrics[1] = { name: 'lead', value: 12, unit: 'mg/kg', limit: 10, withinLimit: false };
    expect(evaluateCp5(metrics).gacpStatus).toBe(GacpStatus.HOLD);
  });

  it('a DNA mismatch on an endangered lot holds + flags', () => {
    const cp6 = evaluateCp6({
      epc: 'urn:ayurtrace:lot:CE-KA-SARP-2026-000001',
      declaredSpecies: 'SARP',
      conservationStatus: 'ENDANGERED',
      dna: { markers: ['ITS2', 'psbA-trnH'], confirmedSpecies: 'ASWG' },
    });
    expect(cp6.status).toBe('FAILED');
    expect(cp6.flags).toContain('DNA_MISMATCH');
  });

  it('a PoLK dispute caps the GACP score to zero', () => {
    const claim: PolkClaim = {
      collectorId: 'C', cluster: 'K', speciesCode: 'ASWG', quantityKg: 45, localityLabel: 'x', openedAtMs: T0,
    };
    const polk = evaluatePolk(claim, [{ peerId: 'p1', response: 'DISPUTE', respondedAtMs: T0 + 1 }], T0 + 100);
    expect(polk.attestation.status).toBe('DISPUTED');
    expect(capGacpScore(95, polk)).toBe(0);
  });

  it('an over-tolerance weigh flags a variance hold', () => {
    const broker = new MockBroker();
    const wb = new Weighbridge(broker);
    broker.publish(
      'ayurtrace/weighbridge/SCALE-1',
      JSON.stringify({ scaleId: 'SCALE-1', containerEpc: 'C', weightKg: 130, ts: T0 }),
    );
    const agg = wb.buildAggregation({ parentEpc: 'C', childEpcs: [], declaredKg: 100, zoneId: 'Z', scaleId: 'SCALE-1', atMs: T0 + 1 });
    expect(agg.flags).toContain('WEIGHT_VARIANCE_HOLD');
  });

  it('a consumer cannot write a collection', () => {
    const consumer: Identity = { msp: 'ConsumerMSP', role: 'CONSUMER', active: true };
    expect(authorizeWrite(consumer, 'collection').allowed).toBe(false);
  });

  it('the SMS parser still rejects a malformed body', () => {
    expect(parseHerbSms('HERB ASWG').ok).toBe(false);
  });
});

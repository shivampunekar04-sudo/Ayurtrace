import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { submitCfaIntake, submitWeighAggregation } from '../src/client/submit.js';
import { AyurTraceClient, type FetchLike } from '../src/client/api-client.js';
import { InMemoryAnchorStore, retryPendingAnchors, anchorAndStore } from '../src/rfc3161/anchor-store.js';
import { encodeTstInfo, type TsaClient } from '../src/rfc3161/rfc3161.js';
import type { CfaIntakeResult } from '../src/cfa/intake.js';
import type { AggregationBuildResult } from '../src/weighbridge/weighbridge.js';

function stubClient(response: unknown, capture?: (url: string, body: unknown) => void): AyurTraceClient {
  const fetchImpl: FetchLike = async (url, init) => {
    capture?.(url, init?.body ? JSON.parse(init.body as string) : undefined);
    return { ok: true, status: 200, json: async () => response };
  };
  return new AyurTraceClient({ baseUrl: 'http://gw', fetchImpl });
}

describe('CFA intake submission', () => {
  it('submits a passed intake as a collection', async () => {
    let capturedUrl = '';
    const client = stubClient({ ok: true, data: { epc: 'e', txId: 't', gacpScore: 40 } }, (u) => (capturedUrl = u));
    const intake: CfaIntakeResult = {
      ok: true,
      request: {
        speciesCode: 'ASWG', quantityKg: 45, plantPart: 'ROOT', collectorId: 'C', season: 'RABI',
        location: { lat: 13.3, lon: 77.1, altitudeM: 820 }, entryMethod: 'TIER4_CFA',
      },
      attribution: { collectorId: 'C', cfaId: 'CfaMSP', endorsers: ['CfaMSP'] },
    };
    const r = await submitCfaIntake(client, intake);
    expect(r.submitted).toBe(true);
    if (r.submitted) {
      expect(r.endorsers).toEqual(['CfaMSP']);
      expect(r.result.ok).toBe(true);
    }
    expect(capturedUrl).toBe('http://gw/events/collection');
  });

  it('does not submit a denied intake', async () => {
    const client = stubClient({ ok: true, data: {} });
    const denied: CfaIntakeResult = { ok: false, reason: 'BIOMETRIC_MISMATCH', message: 'x' };
    const r = await submitCfaIntake(client, denied);
    expect(r.submitted).toBe(false);
    if (!r.submitted) expect(r.reason).toBe('BIOMETRIC_MISMATCH');
  });
});

describe('weighbridge submission', () => {
  it('submits the aggregation and carries the local flags', async () => {
    const client = stubClient({ ok: true, data: { txId: 't' } });
    const built: AggregationBuildResult = {
      request: { parentEpc: 'AG', childEpcs: ['L1'], declaredKg: 100, measuredKg: 130, zoneId: 'Z' },
      weigh: { declaredKg: 100, measuredKg: 130, variancePct: 30, tolerancePct: 10, result: 'WEIGHT_VARIANCE_HOLD' },
      flags: ['WEIGHT_VARIANCE_HOLD'],
    };
    const r = await submitWeighAggregation(client, built);
    expect(r.result.ok).toBe(true);
    expect(r.flags).toContain('WEIGHT_VARIANCE_HOLD');
  });
});

describe('RFC-3161 anchor store + retry', () => {
  const hashHex = createHash('sha256').update('cert').digest('hex');
  const genTime = new Date('2026-04-15T06:47:00Z');

  const downTsa: TsaClient = { async requestToken() { throw new Error('TSA down'); } };
  const upTsa: TsaClient = { async requestToken() { return encodeTstInfo({ hashHex, serialNumber: 1n, genTime }); } };

  it('stores a PENDING anchor on failure, then anchors it on retry', async () => {
    const store = new InMemoryAnchorStore();
    const first = await anchorAndStore(store, downTsa, { hashHex });
    expect(first.status).toBe('PENDING');
    expect(store.pending()).toHaveLength(1);

    const outcome = await retryPendingAnchors(store, upTsa);
    expect(outcome.anchored).toBe(1);
    expect(store.get(hashHex)?.status).toBe('ANCHORED');
    expect(store.pending()).toHaveLength(0);
  });

  it('stops retrying an anchor that exhausts maxAttempts', async () => {
    const store = new InMemoryAnchorStore();
    // Seed a PENDING anchor already at the attempt ceiling.
    store.put({ hashHex, hashAlgorithm: 'sha256', status: 'PENDING', attempts: 5 });
    const outcome = await retryPendingAnchors(store, upTsa, { maxAttempts: 5 });
    expect(outcome.attempted).toBe(0);
    expect(outcome.exhausted).toBe(1);
  });
});

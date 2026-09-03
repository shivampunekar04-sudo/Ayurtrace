import { describe, it, expect } from 'vitest';
import { computeWeigh, WEIGH_HOLD_CODE } from '../src/weighbridge/variance.js';
import { MockBroker, topicMatches } from '../src/weighbridge/broker.js';
import { Weighbridge } from '../src/weighbridge/weighbridge.js';
import { RejectCode } from '../contracts/index.js';

describe('weigh variance', () => {
  it('PASSES within ±10%', () => {
    const r = computeWeigh(100, 105);
    expect(r.result).toBe('PASSED');
    expect(r.variancePct).toBeCloseTo(5);
  });

  it('HOLDS beyond tolerance and maps to WEIGHT_VARIANCE_HOLD', () => {
    const r = computeWeigh(100, 120);
    expect(r.result).toBe('WEIGHT_VARIANCE_HOLD');
    expect(WEIGH_HOLD_CODE).toBe(RejectCode.WEIGHT_VARIANCE_HOLD);
  });

  it('treats exactly the tolerance boundary as PASSED', () => {
    expect(computeWeigh(100, 110).result).toBe('PASSED');
    expect(computeWeigh(100, 110.01).result).toBe('WEIGHT_VARIANCE_HOLD');
  });

  it('throws on a non-positive declared weight', () => {
    expect(() => computeWeigh(0, 5)).toThrow();
  });
});

describe('mock broker topic matching', () => {
  it('matches exact and trailing-# wildcard topics', () => {
    expect(topicMatches('a/b', 'a/b')).toBe(true);
    expect(topicMatches('a/#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'x/y')).toBe(false);
    expect(topicMatches('#', 'anything/here')).toBe(true);
  });
});

describe('weighbridge subscriber (against a mock publisher)', () => {
  const weight = (over: Partial<{ scaleId: string; containerEpc: string; weightKg: number; ts: number }> = {}) =>
    JSON.stringify({ scaleId: 'SCALE-1', containerEpc: 'urn:ayurtrace:container:AG-000009', weightKg: 98, ts: 1_000, ...over });

  it('ingests a weight and builds a passing AggregationRequest', () => {
    const broker = new MockBroker();
    const wb = new Weighbridge(broker);
    broker.publish('ayurtrace/weighbridge/SCALE-1', weight({ weightKg: 98 }));

    const out = wb.buildAggregation({
      parentEpc: 'urn:ayurtrace:container:AG-000009',
      childEpcs: ['urn:ayurtrace:lot:CE-KA-ASWG-2026-000001'],
      declaredKg: 100,
      zoneId: 'NMPB-KA-ZONE-07',
      scaleId: 'SCALE-1',
      atMs: 1_500,
    });
    expect(out.request.measuredKg).toBe(98);
    expect(out.weigh.result).toBe('PASSED');
    expect(out.flags).toEqual([]);
  });

  it('flags a variance hold from the sensor reading', () => {
    const broker = new MockBroker();
    const wb = new Weighbridge(broker);
    broker.publish('ayurtrace/weighbridge/SCALE-1', weight({ weightKg: 130 }));
    const out = wb.buildAggregation({
      parentEpc: 'urn:ayurtrace:container:AG-000009',
      childEpcs: [],
      declaredKg: 100,
      zoneId: 'Z',
      scaleId: 'SCALE-1',
      atMs: 1_500,
    });
    expect(out.flags).toContain('WEIGHT_VARIANCE_HOLD');
  });

  it('handles sensor dropout by using last-known and flagging it', () => {
    const broker = new MockBroker();
    const wb = new Weighbridge(broker, { freshnessMs: 60_000 });
    broker.publish('ayurtrace/weighbridge/SCALE-1', weight({ weightKg: 99, ts: 1_000 }));
    const out = wb.buildAggregation({
      parentEpc: 'urn:ayurtrace:container:AG-000009',
      childEpcs: [],
      declaredKg: 100,
      zoneId: 'Z',
      scaleId: 'SCALE-1',
      atMs: 1_000 + 120_000, // 2 min later, past freshness window
    });
    expect(out.request.measuredKg).toBe(99);
    expect(out.flags).toContain('SENSOR_DROPOUT_LAST_KNOWN');
  });

  it('throws when no reading has ever been seen', () => {
    const wb = new Weighbridge(new MockBroker());
    expect(() =>
      wb.buildAggregation({ parentEpc: 'X', childEpcs: [], declaredKg: 100, zoneId: 'Z', scaleId: 'SCALE-1', atMs: 1 }),
    ).toThrow();
  });

  it('logs RFID custody (IN = receiving, OUT = shipping)', () => {
    const broker = new MockBroker();
    const wb = new Weighbridge(broker);
    broker.publish(
      'ayurtrace/rfid/READER-1',
      JSON.stringify({ readerId: 'READER-1', tagEpc: 'TAG-1', containerEpc: 'AG-9', direction: 'IN', ts: 10 }),
    );
    broker.publish(
      'ayurtrace/rfid/READER-2',
      JSON.stringify({ readerId: 'READER-2', tagEpc: 'TAG-1', containerEpc: 'AG-9', direction: 'OUT', ts: 20 }),
    );
    const log = wb.custodyFor('AG-9');
    expect(log.map((c) => c.bizStep)).toEqual(['receiving', 'shipping']);
  });

  it('ignores malformed sensor frames without throwing', () => {
    const broker = new MockBroker();
    const wb = new Weighbridge(broker);
    broker.publish('ayurtrace/weighbridge/SCALE-1', 'not-json');
    expect(wb.lastMeasured('SCALE-1', 'anything')).toBeUndefined();
  });
});

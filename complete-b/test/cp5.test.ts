import { describe, it, expect } from 'vitest';
import { evaluateCp5 } from '../src/enforcement/cp5.js';
import {
  Checkpoint,
  GacpStatus,
  RejectCode,
  type QualityMetric,
} from '../contracts/index.js';

/** Build a within-limit metric by default; override to force a failure. */
function metric(over: Partial<QualityMetric> & Pick<QualityMetric, 'name'>): QualityMetric {
  const base: Record<QualityMetric['name'], Omit<QualityMetric, 'name'>> = {
    moisture: { value: 8, unit: '%', limit: 10, withinLimit: true },
    lead: { value: 2, unit: 'mg/kg', limit: 10, withinLimit: true },
    arsenic: { value: 1, unit: 'mg/kg', limit: 3, withinLimit: true },
    mercury: { value: 0.2, unit: 'mg/kg', limit: 1, withinLimit: true },
    cadmium: { value: 0.1, unit: 'mg/kg', limit: 0.3, withinLimit: true },
    pesticide: { value: 0.02, unit: 'mg/kg', limit: 0.1, withinLimit: true },
  };
  return { ...base[over.name]!, ...over };
}

const fullPanel = (): QualityMetric[] => [
  metric({ name: 'moisture' }),
  metric({ name: 'lead' }),
  metric({ name: 'arsenic' }),
  metric({ name: 'mercury' }),
  metric({ name: 'cadmium' }),
  metric({ name: 'pesticide' }),
];

describe('CP-5 lab limits', () => {
  it('PASSES a complete panel within limits → ACTIVE, no reject code', () => {
    const r = evaluateCp5(fullPanel());
    expect(r.checkpoint).toBe(Checkpoint.CP5_LAB_LIMITS);
    expect(r.status).toBe('PASSED');
    expect(r.gacpStatus).toBe(GacpStatus.ACTIVE);
    expect(r.rejectCode).toBeUndefined();
    expect(r.failures).toEqual([]);
  });

  it('FAILS when lead is over the limit → HOLD + BATCH_STATUS_HOLD', () => {
    const metrics = fullPanel();
    metrics[1] = metric({ name: 'lead', value: 12, withinLimit: false });
    const r = evaluateCp5(metrics);
    expect(r.status).toBe('FAILED');
    expect(r.gacpStatus).toBe(GacpStatus.HOLD);
    expect(r.rejectCode).toBe(RejectCode.BATCH_STATUS_HOLD);
    expect(r.failures).toContainEqual(
      expect.objectContaining({ metric: 'lead', reason: 'OVER_LIMIT', value: 12 }),
    );
  });

  it('does not trust a lying withinLimit flag — re-derives from value vs limit', () => {
    const metrics = fullPanel();
    // Claims within-limit, but value clearly exceeds the limit.
    metrics[2] = metric({ name: 'arsenic', value: 9, limit: 3, withinLimit: true });
    const r = evaluateCp5(metrics);
    expect(r.status).toBe('FAILED');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ metric: 'arsenic', reason: 'OVER_LIMIT' }),
    );
  });

  it('HOLDS when a required metric is missing from the panel', () => {
    const metrics = fullPanel().filter((m) => m.name !== 'mercury');
    const r = evaluateCp5(metrics);
    expect(r.status).toBe('FAILED');
    expect(r.rejectCode).toBe(RejectCode.BATCH_STATUS_HOLD);
    expect(r.failures).toContainEqual(
      expect.objectContaining({ metric: 'mercury', reason: 'MISSING_REQUIRED_METRIC' }),
    );
  });

  it('enforces the stricter WHO/AYUSH reference when the submitted limit is looser', () => {
    const metrics = fullPanel();
    // Lab submits a lenient Pb limit of 20 and a value of 15 (would "pass" its own limit).
    metrics[1] = metric({ name: 'lead', value: 15, limit: 20, withinLimit: true });
    const r = evaluateCp5(metrics);
    expect(r.status).toBe('FAILED');
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ metric: 'lead', submittedLimit: 20, referenceLimit: 10 }),
    );
    expect(r.failures).toContainEqual(
      expect.objectContaining({ metric: 'lead', reason: 'OVER_LIMIT', effectiveLimit: 10 }),
    );
  });

  it('warns but PASSES when a looser limit is submitted yet the value is still within reference', () => {
    const metrics = fullPanel();
    metrics[1] = metric({ name: 'lead', value: 8, limit: 20, withinLimit: true });
    const r = evaluateCp5(metrics);
    expect(r.status).toBe('PASSED');
    expect(r.warnings).toHaveLength(1);
  });

  it('FAILS on a non-finite / negative measurement', () => {
    const metrics = fullPanel();
    metrics[0] = metric({ name: 'moisture', value: Number.NaN });
    const r = evaluateCp5(metrics);
    expect(r.status).toBe('FAILED');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ metric: 'moisture', reason: 'INVALID_VALUE' }),
    );
  });

  it('can skip the full-panel requirement when requireFullPanel=false', () => {
    const r = evaluateCp5([metric({ name: 'lead' })], { requireFullPanel: false });
    expect(r.status).toBe('PASSED');
  });
});

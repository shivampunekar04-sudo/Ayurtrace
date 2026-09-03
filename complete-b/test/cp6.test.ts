import { describe, it, expect } from 'vitest';
import {
  evaluateCp6,
  decideSampling,
  sampleFraction,
  DEFAULT_CP6_POLICY,
  type Cp6Input,
} from '../src/enforcement/cp6.js';
import type { Cp6DnaResult } from '../src/enforcement/cp6.js';
import { Checkpoint, GacpStatus, RejectCode } from '../contracts/index.js';

const base = (over: Partial<Cp6Input> = {}): Cp6Input => ({
  epc: 'urn:ayurtrace:lot:CE-KA-ASWG-2026-000123',
  declaredSpecies: 'ASWG',
  conservationStatus: 'NORMAL',
  ...over,
});

const goodBarcode: Cp6DnaResult = { markers: ['ITS2', 'psbA-trnH'], confirmedSpecies: 'ASWG' };

describe('CP-6 sampling policy (risk-weighted)', () => {
  it('requires 100% sampling for endangered species', () => {
    const s = decideSampling(base({ conservationStatus: 'ENDANGERED' }));
    expect(s).toEqual({ required: true, reason: 'ENDANGERED', ratioApplied: 1 });
  });

  it('requires 100% sampling for flagged lots', () => {
    const s = decideSampling(base({ lotFlags: { flagged: true } }));
    expect(s.reason).toBe('FLAGGED');
    expect(s.required).toBe(true);
  });

  it('requires 100% sampling for export lots', () => {
    const s = decideSampling(base({ lotFlags: { export: true } }));
    expect(s.reason).toBe('EXPORT');
    expect(s.required).toBe(true);
  });

  it('always samples a normal lot at ratio 1.0, never at ratio 0.0', () => {
    const input = base();
    expect(decideSampling(input, { baselineSamplingRatio: 1 }).required).toBe(true);
    expect(decideSampling(input, { baselineSamplingRatio: 0 }).required).toBe(false);
  });

  it('is deterministic: same EPC yields the same sampling decision', () => {
    const a = decideSampling(base(), DEFAULT_CP6_POLICY);
    const b = decideSampling(base(), DEFAULT_CP6_POLICY);
    expect(a).toEqual(b);
  });

  it('sampleFraction is stable and bounded in [0,1)', () => {
    const f = sampleFraction('urn:ayurtrace:lot:CE-KA-ASWG-2026-000123');
    expect(f).toBe(sampleFraction('urn:ayurtrace:lot:CE-KA-ASWG-2026-000123'));
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(1);
  });

  it('baseline ratio partitions the lot space (some in, some out)', () => {
    const decisions = Array.from({ length: 200 }, (_, i) =>
      decideSampling(base({ epc: `urn:lot:${i}` }), { baselineSamplingRatio: 0.5 }).required,
    );
    const sampled = decisions.filter(Boolean).length;
    // Roughly half, and definitely not all-or-nothing.
    expect(sampled).toBeGreaterThan(50);
    expect(sampled).toBeLessThan(150);
  });
});

describe('CP-6 identity enforcement', () => {
  it('PASSES a required lot with a complete, matching barcode → ACTIVE', () => {
    const r = evaluateCp6(base({ conservationStatus: 'ENDANGERED', dna: goodBarcode }));
    expect(r.checkpoint).toBe(Checkpoint.CP6_DNA_IDENTITY);
    expect(r.status).toBe('PASSED');
    expect(r.match).toBe(true);
    expect(r.gacpStatus).toBe(GacpStatus.ACTIVE);
    expect(r.rejectCode).toBeUndefined();
  });

  it('FAILS + flags on a species mismatch → HOLD + BATCH_STATUS_HOLD', () => {
    const r = evaluateCp6(
      base({
        conservationStatus: 'ENDANGERED',
        dna: { markers: ['ITS2', 'psbA-trnH'], confirmedSpecies: 'SARP' },
      }),
    );
    expect(r.status).toBe('FAILED');
    expect(r.match).toBe(false);
    expect(r.failureReason).toBe('DNA_MISMATCH');
    expect(r.flags).toContain('DNA_MISMATCH');
    expect(r.gacpStatus).toBe(GacpStatus.HOLD);
    expect(r.rejectCode).toBe(RejectCode.BATCH_STATUS_HOLD);
  });

  it('HOLDS a required lot whose barcode is missing', () => {
    const r = evaluateCp6(base({ conservationStatus: 'ENDANGERED' }));
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('MISSING_BARCODE');
    expect(r.rejectCode).toBe(RejectCode.BATCH_STATUS_HOLD);
  });

  it('HOLDS a required lot whose barcode is missing a marker', () => {
    const r = evaluateCp6(
      base({
        lotFlags: { export: true },
        dna: { markers: ['ITS2'], confirmedSpecies: 'ASWG' },
      }),
    );
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('INCOMPLETE_MARKERS');
  });

  it('SKIPS a non-sampled normal lot with no barcode → ACTIVE (checkpoint guarantee)', () => {
    const r = evaluateCp6(base(), { baselineSamplingRatio: 0 });
    expect(r.status).toBe('SKIPPED');
    expect(r.sampling.reason).toBe('NOT_SAMPLED');
    expect(r.gacpStatus).toBe(GacpStatus.ACTIVE);
  });

  it('never ignores a positive adulteration signal even when not sampled', () => {
    const r = evaluateCp6(
      base({ dna: { markers: ['ITS2', 'psbA-trnH'], confirmedSpecies: 'SARP' } }),
      { baselineSamplingRatio: 0 },
    );
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('DNA_MISMATCH');
  });

  it('treats species codes case/whitespace-insensitively', () => {
    const r = evaluateCp6(
      base({
        conservationStatus: 'ENDANGERED',
        declaredSpecies: ' aswg ',
        dna: { markers: ['ITS2', 'psbA-trnH'], confirmedSpecies: 'ASWG' },
      }),
    );
    expect(r.status).toBe('PASSED');
  });
});

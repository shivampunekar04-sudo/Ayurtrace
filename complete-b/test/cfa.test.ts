import { describe, it, expect } from 'vitest';
import { ConsentStore } from '../src/cfa/consent.js';
import { enrolBiometric, verifyBiometric, hashBiometric, SimulatedCapture } from '../src/cfa/biometric.js';
import { cfaIntake, CFA_COLLECTION_PURPOSE, type CfaIntakeParams, type CfaIntakeDeps } from '../src/cfa/intake.js';
import type { Identity } from '../src/rbac/rbac.js';

const T = 1_700_000_000_000;

describe('DPDP consent state machine', () => {
  it('grants, then reports active consent for the exact purpose only', () => {
    const s = new ConsentStore();
    s.grant({ id: 'c1', collectorId: 'COL', cfaId: 'CFA', purpose: 'COLLECTION_LOGGING', atMs: T });
    expect(s.hasActiveConsent('COL', 'CFA', 'COLLECTION_LOGGING')).toBe(true);
    expect(s.hasActiveConsent('COL', 'CFA', 'MARKETING')).toBe(false);
  });

  it('withdraw blocks future writes but keeps the record', () => {
    const s = new ConsentStore();
    s.grant({ id: 'c1', collectorId: 'COL', cfaId: 'CFA', purpose: 'P', atMs: T });
    s.withdraw('COL', 'CFA', 'P', T + 1);
    expect(s.hasActiveConsent('COL', 'CFA', 'P')).toBe(false);
    expect(s.get('COL', 'CFA', 'P')?.status).toBe('WITHDRAWN');
  });

  it('erase clears biometric material and is terminal', () => {
    const s = new ConsentStore();
    s.grant({ id: 'c1', collectorId: 'COL', cfaId: 'CFA', purpose: 'P', atMs: T, biometricHash: 'h', biometricSalt: 's' });
    s.erase('COL', 'CFA', 'P', T + 2);
    const rec = s.get('COL', 'CFA', 'P');
    expect(rec?.status).toBe('ERASED');
    expect(rec?.biometricHash).toBeUndefined();
    expect(rec?.biometricSalt).toBeUndefined();
    // withdraw after erase does not resurrect it
    s.withdraw('COL', 'CFA', 'P', T + 3);
    expect(s.get('COL', 'CFA', 'P')?.status).toBe('ERASED');
  });

  it('re-granting after withdrawal restores active consent', () => {
    const s = new ConsentStore();
    s.grant({ id: 'c1', collectorId: 'COL', cfaId: 'CFA', purpose: 'P', atMs: T });
    s.withdraw('COL', 'CFA', 'P', T + 1);
    s.grant({ id: 'c2', collectorId: 'COL', cfaId: 'CFA', purpose: 'P', atMs: T + 2 });
    expect(s.hasActiveConsent('COL', 'CFA', 'P')).toBe(true);
  });
});

describe('biometric salted hash', () => {
  it('never equals the raw template and verifies a match', () => {
    const stored = enrolBiometric('THUMB-TEMPLATE-XYZ', 'fixed-salt');
    expect(stored.hash).not.toContain('THUMB-TEMPLATE-XYZ');
    expect(stored.hash).toBe(hashBiometric('THUMB-TEMPLATE-XYZ', 'fixed-salt'));
    expect(verifyBiometric('THUMB-TEMPLATE-XYZ', stored)).toBe(true);
  });
  it('rejects a different template', () => {
    const stored = enrolBiometric('THUMB-A', 'salt');
    expect(verifyBiometric('THUMB-B', stored)).toBe(false);
  });
});

// ---- intake orchestration ---------------------------------------------------

const cfa: Identity = { msp: 'CfaMSP', role: 'CFA', active: true };

const params = (over: Partial<CfaIntakeParams> = {}): CfaIntakeParams => ({
  cfaIdentity: cfa,
  collectorId: 'NMPB-COL-KA-8823',
  collection: {
    speciesCode: 'ASWG',
    quantityKg: 45,
    plantPart: 'ROOT',
    season: 'RABI',
    location: { lat: 13.34, lon: 77.1, altitudeM: 820 },
  },
  ...over,
});

function deps(over: Partial<CfaIntakeDeps> = {}): CfaIntakeDeps {
  const consent = new ConsentStore();
  consent.grant({ id: 'c1', collectorId: 'NMPB-COL-KA-8823', cfaId: 'CfaMSP', purpose: CFA_COLLECTION_PURPOSE, atMs: T });
  return {
    consent,
    capture: new SimulatedCapture('THUMB-TEMPLATE'),
    enrolledBiometric: enrolBiometric('THUMB-TEMPLATE', 'salt'),
    ...over,
  };
}

describe('Tier-4 CFA intake gate', () => {
  it('produces a TIER4_CFA request with CFA attribution when all gates pass', async () => {
    const r = await cfaIntake(params(), deps());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.entryMethod).toBe('TIER4_CFA');
      expect(r.request.collectorId).toBe('NMPB-COL-KA-8823');
      expect(r.attribution.endorsers).toContain('CfaMSP');
    }
  });

  it('blocks when consent was withdrawn', async () => {
    const d = deps();
    d.consent.withdraw('NMPB-COL-KA-8823', 'CfaMSP', CFA_COLLECTION_PURPOSE, T + 1);
    const r = await cfaIntake(params(), d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('CONSENT_MISSING_OR_WITHDRAWN');
  });

  it('rejects on a biometric mismatch — no event produced', async () => {
    const r = await cfaIntake(params(), deps({ capture: new SimulatedCapture('WRONG-THUMB') }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('BIOMETRIC_MISMATCH');
  });

  it('blocks a non-CFA identity', async () => {
    const r = await cfaIntake(params({ cfaIdentity: { msp: 'X', role: 'COLLECTOR', active: true } }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_A_CFA');
  });

  it('blocks a revoked CFA cert (active=false)', async () => {
    const r = await cfaIntake(params({ cfaIdentity: { msp: 'CfaMSP', role: 'CFA', active: false } }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_A_CFA');
  });

  it('blocks when the collector has no enrolled biometric', async () => {
    const r = await cfaIntake(params(), deps({ enrolledBiometric: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NO_ENROLLED_BIOMETRIC');
  });
});

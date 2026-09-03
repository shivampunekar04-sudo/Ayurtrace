import { describe, it, expect } from 'vitest';
import {
  authorizeWrite,
  authorizeRead,
  toRejectEnvelope,
  type Identity,
} from '../src/rbac/rbac.js';
import { ALL_ROLES, WRITE_MATRIX, type Role, type WriteAction } from '../src/rbac/roles.js';

const id = (role: Role, over: Partial<Identity> = {}): Identity => ({
  msp: `${role}MSP`,
  role,
  active: true,
  ...over,
});

describe('RBAC write matrix', () => {
  it('allows each role exactly its permitted writes and denies the rest', () => {
    const actions = Object.keys(WRITE_MATRIX) as WriteAction[];
    for (const role of ALL_ROLES) {
      for (const action of actions) {
        const expected = WRITE_MATRIX[action].includes(role);
        // Use contexts that don't trip the secondary gates.
        const ctx =
          action === 'collection'
            ? { entryMethod: role === 'CFA' ? ('TIER4_CFA' as const) : ('TIER1_PWA' as const) }
            : action === 'quality-test:endorse'
              ? {
                  testingLabMsp: 'LabMSP',
                  verifierMsp: 'RegMSP',
                  // A LAB may only endorse as a SECOND_LAB; every other permitted role uses REGULATOR.
                  verifierRole: role === 'LAB' ? ('SECOND_LAB' as const) : ('REGULATOR' as const),
                }
              : {};
        const d = authorizeWrite(id(role), action, ctx);
        expect(d.allowed, `${role} → ${action}`).toBe(expected);
      }
    }
  });

  it('denies a revoked/expired cert before anything else', () => {
    const d = authorizeWrite(id('COLLECTOR', { active: false }), 'collection', { entryMethod: 'TIER1_PWA' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('CERT_INACTIVE');
  });

  it('denies a Consumer any write', () => {
    expect(authorizeWrite(id('CONSUMER'), 'collection').allowed).toBe(false);
  });
});

describe('RBAC collection tier alignment', () => {
  it('requires a CFA identity for a TIER4_CFA collection', () => {
    const d = authorizeWrite(id('COLLECTOR'), 'collection', { entryMethod: 'TIER4_CFA' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('ENTRY_METHOD_MISMATCH');
  });

  it('allows a CFA to submit a TIER4_CFA collection', () => {
    expect(authorizeWrite(id('CFA'), 'collection', { entryMethod: 'TIER4_CFA' }).allowed).toBe(true);
  });

  it('blocks a CFA from submitting a non-CFA tier', () => {
    const d = authorizeWrite(id('CFA'), 'collection', { entryMethod: 'TIER1_PWA' });
    expect(d.reason).toBe('ENTRY_METHOD_MISMATCH');
  });

  it('lets a Collector submit a TIER3_SMS collection (SMS gateway acts as the collector)', () => {
    expect(authorizeWrite(id('COLLECTOR'), 'collection', { entryMethod: 'TIER3_SMS' }).allowed).toBe(true);
  });
});

describe('RBAC endorsement independence', () => {
  it('denies an endorsement where verifier MSP equals the testing lab MSP', () => {
    const d = authorizeWrite(id('REGULATOR'), 'quality-test:endorse', {
      testingLabMsp: 'LabMSP',
      verifierMsp: 'LabMSP',
      verifierRole: 'REGULATOR',
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('NOT_INDEPENDENT_ENDORSER');
  });

  it('allows a REGULATOR to endorse an independent lab result', () => {
    expect(
      authorizeWrite(id('REGULATOR'), 'quality-test:endorse', {
        testingLabMsp: 'LabMSP',
        verifierMsp: 'RegMSP',
        verifierRole: 'REGULATOR',
      }).allowed,
    ).toBe(true);
  });

  it('allows a LAB to endorse only as an accredited SECOND_LAB', () => {
    const asSecond = authorizeWrite(id('LAB'), 'quality-test:endorse', {
      testingLabMsp: 'Lab1MSP',
      verifierMsp: 'Lab2MSP',
      verifierRole: 'SECOND_LAB',
    });
    expect(asSecond.allowed).toBe(true);
    const asRegulator = authorizeWrite(id('LAB'), 'quality-test:endorse', {
      testingLabMsp: 'Lab1MSP',
      verifierMsp: 'Lab2MSP',
      verifierRole: 'REGULATOR',
    });
    expect(asRegulator.allowed).toBe(false);
  });
});

describe('RBAC reads', () => {
  it('lets every role do public reads', () => {
    for (const role of ALL_ROLES) {
      expect(authorizeRead(id(role), 'batch').allowed).toBe(true);
      expect(authorizeRead(id(role), 'qr-verify').allowed).toBe(true);
    }
  });

  it('restricts precise audit reads to the regulator', () => {
    expect(authorizeRead(id('REGULATOR'), 'audit').allowed).toBe(true);
    expect(authorizeRead(id('CONSUMER'), 'audit').allowed).toBe(false);
    expect(authorizeRead(id('LAB'), 'audit').allowed).toBe(false);
  });
});

describe('RBAC reject envelope (contract-gap honesty)', () => {
  it('returns a 403 with a NON-contract code, not a mislabelled business reject', () => {
    const d = authorizeWrite(id('CONSUMER'), 'collection');
    const env = toRejectEnvelope(d);
    expect(env.httpStatus).toBe(403);
    expect(env.code).toBe('UNAUTHORIZED_PENDING_CONTRACT_CODE');
    expect(env.detail.role).toBe('CONSUMER');
  });
});

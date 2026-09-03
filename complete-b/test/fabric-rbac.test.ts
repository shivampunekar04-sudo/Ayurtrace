import { describe, it, expect } from 'vitest';
import {
  CHAINCODE_WRITE_MATRIX,
  assertAuthorized,
  isAuthorized,
  ChaincodeAuthorizationError,
  UNAUTHORIZED_CODE,
  type ChaincodeClientIdentity,
} from '../fabric/chaincode/rbac-attribute-check.js';
import { WRITE_MATRIX } from '../src/rbac/roles.js';

/** Fake Fabric ClientIdentity. */
const identity = (role: string | null, msp = 'OrgMSP'): ChaincodeClientIdentity => ({
  getMSPID: () => msp,
  getAttributeValue: (attr) => (attr === 'role' ? role : null),
});

describe('chaincode RBAC parity (no drift vs middleware)', () => {
  it('CHAINCODE_WRITE_MATRIX exactly mirrors src/rbac/roles.ts WRITE_MATRIX', () => {
    // Same actions.
    expect(Object.keys(CHAINCODE_WRITE_MATRIX).sort()).toEqual(Object.keys(WRITE_MATRIX).sort());
    // Same role sets per action (order-independent).
    for (const action of Object.keys(WRITE_MATRIX) as (keyof typeof WRITE_MATRIX)[]) {
      expect([...CHAINCODE_WRITE_MATRIX[action]].sort()).toEqual([...WRITE_MATRIX[action]].sort());
    }
  });
});

describe('chaincode attribute check enforcement', () => {
  it('authorizes a permitted role', () => {
    expect(isAuthorized(identity('COLLECTOR'), 'collection')).toBe(true);
    expect(isAuthorized(identity('LAB'), 'quality-test:submit')).toBe(true);
  });

  it('denies a forbidden role', () => {
    expect(isAuthorized(identity('CONSUMER'), 'collection')).toBe(false);
    expect(isAuthorized(identity('PROCESSOR'), 'recall')).toBe(false);
  });

  it('denies an identity with no role attribute', () => {
    expect(isAuthorized(identity(null), 'collection')).toBe(false);
  });

  it('denies an unknown role string', () => {
    expect(isAuthorized(identity('SUPERUSER'), 'collection')).toBe(false);
  });

  it('assertAuthorized throws the UNAUTHORIZED-coded error on denial', () => {
    try {
      assertAuthorized(identity('CONSUMER'), 'formulation');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ChaincodeAuthorizationError);
      expect((e as ChaincodeAuthorizationError).code).toBe(UNAUTHORIZED_CODE);
    }
  });

  it('assertAuthorized passes silently for a permitted write', () => {
    expect(() => assertAuthorized(identity('MANUFACTURER'), 'formulation')).not.toThrow();
  });
});

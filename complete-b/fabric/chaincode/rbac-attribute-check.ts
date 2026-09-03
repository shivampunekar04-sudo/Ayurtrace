/**
 * Chaincode-side RBAC attribute check (component 4) — the on-ledger enforcement layer that
 * MIRRORS the gateway middleware in `src/rbac/`.
 *
 * HONESTY TAG: 🟢 BUILT config/code (pure, unit-tested for parity with the middleware).
 * 🔵 DESIGNED for live enforcement — it runs inside chaincode on a Fabric peer, so it only
 * ENFORCES once a Fabric network with a CA/MSP per org is running (see fabric/config/).
 *
 * Why duplicate the matrix here? Defence in depth: the gateway middleware is the first gate,
 * but a compromised or bypassed gateway must not be able to write a forbidden event — the
 * chaincode re-checks the caller's identity attributes independently. In a real deploy this
 * matrix is vendored into the chaincode package; `test/fabric-rbac.test.ts` asserts it stays
 * in lock-step with `src/rbac/roles.ts` so the two layers can never silently drift.
 *
 * No fabric-shim dependency here: `ChaincodeClientIdentity` is the minimal slice of Fabric's
 * `ClientIdentity` this check needs (`getMSPID`, `getAttributeValue`). In chaincode you pass
 * `ctx.clientIdentity`.
 */

export type Role =
  | 'COLLECTOR'
  | 'CFA'
  | 'AGGREGATOR'
  | 'PROCESSOR'
  | 'LAB'
  | 'MANUFACTURER'
  | 'REGULATOR'
  | 'CONSUMER';

export type WriteAction =
  | 'collection'
  | 'aggregation'
  | 'process'
  | 'merge'
  | 'quality-test:submit'
  | 'quality-test:endorse'
  | 'formulation'
  | 'recall';

/** MUST mirror WRITE_MATRIX in src/rbac/roles.ts (enforced by test/fabric-rbac.test.ts). */
export const CHAINCODE_WRITE_MATRIX: Record<WriteAction, readonly Role[]> = {
  collection: ['COLLECTOR', 'CFA'],
  aggregation: ['AGGREGATOR'],
  process: ['PROCESSOR'],
  merge: ['AGGREGATOR'],
  'quality-test:submit': ['LAB'],
  'quality-test:endorse': ['REGULATOR', 'LAB'],
  formulation: ['MANUFACTURER'],
  recall: ['REGULATOR'],
};

/** The minimal slice of Fabric's ClientIdentity this check needs. */
export interface ChaincodeClientIdentity {
  getMSPID(): string;
  /** Value of an attribute asserted on the enrolling cert, or null. */
  getAttributeValue(attrName: string): string | null;
}

/**
 * Proposed reject code for authorization denials. Pending CCR-1 (see
 * docs/CONTRACT_CHANGE_REQUESTS.md), the frozen RejectCode enum has no authz code, so the
 * chaincode returns this until the contract owner adds `UNAUTHORIZED`.
 */
export const UNAUTHORIZED_CODE = 'UNAUTHORIZED_PENDING_CONTRACT_CODE';

export class ChaincodeAuthorizationError extends Error {
  readonly code = UNAUTHORIZED_CODE;
  constructor(
    readonly role: string,
    readonly action: WriteAction,
  ) {
    super(`Role ${role} (MSP-scoped) is not permitted to perform ${action}.`);
    this.name = 'ChaincodeAuthorizationError';
  }
}

function roleOf(identity: ChaincodeClientIdentity): Role | null {
  const raw = identity.getAttributeValue('role');
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return (CHAINCODE_ROLES as readonly string[]).includes(upper) ? (upper as Role) : null;
}

export const CHAINCODE_ROLES: readonly Role[] = [
  'COLLECTOR', 'CFA', 'AGGREGATOR', 'PROCESSOR', 'LAB', 'MANUFACTURER', 'REGULATOR', 'CONSUMER',
];

/** Returns whether the caller may perform the action. */
export function isAuthorized(identity: ChaincodeClientIdentity, action: WriteAction): boolean {
  const role = roleOf(identity);
  if (!role) return false;
  return CHAINCODE_WRITE_MATRIX[action].includes(role);
}

/**
 * Chaincode gate: throws `ChaincodeAuthorizationError` (→ endorsement fails) if the caller's
 * attribute-derived role is not permitted for the action. Call this at the top of every write
 * transaction, before MPR / mass-balance logic.
 */
export function assertAuthorized(identity: ChaincodeClientIdentity, action: WriteAction): void {
  const role = roleOf(identity);
  if (!role || !CHAINCODE_WRITE_MATRIX[action].includes(role)) {
    throw new ChaincodeAuthorizationError(role ?? identity.getMSPID(), action);
  }
}

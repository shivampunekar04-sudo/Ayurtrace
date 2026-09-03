/**
 * 7-role RBAC — role model + write/read scope matrix (component 4).
 *
 * HONESTY TAG: 🟢 BUILT for the role→action matrix and the attribute-check middleware
 * (pure, unit-tested). 🔵 DESIGNED for live enforcement, which needs a running Fabric
 * CA + MSP per org and channel endorsement policies on the user's machine.
 *
 * ⚠️ CONTRACT GAP (flagged, NOT worked around): an authorization denial has no code in
 * the frozen `RejectCode` enum. This layer therefore returns its OWN `AuthzDecision`
 * (deny → HTTP 403 at the gateway) rather than mis-mapping onto a business reject code
 * like LICENSE_INVALID. Surfacing authz denials through the typed reject envelope would
 * need a new code (e.g. `UNAUTHORIZED`) — that is a contract change for the contract
 * owner to make; Complete-B does not invent it. See rbac.ts `toRejectEnvelope`.
 */

/** The full role set. NMPB/AYUSH regulator = REGULATOR. Consumer is read-only. */
export type Role =
  | 'COLLECTOR'
  | 'CFA'
  | 'AGGREGATOR'
  | 'PROCESSOR'
  | 'LAB'
  | 'MANUFACTURER'
  | 'REGULATOR'
  | 'CONSUMER';

export const ALL_ROLES: readonly Role[] = [
  'COLLECTOR',
  'CFA',
  'AGGREGATOR',
  'PROCESSOR',
  'LAB',
  'MANUFACTURER',
  'REGULATOR',
  'CONSUMER',
] as const;

/** Write actions, finer-grained than endpoints where a role split matters. */
export type WriteAction =
  | 'collection'
  | 'aggregation'
  | 'process' // TransformationRequest kind PROCESS
  | 'merge' // TransformationRequest kind MERGE
  | 'quality-test:submit'
  | 'quality-test:endorse'
  | 'formulation'
  | 'recall';

/** Read actions. Consumer reads are zone-only by the event model; `audit` is precise. */
export type ReadAction = 'batch' | 'zones' | 'quota' | 'qr-verify' | 'audit';

/** Least-privilege write matrix: exactly which roles may perform which write. */
export const WRITE_MATRIX: Record<WriteAction, readonly Role[]> = {
  collection: ['COLLECTOR', 'CFA'],
  aggregation: ['AGGREGATOR'],
  process: ['PROCESSOR'],
  merge: ['AGGREGATOR'],
  'quality-test:submit': ['LAB'],
  // Incentive-independent endorser: regulator by default, or a second accredited lab.
  'quality-test:endorse': ['REGULATOR', 'LAB'],
  formulation: ['MANUFACTURER'],
  recall: ['REGULATOR'],
};

/** Read matrix. Everyone can do public reads; precise audit is regulator-only. */
export const READ_MATRIX: Record<ReadAction, readonly Role[]> = {
  batch: ALL_ROLES,
  zones: ALL_ROLES,
  quota: ALL_ROLES,
  'qr-verify': ALL_ROLES,
  audit: ['REGULATOR'],
};

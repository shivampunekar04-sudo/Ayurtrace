/**
 * Attribute-based authorization middleware (component 4).
 *
 * HONESTY TAG: 🟢 BUILT — pure decision function over an identity + a requested action,
 * unit-tested. This is the gate that runs BEFORE the MPR / chaincode business rules.
 * It does NOT re-implement MPR or mass-balance (those stay in chaincode); it only
 * answers "may this identity attempt this write/read at all?".
 *
 * Identity model mirrors a Fabric enrolled identity: an MSP id plus attributes carried
 * on the cert (attribute-based access, not MSP-only). Live issuance/revocation is the
 * DESIGNED Fabric-CA layer.
 */
import { RejectCode } from '../../contracts/index.js';
import {
  READ_MATRIX,
  WRITE_MATRIX,
  type ReadAction,
  type Role,
  type WriteAction,
} from './roles.js';

export interface Identity {
  /** Fabric MSP id, e.g. 'CollectorMSP', 'LabMSP'. */
  msp: string;
  /** Role attribute asserted on the enrolled cert. */
  role: Role;
  /** True while the cert is valid (not expired/revoked). Live check is the CA's job. */
  active: boolean;
  /** Optional extra cert attributes (e.g. accreditation flags). */
  attributes?: Record<string, string>;
}

export interface WriteContext {
  /** For `collection`: the tier decides Collector-vs-CFA authority. */
  entryMethod?: 'TIER1_PWA' | 'TIER2_OFFLINE' | 'TIER3_SMS' | 'TIER4_CFA';
  /** For `quality-test:submit`/`endorse`: enforce incentive independence. */
  testingLabMsp?: string;
  verifierMsp?: string;
  verifierRole?: 'REGULATOR' | 'SECOND_LAB';
}

export type AuthzDenyReason =
  | 'CERT_INACTIVE'
  | 'ROLE_NOT_PERMITTED'
  | 'ENTRY_METHOD_MISMATCH'
  | 'NOT_INDEPENDENT_ENDORSER';

export interface AuthzDecision {
  allowed: boolean;
  role: Role;
  action: WriteAction | ReadAction;
  reason?: AuthzDenyReason;
  message?: string;
}

const allow = (role: Role, action: WriteAction | ReadAction): AuthzDecision => ({
  allowed: true,
  role,
  action,
});

const deny = (
  role: Role,
  action: WriteAction | ReadAction,
  reason: AuthzDenyReason,
  message: string,
): AuthzDecision => ({ allowed: false, role, action, reason, message });

/** Authorize a write. Runs before MPR / chaincode business rules. */
export function authorizeWrite(
  identity: Identity,
  action: WriteAction,
  context: WriteContext = {},
): AuthzDecision {
  if (!identity.active) {
    return deny(identity.role, action, 'CERT_INACTIVE', 'Identity certificate is expired or revoked.');
  }

  if (!WRITE_MATRIX[action].includes(identity.role)) {
    return deny(identity.role, action, 'ROLE_NOT_PERMITTED', `Role ${identity.role} may not perform ${action}.`);
  }

  // Tier alignment for collection: a CFA-tier event must come from a CFA, and a
  // non-CFA tier must not be submitted under a CFA role masquerading as the collector.
  if (action === 'collection' && context.entryMethod) {
    const isCfaTier = context.entryMethod === 'TIER4_CFA';
    if (isCfaTier && identity.role !== 'CFA') {
      return deny(identity.role, action, 'ENTRY_METHOD_MISMATCH', 'TIER4_CFA collection requires a CFA identity.');
    }
    if (!isCfaTier && identity.role === 'CFA') {
      return deny(identity.role, action, 'ENTRY_METHOD_MISMATCH', 'A CFA identity must use TIER4_CFA for collection.');
    }
  }

  // Incentive independence for endorsement (RBAC layer of the dual-endorsement rule).
  if (action === 'quality-test:endorse') {
    const { testingLabMsp, verifierMsp, verifierRole } = context;
    if (testingLabMsp && verifierMsp && testingLabMsp === verifierMsp) {
      return deny(identity.role, action, 'NOT_INDEPENDENT_ENDORSER', 'Endorser MSP must differ from the testing lab MSP.');
    }
    // A LAB may endorse only as an accredited SECOND_LAB; a REGULATOR always may.
    if (identity.role === 'LAB' && verifierRole !== 'SECOND_LAB') {
      return deny(identity.role, action, 'NOT_INDEPENDENT_ENDORSER', 'A lab may endorse only as an accredited SECOND_LAB.');
    }
  }

  return allow(identity.role, action);
}

/** Authorize a read. */
export function authorizeRead(identity: Identity, action: ReadAction): AuthzDecision {
  if (!identity.active) {
    return deny(identity.role, action, 'CERT_INACTIVE', 'Identity certificate is expired or revoked.');
  }
  if (!READ_MATRIX[action].includes(identity.role)) {
    return deny(identity.role, action, 'ROLE_NOT_PERMITTED', `Role ${identity.role} may not read ${action}.`);
  }
  return allow(identity.role, action);
}

/**
 * ⚠️ CONTRACT GAP: there is no authorization code in the frozen `RejectCode` enum, so a
 * denial cannot be expressed as a typed business reject without a contract change. This
 * helper deliberately returns a NON-contract 403 envelope and documents the gap rather
 * than mis-labelling an authz denial as, say, LICENSE_INVALID. If the contract owner
 * adds an `UNAUTHORIZED` code, switch the `code` here to it.
 */
export function toRejectEnvelope(decision: AuthzDecision): {
  ok: false;
  httpStatus: 403;
  /** Intentionally NOT a RejectCode — see the note above. */
  code: 'UNAUTHORIZED_PENDING_CONTRACT_CODE';
  message: string;
  detail: { role: Role; action: WriteAction | ReadAction; reason?: AuthzDenyReason };
} {
  return {
    ok: false,
    httpStatus: 403,
    code: 'UNAUTHORIZED_PENDING_CONTRACT_CODE',
    message: decision.message ?? 'Not authorized.',
    detail: { role: decision.role, action: decision.action, ...(decision.reason ? { reason: decision.reason } : {}) },
  };
}

/** Re-exported so callers know the business codes exist but none fits authz denial. */
export { RejectCode };

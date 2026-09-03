/**
 * Tier-4 CFA intake orchestration (component 2).
 *
 * HONESTY TAG: 🟢 BUILT — gates a CFA-on-behalf collection on (1) an active DPDP consent,
 * (2) a matching collector biometric, and (3) CFA authorization, then produces the frozen
 * `CollectionRequest` with `entryMethod: 'TIER4_CFA'` plus an attribution record. 🟡/🔵 the
 * capture device and on-chain CFA cert revocation are SIMULATED/DESIGNED.
 *
 * Attribution & the contract: the request carries the COLLECTOR as `collectorId`; the CFA
 * identity is recorded as a co-signing endorser. The frozen home for that is the event's
 * `CollectionExtensions.blockchain.endorsers` (epcis.ts) — so attribution rides an existing
 * field, no contract change. This module returns the endorser list for the gateway to place.
 */
import type { CollectionRequest } from '../../contracts/index.js';
import { authorizeWrite, type Identity } from '../rbac/rbac.js';
import { ConsentStore } from './consent.js';
import { verifyBiometric, type BiometricCapture, type StoredBiometric } from './biometric.js';

export const CFA_COLLECTION_PURPOSE = 'COLLECTION_LOGGING';

export interface CfaIntakeParams {
  cfaIdentity: Identity;
  collectorId: string;
  purpose?: string;
  collection: {
    speciesCode: string;
    quantityKg: number;
    plantPart: string;
    season: string;
    location: { lat: number; lon: number; altitudeM: number };
    photoIpfsCID?: string;
  };
}

export interface CfaIntakeDeps {
  consent: ConsentStore;
  capture: BiometricCapture;
  /** The collector's enrolled biometric (looked up by the caller). */
  enrolledBiometric: StoredBiometric | null;
}

export type CfaIntakeDenyReason =
  | 'NOT_A_CFA'
  | 'CONSENT_MISSING_OR_WITHDRAWN'
  | 'NO_ENROLLED_BIOMETRIC'
  | 'BIOMETRIC_MISMATCH';

export interface CfaAttribution {
  collectorId: string;
  cfaId: string;
  /** Endorser ids for `CollectionExtensions.blockchain.endorsers`. */
  endorsers: string[];
}

export type CfaIntakeResult =
  | { ok: true; request: CollectionRequest; attribution: CfaAttribution }
  | { ok: false; reason: CfaIntakeDenyReason; message: string };

/**
 * Run the Tier-4 intake gate. No event is produced unless consent is active AND the
 * biometric matches AND the CFA is authorized.
 */
export async function cfaIntake(params: CfaIntakeParams, deps: CfaIntakeDeps): Promise<CfaIntakeResult> {
  const purpose = params.purpose ?? CFA_COLLECTION_PURPOSE;

  // 1. CFA authorization (also blocks a revoked/expired CFA cert via identity.active).
  const authz = authorizeWrite(params.cfaIdentity, 'collection', { entryMethod: 'TIER4_CFA' });
  if (!authz.allowed) {
    return { ok: false, reason: 'NOT_A_CFA', message: authz.message ?? 'CFA not authorized for TIER4 collection.' };
  }

  // 2. Active, purpose-limited DPDP consent for THIS (collector, cfa, purpose).
  if (!deps.consent.hasActiveConsent(params.collectorId, params.cfaIdentity.msp, purpose)) {
    return {
      ok: false,
      reason: 'CONSENT_MISSING_OR_WITHDRAWN',
      message: 'No active DPDP consent for this collector, CFA and purpose.',
    };
  }

  // 3. Biometric match (collector authenticated by thumb).
  if (!deps.enrolledBiometric) {
    return { ok: false, reason: 'NO_ENROLLED_BIOMETRIC', message: 'Collector has no enrolled biometric.' };
  }
  const captured = await deps.capture.capture();
  if (!verifyBiometric(captured, deps.enrolledBiometric)) {
    return { ok: false, reason: 'BIOMETRIC_MISMATCH', message: 'Biometric did not match — no event written.' };
  }

  // Build the frozen request; collector is the subject, CFA co-signs as endorser.
  const request: CollectionRequest = {
    speciesCode: params.collection.speciesCode,
    quantityKg: params.collection.quantityKg,
    plantPart: params.collection.plantPart,
    collectorId: params.collectorId,
    season: params.collection.season,
    location: params.collection.location,
    entryMethod: 'TIER4_CFA',
    ...(params.collection.photoIpfsCID ? { photoIpfsCID: params.collection.photoIpfsCID } : {}),
  };

  return {
    ok: true,
    request,
    attribution: {
      collectorId: params.collectorId,
      cfaId: params.cfaIdentity.msp,
      endorsers: [params.cfaIdentity.msp],
    },
  };
}

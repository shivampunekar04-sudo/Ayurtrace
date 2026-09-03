/**
 * Domain model + frozen enums shared across all lanes.
 * Source of truth: execution plan §6.2, §6.3; solution §2B, §2C.
 */

/**
 * FROZEN reject-code enum (§6.2). The gateway's typed error contract and every
 * frontend's reject-code UI key off these exact strings. Never rename.
 */
export enum RejectCode {
  ZONE_VIOLATION = 'ZONE_VIOLATION',
  SEASON_VIOLATION = 'SEASON_VIOLATION',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  LICENSE_INVALID = 'LICENSE_INVALID',
  PART_VIOLATION = 'PART_VIOLATION',
  MASS_BALANCE_VIOLATION = 'MASS_BALANCE_VIOLATION',
  WEIGHT_VARIANCE_HOLD = 'WEIGHT_VARIANCE_HOLD',
  BATCH_STATUS_HOLD = 'BATCH_STATUS_HOLD',
  ENDORSEMENT_MISSING = 'ENDORSEMENT_MISSING',
}

/** Human-facing messages for reject-code UI (collector PWA §6). Interface voice, not apology. */
export const REJECT_MESSAGES: Record<RejectCode, string> = {
  [RejectCode.ZONE_VIOLATION]:
    'Outside the approved collection zone for this species. Move to an NMPB-approved zone or select the correct species.',
  [RejectCode.SEASON_VIOLATION]:
    'This species cannot be collected in the current season. Check the permitted harvest window.',
  [RejectCode.QUOTA_EXCEEDED]:
    'The annual sustainable quota for this species in this zone is exhausted. Collection reopens next season.',
  [RejectCode.LICENSE_INVALID]:
    'Your NMPB collector registration is inactive or expired. Renew it before submitting.',
  [RejectCode.PART_VIOLATION]:
    'This plant part is not permitted for this species under GACP. Collect the allowed part.',
  [RejectCode.MASS_BALANCE_VIOLATION]:
    'Output weight does not reconcile with inputs after expected loss. The batch is on hold pending review.',
  [RejectCode.WEIGHT_VARIANCE_HOLD]:
    'Weighed quantity differs from the declared amount beyond tolerance. Batch held for field inspection.',
  [RejectCode.BATCH_STATUS_HOLD]:
    'A required checkpoint has not passed. This batch cannot advance until it is resolved.',
  [RejectCode.ENDORSEMENT_MISSING]:
    'This quality result needs an incentive-independent second signature before it can commit.',
};

/** GACP batch lifecycle (§6.3). */
export enum GacpStatus {
  ACTIVE = 'ACTIVE',
  HOLD = 'HOLD',
  COMPLETE_PASSED = 'COMPLETE_PASSED',
  COMPLETE_FAILED = 'COMPLETE_FAILED',
}

/** GACP 7-checkpoint identifiers (§2C). */
export enum Checkpoint {
  CP1_COLLECTION_ZONE = 'CP-1',
  CP2_PART_QUANTITY = 'CP-2',
  CP3_WEIGH = 'CP-3',
  CP4_DRYING_TIME = 'CP-4',
  CP5_LAB_LIMITS = 'CP-5',
  CP6_DNA_IDENTITY = 'CP-6',
  CP7_FORMULATION_INPUTS = 'CP-7',
}

export type CheckpointStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'SKIPPED';

/** Reference data: a medicinal-plant species entry in the MPR. */
export interface SpeciesRule {
  /** short code, e.g. ASWG (Ashwagandha / Withania somnifera). */
  code: string;
  botanicalName: string;
  commonName: string;
  /** GACP-permitted plant parts. */
  allowedParts: string[];
  /** permitted harvest seasons. */
  allowedSeasons: string[];
  /** conservation status drives DNA-sampling ratio and GPS redaction. */
  endangered: boolean;
}

/** Reference data: an NMPB-approved collection zone for one or more species. */
export interface Zone {
  id: string; // urn:ayurtrace:zone:NMPB-KA-ZONE-07
  name: string;
  /** GeoJSON Polygon ring: [ [lon,lat], ... ] closed ring. */
  polygon: [number, number][];
}

/** Reference data: annual quota for a (species, zone, season). Key: species~zone~season. */
export interface Quota {
  speciesCode: string;
  zoneId: string;
  season: string;
  annualLimitKg: number;
  consumedKg: number;
}

/** Reference data: a registered collector. */
export interface Collector {
  id: string; // NMPB-COL-KA-8823
  cluster: string; // CLUSTER-TUMKUR-04
  licenseActive: boolean;
  licenseExpiry: string; // ISO date
}

/** Derived read model: a batch's current provenance + compliance state. */
export interface BatchRecord {
  epc: string;
  speciesCode: string;
  status: GacpStatus;
  /** 0–100 GACP score shown to consumers. */
  gacpScore: number;
  checkpoints: Record<Checkpoint, CheckpointStatus>;
  /** ordered event EPC-URIs that make up this batch's history. */
  eventKeys: string[];
  /** input lot EPCs when this batch is a transformation output (merge traceability). */
  inputEpcs: string[];
  flags: string[];
  zoneId: string;
  createdAt: string;
  updatedAt: string;
}

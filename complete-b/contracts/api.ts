/**
 * REST API DTOs — the frozen contract between gateway (§6.4) and all frontends.
 * Frontends run against these shapes on mocks until M2, then switch to live.
 */
import { RejectCode } from './domain.js';
import type { BatchRecord, Quota, Zone } from './domain.js';
import type { QualityMetric } from './epcis.js';

/** Uniform success envelope. */
export interface Ok<T> {
  ok: true;
  data: T;
}

/**
 * Uniform typed reject envelope. Every chaincode reject surfaces here with its
 * §6.2 code, so a frontend maps code → REJECT_MESSAGES without string parsing.
 */
export interface Rejected {
  ok: false;
  code: RejectCode;
  message: string;
  /** which checkpoint/check produced the reject, for the audit trail. */
  detail?: Record<string, unknown>;
}

export type ApiResult<T> = Ok<T> | Rejected;

// ---- POST /events/collection ------------------------------------------------
export interface CollectionRequest {
  speciesCode: string;
  quantityKg: number;
  plantPart: string;
  collectorId: string;
  season: string;
  location: { lat: number; lon: number; altitudeM: number };
  entryMethod: 'TIER1_PWA' | 'TIER2_OFFLINE' | 'TIER3_SMS' | 'TIER4_CFA';
  photoIpfsCID?: string;
  /** true when this event was queued offline and drew against a cluster soft-reserve. */
  offlineSoftReserve?: boolean;
}
export interface CollectionResponse {
  epc: string;
  txId: string;
  gacpScore: number;
}

// ---- POST /events/aggregation ----------------------------------------------
export interface AggregationRequest {
  parentEpc: string;
  childEpcs: string[];
  declaredKg: number;
  measuredKg: number;
  zoneId: string;
}

// ---- POST /events/transformation -------------------------------------------
export interface TransformationRequest {
  kind: 'PROCESS' | 'MERGE' | 'FORMULATION';
  inputs: { epc: string; quantityKg: number }[];
  outputKg: number;
  declaredLossFactor: number;
  zoneId: string;
  /** collection→processing gap for CP-4 (seconds); optional until CP-4 promotion. */
  dryingGapSeconds?: number;
}
export interface TransformationResponse {
  outputEpc: string;
  txId: string;
  inputEpcs: string[];
}

// ---- POST /events/quality-test ---------------------------------------------
export interface QualityTestRequest {
  epc: string;
  metrics: QualityMetric[];
  dna?: { declaredSpecies: string; confirmedSpecies: string };
  ipfsCID: string;
  testingLabMsp: string;
  verifierMsp: string;
  verifierRole: 'REGULATOR' | 'SECOND_LAB';
}

// ---- POST /events/formulation ----------------------------------------------
export interface FormulationRequest {
  inputEpcs: string[];
  productName: string;
  unitCount: number;
  manufacturerMsp: string;
}
export interface FormulationResponse {
  productEpc: string;
  serials: string[];
  txId: string;
}

// ---- GET /batch/:epc --------------------------------------------------------
export interface BatchTimelineResponse {
  batch: BatchRecord;
  /** flattened, ordered timeline for the consumer PWA and audit trail. */
  timeline: TimelineStep[];
}
export interface TimelineStep {
  step:
    | 'COLLECTION'
    | 'AGGREGATION'
    | 'PROCESSING'
    | 'TESTING'
    | 'FORMULATION'
    | 'CUSTODY';
  label: string;
  time: string;
  /** zone-level location only for public; precise coords redacted here. */
  zoneId: string;
  detail: Record<string, unknown>;
}

// ---- GET /zones and /zones/:id/quota ---------------------------------------
export interface ZonesResponse {
  zones: Zone[];
}
export interface ZoneQuotaResponse {
  zoneId: string;
  quotas: (Quota & { consumedPct: number; band: 'GREEN' | 'AMBER' | 'RED' })[];
}

// ---- POST /recall/:epc ------------------------------------------------------
export interface RecallResponse {
  originEpc: string;
  /** every finished product that used this batch. */
  affectedProducts: string[];
  /** sibling batches from same collector/zone (blast radius). */
  siblingBatches: string[];
  /** contributing source lots when the origin is a merged output. */
  sourceLots: { epc: string; collectorId: string; zoneId: string; proportion: number }[];
}

// ---- GET /qr/:serial/verify -------------------------------------------------
export interface QrVerifyResponse {
  serial: string;
  valid: boolean;
  productEpc: string;
  /** false when a copied QR fails manufacturer signature verification. */
  signatureValid: boolean;
  gacpScore: number;
  verifiedAuthentic: boolean;
}

/** §6.4 endpoint paths, frozen so clients and server never drift. */
export const ENDPOINTS = {
  collection: '/events/collection',
  aggregation: '/events/aggregation',
  transformation: '/events/transformation',
  qualityTest: '/events/quality-test',
  formulation: '/events/formulation',
  batch: (epc: string) => `/batch/${encodeURIComponent(epc)}`,
  zones: '/zones',
  zoneQuota: (id: string) => `/zones/${encodeURIComponent(id)}/quota`,
  recall: (epc: string) => `/recall/${encodeURIComponent(epc)}`,
  qrVerify: (serial: string) => `/qr/${encodeURIComponent(serial)}/verify`,
} as const;

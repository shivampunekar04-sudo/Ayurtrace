/**
 * GS1 EPCIS 2.0 event model (JSON-LD), constrained to AyurTrace's supply chain.
 *
 * Source of truth: International_hackathon_solution_v2.md §4 and §4.2.
 * Vendor-specific fields use the `ayurtrace:` namespace as EPCIS 2.0 extension
 * properties — valid, interoperable, inspectable by any GS1-aware system.
 *
 * These types are FROZEN (execution plan §6.1). Do not change a field without
 * telling all five lanes; chaincode, gateway and all frontends import from here.
 */

export const EPCIS_CONTEXT =
  'https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld';

/** Unit of measure — GS1 UN/CEFACT codes. KGM = kilograms. */
export type Uom = 'KGM';

/** EPCIS bizStep vocabulary used by AyurTrace. */
export type BizStep =
  | 'commissioning' // herb harvested (new object)
  | 'shipping' // custody handoff out
  | 'receiving' // custody handoff in
  | 'inspecting' // quality test
  | 'transforming'; // processing / formulation

export type Disposition = 'active' | 'in_progress' | 'in_transit' | 'recalled';

export type EpcisEventType =
  | 'ObjectEvent'
  | 'AggregationEvent'
  | 'TransformationEvent';

export type EpcisAction = 'ADD' | 'OBSERVE' | 'DELETE';

/** A quantity of an EPC class (used for mass tracking and mass balance). */
export interface QuantityElement {
  /** e.g. urn:ayurtrace:species:ASWG */
  epcClass: string;
  quantity: number;
  uom: Uom;
}

export interface ReadPoint {
  /** e.g. urn:ayurtrace:zone:NMPB-KA-ZONE-07 */
  id: string;
}

/** Plant-part compliance snapshot recorded at collection (MPR check 5). */
export interface PlantPartCheck {
  submitted: string; // e.g. ROOT
  allowed: string; // GACP-permitted part for this species
  check: 'PASSED' | 'FAILED';
}

/** Geolocation captured at source, with public-precision redaction. */
export interface GeoCapture {
  lat: number;
  lon: number;
  altitudeM: number;
  /** Consumers see ZONE_ONLY; precise coords are regulator-only (§3B GPS privacy fix). */
  publicPrecision: 'ZONE_ONLY' | 'PRECISE';
  geoFenceCheck: 'PASSED' | 'FAILED';
  cellTowerCrossCheck: 'PASSED' | 'FAILED' | 'DEGRADED';
  /** Distance between hardware GPS and cross-signal, metres. */
  varianceM: number;
}

/** Season/quota reconciliation snapshot (MPR checks 2 & 3, offline soft-reserve). */
export interface HarvestCompliance {
  season: string; // e.g. RABI
  seasonCompliant: boolean;
  quotaRemainingBeforeKg: number;
  quotaDeductedKg: number;
  quotaRemainingAfterKg: number;
  quotaSource: 'LIVE_ZONE_QUOTA' | 'CLUSTER_SOFT_RESERVE';
  /** true once a soft-reserve draw has been reconciled against the true zone quota. */
  reconciled: boolean;
  /** set when an offline over-draw committed flagged (bounded/attributed, not silent). */
  overDrawFlagged?: boolean;
}

export interface PhotoEvidence {
  ipfsCID: string;
  exifGpsMatch: 'PASSED' | 'FAILED' | 'ABSENT';
}

export interface PolkAttestation {
  status: 'CONFIRMED' | 'UNCONFIRMED' | 'DISPUTED';
  confirmations: number;
  disputes: number;
}

/** The five MPR checks, recorded on-chain for audit. */
export interface MprValidationRecord {
  geoFence: CheckResult;
  season: CheckResult;
  quota: CheckResult;
  license: CheckResult;
  plantPart: CheckResult;
  overall: 'ALL_PASSED' | 'REJECTED';
}
export type CheckResult = 'PASSED' | 'FAILED';

export interface BlockchainMeta {
  network: string;
  channel: string;
  chaincode: string;
  txId: string;
  block?: number;
  endorsers: string[];
}

/** `ayurtrace:` extension block carried on a collection ObjectEvent. */
export interface CollectionExtensions {
  collectorId: string;
  collectorCluster: string;
  entryMethod: 'TIER1_PWA' | 'TIER2_OFFLINE' | 'TIER3_SMS' | 'TIER4_CFA';
  plantPart: PlantPartCheck;
  location: GeoCapture;
  harvest: HarvestCompliance;
  photoEvidence?: PhotoEvidence;
  polk: PolkAttestation;
  mprValidation: MprValidationRecord;
  blockchain?: BlockchainMeta;
}

/**
 * ObjectEvent — used for commissioning (origin) and custody (shipping/receiving).
 * Matches solution §4.2 for the commissioning case.
 */
export interface ObjectEvent {
  '@context': [typeof EPCIS_CONTEXT];
  type: 'ObjectEvent';
  eventTime: string; // ISO 8601 with offset
  eventTimeZoneOffset: string; // e.g. +05:30
  action: EpcisAction;
  bizStep: BizStep;
  disposition: Disposition;
  epcList: string[];
  readPoint: ReadPoint;
  quantityList: QuantityElement[];
  /** Present only on commissioning events. */
  'ayurtrace:collection'?: CollectionExtensions;
}

/**
 * AggregationEvent — many collector lots physically grouped into one container.
 * Solves the physical-grouping case; distinct from the merge/mix (Transformation).
 */
export interface AggregationEvent {
  '@context': [typeof EPCIS_CONTEXT];
  type: 'AggregationEvent';
  eventTime: string;
  eventTimeZoneOffset: string;
  action: EpcisAction;
  bizStep: BizStep;
  disposition: Disposition;
  /** container EPC */
  parentID: string;
  /** grouped child lot EPCs */
  childEPCs: string[];
  readPoint: ReadPoint;
  /** weighbridge reconciliation at aggregation (CP-3). */
  'ayurtrace:weigh'?: {
    declaredKg: number;
    measuredKg: number;
    variancePct: number;
    tolerancePct: number;
    result: 'PASSED' | 'WEIGHT_VARIANCE_HOLD';
  };
}

/** A single input lot contributing to a transformation, with its proportion. */
export interface TransformationInput {
  epc: string;
  quantity: number;
  uom: Uom;
  /** fraction of the output attributable to this input (0..1), sums to 1 across inputs. */
  proportion: number;
}

/**
 * TransformationEvent — THE mixing / mass-balance solution (solution §4.1).
 * N input batches → 1 (or more) output lots. Chaincode enforces:
 *   Σ(input_kg) × (1 − declaredLossFactor) == Σ(output_kg) ± tolerance
 * Output lots retain traceable links to every input EPC with proportions,
 * so "source lost forever" becomes "source apportioned and queryable."
 */
export interface TransformationEvent {
  '@context': [typeof EPCIS_CONTEXT];
  type: 'TransformationEvent';
  eventTime: string;
  eventTimeZoneOffset: string;
  bizStep: 'transforming';
  disposition: Disposition;
  inputQuantityList: TransformationInput[];
  outputQuantityList: QuantityElement[];
  outputEPCList: string[];
  readPoint: ReadPoint;
  'ayurtrace:transform': {
    /** 'PROCESS' (dry/powder/extract) | 'MERGE' (broker mixing) | 'FORMULATION' (product). */
    kind: 'PROCESS' | 'MERGE' | 'FORMULATION';
    /** expected post-harvest loss for this step, seeded from GACP norms. */
    declaredLossFactor: number;
    massBalance: {
      inputKg: number;
      outputKg: number;
      expectedOutputKg: number;
      tolerancePct: number;
      variancePct: number;
      result: 'PASSED' | 'MASS_BALANCE_VIOLATION';
    };
    /** CP-4 drying-time gate (promotion): gap between collection and processing. */
    dryingGapSeconds?: number;
  };
}

/** quality_test ObjectEvent — dual-endorsed lab result (solution §2D). */
export interface QualityTestEvent {
  '@context': [typeof EPCIS_CONTEXT];
  type: 'ObjectEvent';
  eventTime: string;
  eventTimeZoneOffset: string;
  action: 'OBSERVE';
  bizStep: 'inspecting';
  disposition: Disposition;
  epcList: string[];
  readPoint: ReadPoint;
  'ayurtrace:qualityTest': {
    /** measured values vs WHO/AYUSH limits (CP-5). */
    metrics: QualityMetric[];
    /** DNA barcode identity confirmation (CP-6), risk-weighted sample. */
    dnaBarcode?: {
      markers: ('ITS2' | 'psbA-trnH')[];
      declaredSpecies: string;
      confirmedSpecies: string;
      match: boolean;
    };
    ipfsCID: string; // certificate content-addressed hash
    /** incentive-independent dual endorsement metadata (Lab + Regulator, or 2nd lab). */
    endorsement: {
      testingLabMsp: string;
      verifierMsp: string; // NMPB regulator (default) or 2nd accredited lab (export)
      verifierRole: 'REGULATOR' | 'SECOND_LAB';
    };
    result: 'PASSED' | 'FAILED';
  };
}

export interface QualityMetric {
  name: 'moisture' | 'lead' | 'arsenic' | 'mercury' | 'cadmium' | 'pesticide';
  value: number;
  unit: string;
  limit: number;
  withinLimit: boolean;
}

export type AnyEpcisEvent =
  | ObjectEvent
  | AggregationEvent
  | TransformationEvent
  | QualityTestEvent;

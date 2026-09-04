/**
 * LedgerBackend — the gateway's port over the ledger. Two implementations:
 *  - FabricLedgerBackend  (production; invokes chaincode via @hyperledger/fabric-gateway)
 *  - DemoLedgerBackend     (local demo; runs the same chaincode service in-memory)
 * Controllers depend only on this interface, so switching backends is one env flag.
 */
import type {
  CollectionRequest,
  CollectionResponse,
  AggregationRequest,
  TransformationRequest,
  TransformationResponse,
  QualityTestRequest,
  FormulationRequest,
  FormulationResponse,
  BatchTimelineResponse,
  ZonesResponse,
  ZoneQuotaResponse,
  RecallResponse,
  BatchRecord,
  SpeciesRule,
  Collector,
} from '@ayurtrace/contracts';
import type { LedgerStats } from 'ayurledger/service';

export const LEDGER_BACKEND = Symbol('LEDGER_BACKEND');

export interface LedgerBackend {
  submitCollection(req: CollectionRequest): Promise<CollectionResponse>;
  submitAggregation(req: AggregationRequest): Promise<{ containerEpc: string; txId: string }>;
  submitTransformation(req: TransformationRequest): Promise<TransformationResponse>;
  submitQualityTest(req: QualityTestRequest): Promise<{ txId: string; result: 'PASSED' | 'FAILED' }>;
  submitFormulation(req: FormulationRequest): Promise<FormulationResponse>;
  getBatch(epc: string): Promise<BatchTimelineResponse>;
  listZones(): Promise<ZonesResponse>;
  zoneQuota(zoneId: string): Promise<ZoneQuotaResponse>;
  recall(epc: string): Promise<RecallResponse>;
  listBatches(): Promise<{ batches: BatchRecord[] }>;
  listSpecies(): Promise<{ species: SpeciesRule[] }>;
  listCollectors(): Promise<{ collectors: Collector[] }>;
  stats(): Promise<LedgerStats>;
}

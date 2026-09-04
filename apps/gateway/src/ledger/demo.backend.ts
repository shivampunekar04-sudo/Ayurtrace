/**
 * DemoLedgerBackend — runs the ACTUAL AyurLedger chaincode service against an
 * in-memory ledger. This is not a mock: it is the same enforcement code that
 * runs on Fabric, so every reject code and every state transition is identical.
 * It exists so the gateway + all three UIs run on one machine with no network
 * (execution plan R6: "golden path fully local = network-independent = safe").
 */
import { Injectable, Logger } from '@nestjs/common';
import { AyurLedgerService } from 'ayurledger/service';
import { MemoryLedger } from 'ayurledger/ledger';
import { seedRefs } from '@ayurtrace/seed';
import type {
  CollectionRequest, AggregationRequest, TransformationRequest,
  QualityTestRequest, FormulationRequest,
} from '@ayurtrace/contracts';
import type { LedgerBackend } from './ledger.backend.js';

@Injectable()
export class DemoLedgerBackend implements LedgerBackend {
  private readonly log = new Logger('DemoLedger');
  private readonly ledger = new MemoryLedger();
  private readonly svc = new AyurLedgerService(this.ledger);
  private ready: Promise<void>;

  constructor() {
    this.ready = this.svc.initLedger(seedRefs()).then(() => {
      this.log.log('In-memory ledger seeded (5 species, 3 zones, 4 collectors).');
    });
  }

  /** Re-seed deterministically — powers `reset-demo` without a process restart. */
  async reset(): Promise<void> {
    (this.ledger as MemoryLedger).setClock('2026-04-15T06:47:00+05:30');
    await this.svc.initLedger(seedRefs());
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    return fn();
  }

  submitCollection(req: CollectionRequest) { return this.guard(() => this.svc.submitCollection(req)); }
  submitAggregation(req: AggregationRequest) { return this.guard(() => this.svc.submitAggregation(req)); }
  submitTransformation(req: TransformationRequest) { return this.guard(() => this.svc.submitTransformation(req)); }
  submitQualityTest(req: QualityTestRequest) { return this.guard(() => this.svc.submitQualityTest(req)); }
  submitFormulation(req: FormulationRequest) { return this.guard(() => this.svc.submitFormulation(req)); }
  getBatch(epc: string) { return this.guard(() => this.svc.getBatch(epc)); }
  listZones() { return this.guard(() => this.svc.listZones()); }
  zoneQuota(zoneId: string) { return this.guard(() => this.svc.zoneQuota(zoneId)); }
  recall(epc: string) { return this.guard(() => this.svc.recall(epc)); }
  listBatches() { return this.guard(() => this.svc.listBatches()); }
  listSpecies() { return this.guard(() => this.svc.listSpecies()); }
  listCollectors() { return this.guard(() => this.svc.listCollectors()); }
  stats() { return this.guard(() => this.svc.stats()); }
}

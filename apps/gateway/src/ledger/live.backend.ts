/**
 * LiveLedgerBackend — the product demo backend.
 *
 * Same AyurLedgerService enforcement as chaincode + demo, but over a durable
 * FileLedger with a real wall-clock. Seeds reference data on first boot (empty
 * file), then every write a judge makes is committed to disk and survives a
 * restart. This is what runs behind the dashboards for a "real market" demo.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AyurLedgerService } from 'ayurledger/service';
import { seedRefs } from '@ayurtrace/seed';
import type {
  CollectionRequest, AggregationRequest, TransformationRequest,
  QualityTestRequest, FormulationRequest,
} from '@ayurtrace/contracts';
import type { LedgerBackend } from './ledger.backend.js';
import { FileLedger } from './file-ledger.js';
import { dataFile } from '../config/env.js';

@Injectable()
export class LiveLedgerBackend implements LedgerBackend, OnModuleInit {
  private readonly log = new Logger('LiveLedger');
  private readonly ledger = new FileLedger(dataFile());
  private readonly svc = new AyurLedgerService(this.ledger);
  private ready!: Promise<void>;

  onModuleInit(): void {
    this.ready = this.boot();
  }

  private async boot(): Promise<void> {
    const hadData = await this.ledger.load();
    if (!hadData) {
      await this.svc.initLedger(seedRefs());
      await this.ledger.flush();
      this.log.log(`Fresh ledger seeded and persisted to ${dataFile()}.`);
    } else {
      this.log.log(`Loaded persisted ledger from ${dataFile()}.`);
    }
  }

  /** Wipe and re-seed the durable ledger (admin reset). */
  async reset(): Promise<void> {
    await this.ready;
    this.ledger.clear();
    await this.svc.initLedger(seedRefs());
    await this.ledger.flush();
    this.log.log('Live ledger reset to seed.');
  }

  private async read<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    return fn();
  }

  /** A write: run enforcement, persist on commit, roll back on a rejected tx. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    try {
      const result = await fn();
      await this.ledger.flush();
      return result;
    } catch (e) {
      // a rejected tx must not commit — discard any partial in-memory writes
      await this.ledger.reload();
      throw e;
    }
  }

  submitCollection(req: CollectionRequest) { return this.write(() => this.svc.submitCollection(req)); }
  submitAggregation(req: AggregationRequest) { return this.write(() => this.svc.submitAggregation(req)); }
  submitTransformation(req: TransformationRequest) { return this.write(() => this.svc.submitTransformation(req)); }
  submitQualityTest(req: QualityTestRequest) { return this.write(() => this.svc.submitQualityTest(req)); }
  submitFormulation(req: FormulationRequest) { return this.write(() => this.svc.submitFormulation(req)); }
  getBatch(epc: string) { return this.read(() => this.svc.getBatch(epc)); }
  listZones() { return this.read(() => this.svc.listZones()); }
  zoneQuota(zoneId: string) { return this.read(() => this.svc.zoneQuota(zoneId)); }
  recall(epc: string) { return this.read(() => this.svc.recall(epc)); }
  listBatches() { return this.read(() => this.svc.listBatches()); }
  listSpecies() { return this.read(() => this.svc.listSpecies()); }
  listCollectors() { return this.read(() => this.svc.listCollectors()); }
  stats() { return this.read(() => this.svc.stats()); }
}

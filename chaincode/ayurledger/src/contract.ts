/**
 * AyurLedger Fabric chaincode entrypoint (Hyperledger Fabric v2.5).
 *
 * The enforcement logic lives in mpr.ts + service.ts and is fully unit-tested.
 * This file is the thin adapter that lets that identical service run on a real
 * peer: it maps Fabric's ChaincodeStub onto the LedgerPort seam, and exposes
 * the write/read paths as @Transaction functions.
 *
 * Endorsement: collection events are endorsed by CollectorOrg + NMPB-RegulatorOrg;
 * quality_test additionally requires the incentive-independent verifier org
 * (enforced in service.checkEndorsement AND by the channel endorsement policy).
 */
import type { Context } from 'fabric-contract-api';
import fabricContractApi from 'fabric-contract-api';
import type { ChaincodeStub } from 'fabric-shim';

// fabric-contract-api is CommonJS; under ESM its named members come off the default export.
const { Contract, Info, Transaction, Returns } = fabricContractApi;
import type {
  CollectionRequest,
  AggregationRequest,
  TransformationRequest,
  QualityTestRequest,
  FormulationRequest,
} from '@ayurtrace/contracts';
import type { LedgerPort, StateKV } from './ledger.js';
import { AyurLedgerService, LedgerReject } from './service.js';
import { seedRefs } from './seed-embedded.js';

/** Adapts Fabric's ChaincodeStub to the LedgerPort the service depends on. */
class FabricLedger implements LedgerPort {
  constructor(private readonly stub: ChaincodeStub) {}

  async getState(key: string): Promise<string | undefined> {
    const buf = await this.stub.getState(key);
    return buf && buf.length ? Buffer.from(buf).toString('utf8') : undefined;
  }
  async putState(key: string, value: string): Promise<void> {
    await this.stub.putState(key, Buffer.from(value));
  }
  async deleteState(key: string): Promise<void> {
    await this.stub.deleteState(key);
  }
  createCompositeKey(objectType: string, attributes: string[]): string {
    return this.stub.createCompositeKey(objectType, attributes);
  }
  async getByPartialCompositeKey(objectType: string, attributes: string[]): Promise<StateKV[]> {
    const out: StateKV[] = [];
    // fabric-shim intersects AsyncIterable onto the Promise, so iterate it directly.
    for await (const kv of this.stub.getStateByPartialCompositeKey(objectType, attributes)) {
      out.push({ key: String(kv.key), value: Buffer.from(kv.value).toString('utf8') });
    }
    return out;
  }
  txId(): string {
    return this.stub.getTxID();
  }
  txTimestampIso(): string {
    const ts = this.stub.getTxTimestamp();
    const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6);
    return new Date(ms).toISOString();
  }
}

/** Wrap a service call, converting a LedgerReject into a Fabric-friendly error. */
async function guard<T>(fn: () => Promise<T>): Promise<string> {
  try {
    const result = await fn();
    return JSON.stringify({ ok: true, data: result });
  } catch (e) {
    if (e instanceof LedgerReject) {
      // Non-2xx on chaincode = tx does not commit. Surface the frozen §6.2 code.
      throw new Error(JSON.stringify({ ok: false, code: e.code, detail: e.detail ?? {} }));
    }
    throw e;
  }
}

@Info({ title: 'AyurLedger', description: 'EPCIS 2.0 botanical traceability with MPR + GACP enforcement' })
export class AyurLedgerContract extends Contract {
  private svc(ctx: Context): AyurLedgerService {
    return new AyurLedgerService(new FabricLedger(ctx.stub));
  }

  /** Seed reference data — invoked once after deploy (idempotent per key). */
  @Transaction()
  async InitLedger(ctx: Context): Promise<void> {
    await this.svc(ctx).initLedger(seedRefs());
  }

  @Transaction()
  @Returns('string')
  async SubmitCollection(ctx: Context, requestJson: string): Promise<string> {
    const req = JSON.parse(requestJson) as CollectionRequest;
    return guard(() => this.svc(ctx).submitCollection(req));
  }

  @Transaction()
  @Returns('string')
  async SubmitAggregation(ctx: Context, requestJson: string): Promise<string> {
    const req = JSON.parse(requestJson) as AggregationRequest;
    return guard(() => this.svc(ctx).submitAggregation(req));
  }

  @Transaction()
  @Returns('string')
  async SubmitTransformation(ctx: Context, requestJson: string): Promise<string> {
    const req = JSON.parse(requestJson) as TransformationRequest;
    return guard(() => this.svc(ctx).submitTransformation(req));
  }

  @Transaction()
  @Returns('string')
  async SubmitQualityTest(ctx: Context, requestJson: string): Promise<string> {
    const req = JSON.parse(requestJson) as QualityTestRequest;
    return guard(() => this.svc(ctx).submitQualityTest(req));
  }

  @Transaction()
  @Returns('string')
  async SubmitFormulation(ctx: Context, requestJson: string): Promise<string> {
    const req = JSON.parse(requestJson) as FormulationRequest;
    return guard(() => this.svc(ctx).submitFormulation(req));
  }

  @Transaction(false)
  @Returns('string')
  async GetBatch(ctx: Context, epc: string): Promise<string> {
    return guard(() => this.svc(ctx).getBatch(epc));
  }

  @Transaction(false)
  @Returns('string')
  async ListZones(ctx: Context): Promise<string> {
    return guard(() => this.svc(ctx).listZones());
  }

  @Transaction(false)
  @Returns('string')
  async ZoneQuota(ctx: Context, zoneId: string): Promise<string> {
    return guard(() => this.svc(ctx).zoneQuota(zoneId));
  }

  @Transaction(false)
  @Returns('string')
  async Recall(ctx: Context, epc: string): Promise<string> {
    return guard(() => this.svc(ctx).recall(epc));
  }

  @Transaction(false)
  @Returns('string')
  async ListBatches(ctx: Context): Promise<string> {
    return guard(() => this.svc(ctx).listBatches());
  }

  @Transaction(false)
  @Returns('string')
  async ListSpecies(ctx: Context): Promise<string> {
    return guard(() => this.svc(ctx).listSpecies());
  }

  @Transaction(false)
  @Returns('string')
  async ListCollectors(ctx: Context): Promise<string> {
    return guard(() => this.svc(ctx).listCollectors());
  }

  @Transaction(false)
  @Returns('string')
  async Stats(ctx: Context): Promise<string> {
    return guard(() => this.svc(ctx).stats());
  }
}

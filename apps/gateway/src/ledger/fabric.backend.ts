/**
 * FabricLedgerBackend — production path. Connects to the AyurLedger chaincode on
 * Hyperledger Fabric v2.5 via @hyperledger/fabric-gateway and marshals the
 * {ok,data}|{ok,code} envelope the chaincode returns (contract.ts::guard).
 *
 * Identity is held server-side (execution plan §Identity: "gateway holds
 * identities server-side — flag on stage"). Enrollment material paths come from
 * env (config/env.ts). This class type-checks against the real SDK; it requires
 * a running network (Phase 0 / M0) to execute — the demo backend covers local runs.
 */
import { Injectable, Logger } from '@nestjs/common';
// Runtime values (`connect`, `signers`) are loaded lazily inside client() via a
// dynamic import so that merely importing this class in demo mode does NOT pull
// in @hyperledger/fabric-gateway (a CJS package whose transitive ESM deps break
// require() under Node's ESM loader). Types are erased at compile time.
import type { Gateway, Contract } from '@hyperledger/fabric-gateway';
import * as grpc from '@grpc/grpc-js';
import { promises as fs } from 'node:fs';
import * as crypto from 'node:crypto';
import { RejectCode } from '@ayurtrace/contracts';
import type {
  CollectionRequest, CollectionResponse, AggregationRequest, TransformationRequest,
  TransformationResponse, QualityTestRequest, FormulationRequest, FormulationResponse,
  BatchTimelineResponse, ZonesResponse, ZoneQuotaResponse, RecallResponse,
  BatchRecord, SpeciesRule, Collector,
} from '@ayurtrace/contracts';
import type { LedgerStats } from 'ayurledger/service';
import type { LedgerBackend } from './ledger.backend.js';
import { LedgerReject } from '../common/reject.js';
import { fabricConfig } from '../config/env.js';

const utf8 = new TextDecoder();
const enc = new TextEncoder();

@Injectable()
export class FabricLedgerBackend implements LedgerBackend {
  private readonly log = new Logger('FabricLedger');
  private gateway?: Gateway;
  private contract?: Contract;

  private async client(): Promise<Contract> {
    if (this.contract) return this.contract;
    const { connect, signers } = await import('@hyperledger/fabric-gateway');
    const cfg = fabricConfig();
    const tlsRootCert = await fs.readFile(cfg.tlsCertPath);
    const credentials = grpc.credentials.createSsl(tlsRootCert);
    const grpcClient = new grpc.Client(cfg.peerEndpoint, credentials, {
      'grpc.ssl_target_name_override': cfg.peerHostAlias,
    });
    const certificate = await fs.readFile(cfg.certPath);
    const privateKeyPem = await fs.readFile(cfg.keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);

    this.gateway = connect({
      client: grpcClient,
      identity: { mspId: cfg.mspId, credentials: certificate },
      signer: signers.newPrivateKeySigner(privateKey),
      evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),
      submitOptions: () => ({ deadline: Date.now() + 5000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    const network = this.gateway.getNetwork(cfg.channel);
    this.contract = network.getContract(cfg.chaincode);
    this.log.log(`Connected to ${cfg.channel}/${cfg.chaincode} at ${cfg.peerEndpoint}`);
    return this.contract;
  }

  /** Parse the chaincode {ok,data}|{ok,code} envelope; a reject becomes a typed error. */
  private unwrap<T>(bytes: Uint8Array): T {
    const parsed = JSON.parse(utf8.decode(bytes));
    if (parsed.ok === false) {
      throw new LedgerReject(parsed.code as RejectCode, parsed.detail);
    }
    return parsed.data as T;
  }

  private parseError(e: unknown): never {
    // Chaincode throws Error(JSON({ok:false,code})) on a business reject.
    const msg = e instanceof Error ? e.message : String(e);
    const match = msg.match(/\{.*\}/s);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.ok === false && parsed.code) throw new LedgerReject(parsed.code, parsed.detail);
      } catch (inner) {
        if (inner instanceof LedgerReject) throw inner;
      }
    }
    throw e;
  }

  private async submit<T>(fn: string, arg: unknown): Promise<T> {
    try {
      const contract = await this.client();
      const bytes = await contract.submitTransaction(fn, JSON.stringify(arg));
      return this.unwrap<T>(bytes);
    } catch (e) {
      this.parseError(e);
    }
  }
  private async evaluate<T>(fn: string, ...args: string[]): Promise<T> {
    try {
      const contract = await this.client();
      const bytes = await contract.evaluateTransaction(fn, ...args);
      return this.unwrap<T>(bytes);
    } catch (e) {
      this.parseError(e);
    }
  }

  submitCollection(req: CollectionRequest) { return this.submit<CollectionResponse>('SubmitCollection', req); }
  submitAggregation(req: AggregationRequest) { return this.submit<{ containerEpc: string; txId: string }>('SubmitAggregation', req); }
  submitTransformation(req: TransformationRequest) { return this.submit<TransformationResponse>('SubmitTransformation', req); }
  submitQualityTest(req: QualityTestRequest) { return this.submit<{ txId: string; result: 'PASSED' | 'FAILED' }>('SubmitQualityTest', req); }
  submitFormulation(req: FormulationRequest) { return this.submit<FormulationResponse>('SubmitFormulation', req); }
  getBatch(epc: string) { return this.evaluate<BatchTimelineResponse>('GetBatch', epc); }
  listZones() { return this.evaluate<ZonesResponse>('ListZones'); }
  zoneQuota(zoneId: string) { return this.evaluate<ZoneQuotaResponse>('ZoneQuota', zoneId); }
  recall(epc: string) { return this.evaluate<RecallResponse>('Recall', epc); }
  listBatches() { return this.evaluate<{ batches: BatchRecord[] }>('ListBatches'); }
  listSpecies() { return this.evaluate<{ species: SpeciesRule[] }>('ListSpecies'); }
  listCollectors() { return this.evaluate<{ collectors: Collector[] }>('ListCollectors'); }
  stats() { return this.evaluate<LedgerStats>('Stats'); }

  async onModuleDestroy(): Promise<void> {
    this.gateway?.close();
  }
  // silence unused import in environments that tree-shake
  private static _enc = enc;
}

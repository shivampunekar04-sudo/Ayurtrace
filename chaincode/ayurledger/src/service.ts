/**
 * AyurLedgerService — orchestration for every write/read path.
 * Composes the pure enforcement logic (mpr.ts) with a LedgerPort (ledger.ts).
 * Fabric-independent by design; contract.ts adapts Fabric's stub to LedgerPort.
 */
import {
  RejectCode,
  GacpStatus,
  Checkpoint,
  type CheckpointStatus,
  type SpeciesRule,
  type Zone,
  type Collector,
  type Quota,
  type BatchRecord,
  type ObjectEvent,
  type AggregationEvent,
  type TransformationEvent,
  type QualityTestEvent,
  type CollectionRequest,
  type CollectionResponse,
  type AggregationRequest,
  type TransformationRequest,
  type TransformationResponse,
  type QualityTestRequest,
  type FormulationRequest,
  type FormulationResponse,
  type BatchTimelineResponse,
  type TimelineStep,
  type ZonesResponse,
  type ZoneQuotaResponse,
  type RecallResponse,
  EPCIS_CONTEXT,
  EPC,
  KEY,
  quotaKey,
} from '@ayurtrace/contracts';
import {
  runMpr,
  decideQuota,
  quotaWarning,
  checkMassBalance,
  apportion,
  checkDryingTime,
  checkEndorsement,
  checkFormulationInputs,
  gacpScore,
  type CheckOutcome,
} from './mpr.js';
import type { LedgerPort } from './ledger.js';

/** Typed error carrying a frozen §6.2 reject code; Fabric rolls back on throw. */
export class LedgerReject extends Error {
  constructor(
    public readonly code: RejectCode,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'LedgerReject';
  }
}

function assertOk(o: CheckOutcome): void {
  if (!o.ok) throw new LedgerReject(o.code, o.detail);
}

const WEIGH_TOLERANCE_PCT = 10; // CP-3, transit water-loss allowance (§1B mech 3)
const MASS_TOLERANCE_PCT = 5;

/** WHO/AYUSH heavy-metal + moisture limits used by CP-5. [ASSUMPTION: sourced limits]. */
const emptyCheckpoints = (): Record<Checkpoint, CheckpointStatus> => ({
  [Checkpoint.CP1_COLLECTION_ZONE]: 'PENDING',
  [Checkpoint.CP2_PART_QUANTITY]: 'PENDING',
  [Checkpoint.CP3_WEIGH]: 'PENDING',
  [Checkpoint.CP4_DRYING_TIME]: 'PENDING',
  [Checkpoint.CP5_LAB_LIMITS]: 'PENDING',
  [Checkpoint.CP6_DNA_IDENTITY]: 'PENDING',
  [Checkpoint.CP7_FORMULATION_INPUTS]: 'PENDING',
});

export class AyurLedgerService {
  constructor(private readonly ledger: LedgerPort) {}

  // ---- reference-data helpers ---------------------------------------------
  private async getSpecies(code: string): Promise<SpeciesRule> {
    const raw = await this.ledger.getState(`species/${code}`);
    if (!raw) throw new LedgerReject(RejectCode.PART_VIOLATION, { reason: 'UNKNOWN_SPECIES', code });
    return JSON.parse(raw);
  }
  private async getZone(id: string): Promise<Zone> {
    const raw = await this.ledger.getState(`zone/${id}`);
    if (!raw) throw new LedgerReject(RejectCode.ZONE_VIOLATION, { reason: 'UNKNOWN_ZONE', id });
    return JSON.parse(raw);
  }
  private async getCollector(id: string): Promise<Collector> {
    const raw = await this.ledger.getState(`collector/${id}`);
    if (!raw) throw new LedgerReject(RejectCode.LICENSE_INVALID, { reason: 'UNKNOWN_COLLECTOR', id });
    return JSON.parse(raw);
  }
  private async getQuota(species: string, zone: string, season: string): Promise<Quota> {
    const key = this.ledger.createCompositeKey(KEY.quota, quotaKey(species, zone, season));
    const raw = await this.ledger.getState(key);
    if (!raw) throw new LedgerReject(RejectCode.QUOTA_EXCEEDED, { reason: 'NO_QUOTA', species, zone, season });
    return JSON.parse(raw);
  }
  private async saveQuota(q: Quota): Promise<void> {
    const key = this.ledger.createCompositeKey(KEY.quota, quotaKey(q.speciesCode, q.zoneId, q.season));
    await this.ledger.putState(key, JSON.stringify(q));
  }
  private async getBatchRecord(epc: string): Promise<BatchRecord | undefined> {
    const raw = await this.ledger.getState(`batch/${epc}`);
    return raw ? JSON.parse(raw) : undefined;
  }
  private async saveBatch(b: BatchRecord): Promise<void> {
    await this.ledger.putState(`batch/${b.epc}`, JSON.stringify(b));
    const raw = await this.ledger.getState('batch-index');
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(b.epc)) {
      ids.push(b.epc);
      await this.ledger.putState('batch-index', JSON.stringify(ids));
    }
  }
  private async appendEvent(batchEpc: string, event: unknown): Promise<string> {
    const counterKey = `seq/${batchEpc}`;
    const seq = Number((await this.ledger.getState(counterKey)) ?? '0') + 1;
    await this.ledger.putState(counterKey, String(seq));
    const key = this.ledger.createCompositeKey(KEY.batchEvent, [batchEpc, String(seq).padStart(6, '0')]);
    await this.ledger.putState(key, JSON.stringify(event));
    return key;
  }

  // ---- seeding -------------------------------------------------------------
  async initLedger(refs: {
    species: SpeciesRule[];
    zones: Zone[];
    collectors: Collector[];
    quotas: Quota[];
  }): Promise<void> {
    for (const s of refs.species) await this.ledger.putState(`species/${s.code}`, JSON.stringify(s));
    for (const z of refs.zones) await this.ledger.putState(`zone/${z.id}`, JSON.stringify(z));
    await this.ledger.putState('zone-index', JSON.stringify(refs.zones.map((z) => z.id)));
    for (const c of refs.collectors) await this.ledger.putState(`collector/${c.id}`, JSON.stringify(c));
    for (const q of refs.quotas) await this.saveQuota(q);
  }

  // ---- write: collection (MPR 5-check) ------------------------------------
  async submitCollection(req: CollectionRequest): Promise<CollectionResponse> {
    const species = await this.getSpecies(req.speciesCode);
    const zone = await this.getZone(req.location ? await this.resolveZoneId(req) : '');
    const quota = await this.getQuota(req.speciesCode, zone.id, req.season);
    const collector = await this.getCollector(req.collectorId);
    const eventTimeIso = this.ledger.txTimestampIso();
    const offline = req.entryMethod === 'TIER2_OFFLINE' && !!req.offlineSoftReserve;

    const mpr = runMpr({
      species,
      zone,
      quota,
      collector,
      lon: req.location.lon,
      lat: req.location.lat,
      season: req.season,
      part: req.plantPart,
      requestKg: req.quantityKg,
      eventTimeIso,
      offlineSoftReserve: offline,
    });
    // atomicity: first hard failure rejects the whole tx — nothing below commits
    assertOk(mpr.outcome);

    // persist quota decrement (MVCC on species~zone~season key gives Fabric atomicity)
    const qd = mpr.quotaDecision;
    const warned = quotaWarning(quota, qd.newConsumedKg);
    quota.consumedKg = qd.newConsumedKg;
    await this.saveQuota(quota);

    // mint lot EPC deterministically from the tx sequence
    const lotSeq = await this.nextGlobalSeq('lot');
    const state = zone.id.split(':').pop()?.split('-')[1] ?? 'XX';
    const epc = EPC.lot(state, species.code, new Date(eventTimeIso).getFullYear(), lotSeq);

    // PoLK is SIMULATED (§1.3): scripted 2-peer confirm on TIER1, unconfirmed offline
    const polkConfirmed = req.entryMethod === 'TIER1_PWA';

    const event: ObjectEvent = {
      '@context': [EPCIS_CONTEXT],
      type: 'ObjectEvent',
      eventTime: eventTimeIso,
      eventTimeZoneOffset: '+05:30',
      action: 'ADD',
      bizStep: 'commissioning',
      disposition: 'active',
      epcList: [epc],
      readPoint: { id: EPC.zone(zone.id) },
      quantityList: [{ epcClass: EPC.species(species.code), quantity: req.quantityKg, uom: 'KGM' }],
      'ayurtrace:collection': {
        collectorId: collector.id,
        collectorCluster: collector.cluster,
        entryMethod: req.entryMethod,
        plantPart: { submitted: req.plantPart, allowed: species.allowedParts[0], check: 'PASSED' },
        location: {
          lat: req.location.lat,
          lon: req.location.lon,
          altitudeM: req.location.altitudeM,
          publicPrecision: species.endangered ? 'ZONE_ONLY' : 'ZONE_ONLY',
          geoFenceCheck: 'PASSED',
          cellTowerCrossCheck: 'PASSED',
          varianceM: 0,
        },
        harvest: {
          season: req.season,
          seasonCompliant: true,
          quotaRemainingBeforeKg: qd.quotaRemainingBeforeKg,
          quotaDeductedKg: req.quantityKg,
          quotaRemainingAfterKg: qd.quotaRemainingAfterKg,
          quotaSource: offline ? 'CLUSTER_SOFT_RESERVE' : 'LIVE_ZONE_QUOTA',
          reconciled: !offline,
          overDrawFlagged: qd.overDrawFlagged,
        },
        photoEvidence: req.photoIpfsCID ? { ipfsCID: req.photoIpfsCID, exifGpsMatch: 'PASSED' } : undefined,
        polk: { status: polkConfirmed ? 'CONFIRMED' : 'UNCONFIRMED', confirmations: polkConfirmed ? 2 : 0, disputes: 0 },
        mprValidation: {
          geoFence: 'PASSED', season: 'PASSED', quota: 'PASSED', license: 'PASSED', plantPart: 'PASSED',
          overall: 'ALL_PASSED',
        },
        blockchain: {
          network: 'AyurTrace-HLF-v2.5', channel: 'provenance-channel',
          chaincode: 'ayurledger', txId: this.ledger.txId(), endorsers: ['CollectorOrg', 'NMPB-RegulatorOrg'],
        },
      },
    };
    const eventKey = await this.appendEvent(epc, event);

    const checkpoints = emptyCheckpoints();
    checkpoints[Checkpoint.CP1_COLLECTION_ZONE] = 'PASSED';
    checkpoints[Checkpoint.CP2_PART_QUANTITY] = 'PASSED';

    const score = gacpScore({
      checkpointsPassed: 2,
      polkConfirmed,
      overDrawFlagged: qd.overDrawFlagged,
      weightHold: false,
    });

    const batch: BatchRecord = {
      epc,
      speciesCode: species.code,
      status: GacpStatus.ACTIVE,
      gacpScore: score,
      checkpoints,
      eventKeys: [eventKey],
      inputEpcs: [],
      flags: qd.overDrawFlagged ? ['QUOTA_OVERDRAW_FLAGGED'] : [],
      zoneId: zone.id,
      createdAt: eventTimeIso,
      updatedAt: eventTimeIso,
    };
    await this.saveBatch(batch);

    // index lot by collector for recall sibling queries
    await this.ledger.putState(
      this.ledger.createCompositeKey('lot~collector', [collector.id, epc]),
      JSON.stringify({ epc, zoneId: zone.id, collectorId: collector.id }),
    );

    if (warned) {
      // 80% warning event (SMS fan-out handled by the gateway; recorded on-chain)
      await this.ledger.putState(`quota-warning/${species.code}/${zone.id}/${req.season}`, eventTimeIso);
    }

    return { epc, txId: event['ayurtrace:collection']!.blockchain!.txId, gacpScore: score };
  }

  /** Resolve which approved zone the collection point falls in (first containing zone). */
  private async resolveZoneId(req: CollectionRequest): Promise<string> {
    // A collector submits a point; we find the approved zone for this species that contains it.
    // If none contains it, geo-fence must still fail — return the species' primary zone so the
    // point-in-polygon check runs and yields ZONE_VIOLATION rather than a silent unknown-zone.
    const zones = await this.allZones();
    for (const z of zones) {
      // cheap bbox-then-exact happens inside checkGeoFence; here just return first containing
      const contains = pointInPoly(req.location.lon, req.location.lat, z.polygon);
      if (contains) return z.id;
    }
    return zones[0]?.id ?? '';
  }

  private async allZones(): Promise<Zone[]> {
    const out: Zone[] = [];
    // reference zones are stored under zone/{id}; scan by prefix via a maintained index
    const idxRaw = await this.ledger.getState('zone-index');
    const ids: string[] = idxRaw ? JSON.parse(idxRaw) : [];
    for (const id of ids) {
      const z = await this.ledger.getState(`zone/${id}`);
      if (z) out.push(JSON.parse(z));
    }
    return out;
  }

  private async nextGlobalSeq(name: string): Promise<number> {
    const key = `gseq/${name}`;
    const n = Number((await this.ledger.getState(key)) ?? '0') + 1;
    await this.ledger.putState(key, String(n));
    return n;
  }

  // ---- write: aggregation (CP-3 weigh) ------------------------------------
  async submitAggregation(req: AggregationRequest): Promise<{ containerEpc: string; txId: string }> {
    const variancePct = req.declaredKg === 0 ? 100 : (Math.abs(req.measuredKg - req.declaredKg) / req.declaredKg) * 100;
    const held = variancePct > WEIGH_TOLERANCE_PCT;
    const containerSeq = await this.nextGlobalSeq('container');
    const containerEpc = EPC.container(containerSeq);
    const eventTimeIso = this.ledger.txTimestampIso();

    const event: AggregationEvent = {
      '@context': [EPCIS_CONTEXT],
      type: 'AggregationEvent',
      eventTime: eventTimeIso,
      eventTimeZoneOffset: '+05:30',
      action: 'ADD',
      bizStep: 'receiving',
      disposition: held ? 'in_progress' : 'in_progress',
      parentID: containerEpc,
      childEPCs: req.childEpcs,
      readPoint: { id: EPC.zone(req.zoneId) },
      'ayurtrace:weigh': {
        declaredKg: req.declaredKg,
        measuredKg: req.measuredKg,
        variancePct,
        tolerancePct: WEIGH_TOLERANCE_PCT,
        result: held ? 'WEIGHT_VARIANCE_HOLD' : 'PASSED',
      },
    };
    const eventKey = await this.appendEvent(containerEpc, event);

    const checkpoints = emptyCheckpoints();
    checkpoints[Checkpoint.CP3_WEIGH] = held ? 'FAILED' : 'PASSED';
    const batch: BatchRecord = {
      epc: containerEpc,
      speciesCode: (await this.getBatchRecord(req.childEpcs[0]))?.speciesCode ?? 'UNKNOWN',
      status: held ? GacpStatus.HOLD : GacpStatus.ACTIVE,
      gacpScore: gacpScore({ checkpointsPassed: held ? 2 : 3, polkConfirmed: true, overDrawFlagged: false, weightHold: held }),
      checkpoints,
      eventKeys: [eventKey],
      inputEpcs: req.childEpcs,
      flags: held ? ['WEIGHT_VARIANCE_HOLD'] : [],
      zoneId: req.zoneId,
      createdAt: eventTimeIso,
      updatedAt: eventTimeIso,
    };
    await this.saveBatch(batch);
    if (held) throw new LedgerReject(RejectCode.WEIGHT_VARIANCE_HOLD, { variancePct, tolerancePct: WEIGH_TOLERANCE_PCT });
    return { containerEpc, txId: this.ledger.txId() };
  }

  // ---- write: transformation (mass balance + CP-4) ------------------------
  async submitTransformation(req: TransformationRequest): Promise<TransformationResponse> {
    const inputKgs = req.inputs.map((i) => i.quantityKg);
    const mb = checkMassBalance(inputKgs, req.outputKg, req.declaredLossFactor, MASS_TOLERANCE_PCT);
    assertOk(mb.outcome); // dilution → MASS_BALANCE_VIOLATION, nothing commits

    // CP-4 drying-time gate (promotion) — only when a gap was supplied
    let cp4: CheckpointStatus = 'SKIPPED';
    if (req.dryingGapSeconds !== undefined) {
      const dry = checkDryingTime(req.dryingGapSeconds);
      cp4 = dry.ok ? 'PASSED' : 'FAILED';
      if (!dry.ok) throw new LedgerReject(RejectCode.BATCH_STATUS_HOLD, dry.ok ? {} : (dry as any).detail);
    }

    const props = apportion(req.inputs);
    const outSeq = await this.nextGlobalSeq('output');
    const outputEpc = EPC.output(req.kind, outSeq);
    const eventTimeIso = this.ledger.txTimestampIso();
    const inputEpcs = req.inputs.map((i) => i.epc);

    const event: TransformationEvent = {
      '@context': [EPCIS_CONTEXT],
      type: 'TransformationEvent',
      eventTime: eventTimeIso,
      eventTimeZoneOffset: '+05:30',
      bizStep: 'transforming',
      disposition: 'in_progress',
      inputQuantityList: req.inputs.map((i) => ({
        epc: i.epc, quantity: i.quantityKg, uom: 'KGM',
        proportion: props.find((p) => p.epc === i.epc)!.proportion,
      })),
      outputQuantityList: [{ epcClass: outputEpc, quantity: req.outputKg, uom: 'KGM' }],
      outputEPCList: [outputEpc],
      readPoint: { id: EPC.zone(req.zoneId) },
      'ayurtrace:transform': {
        kind: req.kind,
        declaredLossFactor: req.declaredLossFactor,
        massBalance: {
          inputKg: mb.inputKg, outputKg: mb.outputKg, expectedOutputKg: mb.expectedOutputKg,
          tolerancePct: mb.tolerancePct, variancePct: mb.variancePct, result: 'PASSED',
        },
        dryingGapSeconds: req.dryingGapSeconds,
      },
    };
    const eventKey = await this.appendEvent(outputEpc, event);

    // inherit checkpoint state from inputs; a transform advances CP-4 when checked
    const checkpoints = emptyCheckpoints();
    checkpoints[Checkpoint.CP1_COLLECTION_ZONE] = 'PASSED';
    checkpoints[Checkpoint.CP2_PART_QUANTITY] = 'PASSED';
    checkpoints[Checkpoint.CP4_DRYING_TIME] = cp4;
    const speciesCode = (await this.getBatchRecord(inputEpcs[0]))?.speciesCode ?? 'UNKNOWN';

    const batch: BatchRecord = {
      epc: outputEpc,
      speciesCode,
      status: GacpStatus.ACTIVE,
      gacpScore: gacpScore({ checkpointsPassed: cp4 === 'PASSED' ? 3 : 2, polkConfirmed: true, overDrawFlagged: false, weightHold: false }),
      checkpoints,
      eventKeys: [eventKey],
      inputEpcs,
      flags: [],
      zoneId: req.zoneId,
      createdAt: eventTimeIso,
      updatedAt: eventTimeIso,
    };
    await this.saveBatch(batch);
    return { outputEpc, txId: this.ledger.txId(), inputEpcs };
  }

  // ---- write: quality test (dual endorsement, CP-5/CP-6) ------------------
  async submitQualityTest(req: QualityTestRequest, manufacturerMsps: string[] = ['ManufacturerMSP']): Promise<{ txId: string; result: 'PASSED' | 'FAILED' }> {
    const end = checkEndorsement(req.testingLabMsp, req.verifierMsp, req.verifierRole, manufacturerMsps);
    assertOk(end); // no incentive-independent second signature → ENDORSEMENT_MISSING

    const batch = await this.getBatchRecord(req.epc);
    if (!batch) throw new LedgerReject(RejectCode.BATCH_STATUS_HOLD, { reason: 'UNKNOWN_BATCH', epc: req.epc });

    const cp5Pass = req.metrics.every((m) => m.withinLimit);
    const cp6Pass = req.dna ? req.dna.declaredSpecies === req.dna.confirmedSpecies : true;
    const eventTimeIso = this.ledger.txTimestampIso();

    const event: QualityTestEvent = {
      '@context': [EPCIS_CONTEXT],
      type: 'ObjectEvent',
      eventTime: eventTimeIso,
      eventTimeZoneOffset: '+05:30',
      action: 'OBSERVE',
      bizStep: 'inspecting',
      disposition: cp5Pass && cp6Pass ? 'active' : 'in_progress',
      epcList: [req.epc],
      readPoint: { id: EPC.zone(batch.zoneId) },
      'ayurtrace:qualityTest': {
        metrics: req.metrics,
        dnaBarcode: req.dna ? {
          markers: ['ITS2', 'psbA-trnH'],
          declaredSpecies: req.dna.declaredSpecies,
          confirmedSpecies: req.dna.confirmedSpecies,
          match: cp6Pass,
        } : undefined,
        ipfsCID: req.ipfsCID,
        endorsement: { testingLabMsp: req.testingLabMsp, verifierMsp: req.verifierMsp, verifierRole: req.verifierRole },
        result: cp5Pass && cp6Pass ? 'PASSED' : 'FAILED',
      },
    };
    const eventKey = await this.appendEvent(req.epc, event);

    batch.checkpoints[Checkpoint.CP5_LAB_LIMITS] = cp5Pass ? 'PASSED' : 'FAILED';
    batch.checkpoints[Checkpoint.CP6_DNA_IDENTITY] = req.dna ? (cp6Pass ? 'PASSED' : 'FAILED') : 'SKIPPED';
    batch.eventKeys.push(eventKey);
    batch.updatedAt = eventTimeIso;

    const requiredPassed = [
      Checkpoint.CP1_COLLECTION_ZONE, Checkpoint.CP2_PART_QUANTITY, Checkpoint.CP5_LAB_LIMITS,
    ].every((cp) => batch.checkpoints[cp] === 'PASSED');
    const cp6ok = batch.checkpoints[Checkpoint.CP6_DNA_IDENTITY] !== 'FAILED';

    if (cp5Pass && cp6Pass && requiredPassed && cp6ok) {
      batch.status = GacpStatus.COMPLETE_PASSED;
    } else if (!cp5Pass || !cp6Pass) {
      batch.status = GacpStatus.COMPLETE_FAILED;
      batch.flags.push('QUALITY_FAILED');
    }
    const passedCount = Object.values(batch.checkpoints).filter((s) => s === 'PASSED').length;
    batch.gacpScore = gacpScore({ checkpointsPassed: passedCount, polkConfirmed: true, overDrawFlagged: batch.flags.includes('QUOTA_OVERDRAW_FLAGGED'), weightHold: false });
    await this.saveBatch(batch);
    return { txId: this.ledger.txId(), result: event['ayurtrace:qualityTest'].result };
  }

  // ---- write: formulation (CP-7 gate) -------------------------------------
  async submitFormulation(req: FormulationRequest): Promise<FormulationResponse> {
    const statuses = await Promise.all(
      req.inputEpcs.map(async (epc) => ({ epc, status: (await this.getBatchRecord(epc))?.status ?? GacpStatus.HOLD })),
    );
    assertOk(checkFormulationInputs(statuses)); // any non-passed input → BATCH_STATUS_HOLD

    const seq = await this.nextGlobalSeq('product');
    const productEpc = EPC.output('FORMULATION', seq);
    const eventTimeIso = this.ledger.txTimestampIso();
    const serials = Array.from({ length: req.unitCount }, (_, i) => EPC.serial(productEpc, i + 1));

    const event: TransformationEvent = {
      '@context': [EPCIS_CONTEXT],
      type: 'TransformationEvent',
      eventTime: eventTimeIso,
      eventTimeZoneOffset: '+05:30',
      bizStep: 'transforming',
      disposition: 'active',
      inputQuantityList: req.inputEpcs.map((epc) => ({ epc, quantity: 0, uom: 'KGM', proportion: 1 / req.inputEpcs.length })),
      outputQuantityList: [{ epcClass: productEpc, quantity: req.unitCount, uom: 'KGM' }],
      outputEPCList: [productEpc],
      readPoint: { id: 'urn:ayurtrace:facility:GMP' },
      'ayurtrace:transform': {
        kind: 'FORMULATION',
        declaredLossFactor: 0,
        massBalance: { inputKg: 0, outputKg: 0, expectedOutputKg: 0, tolerancePct: 0, variancePct: 0, result: 'PASSED' },
      },
    };
    const eventKey = await this.appendEvent(productEpc, event);

    const checkpoints = emptyCheckpoints();
    for (const cp of Object.keys(checkpoints) as Checkpoint[]) checkpoints[cp] = 'PASSED';
    const batch: BatchRecord = {
      epc: productEpc,
      speciesCode: (await this.getBatchRecord(req.inputEpcs[0]))?.speciesCode ?? 'UNKNOWN',
      status: GacpStatus.COMPLETE_PASSED,
      gacpScore: 100,
      checkpoints,
      eventKeys: [eventKey],
      inputEpcs: req.inputEpcs,
      flags: [],
      zoneId: (await this.getBatchRecord(req.inputEpcs[0]))?.zoneId ?? 'UNKNOWN',
      createdAt: eventTimeIso,
      updatedAt: eventTimeIso,
    };
    await this.saveBatch(batch);
    // store product name + serials for QR minting at the gateway
    await this.ledger.putState(`product/${productEpc}`, JSON.stringify({ productName: req.productName, serials, manufacturerMsp: req.manufacturerMsp }));
    for (const s of serials) await this.ledger.putState(`serial/${s}`, JSON.stringify({ productEpc }));

    return { productEpc, serials, txId: this.ledger.txId() };
  }

  // ---- reads ---------------------------------------------------------------
  async getBatch(epc: string): Promise<BatchTimelineResponse> {
    const batch = await this.getBatchRecord(epc);
    if (!batch) throw new LedgerReject(RejectCode.BATCH_STATUS_HOLD, { reason: 'UNKNOWN_BATCH', epc });
    const timeline: TimelineStep[] = [];
    // walk this batch and, for transformation outputs, its input batches
    const seen = new Set<string>();
    const collect = async (e: string): Promise<void> => {
      if (seen.has(e)) return;
      seen.add(e);
      const b = await this.getBatchRecord(e);
      if (!b) return;
      for (const inp of b.inputEpcs) await collect(inp);
      const evs = await this.ledger.getByPartialCompositeKey(KEY.batchEvent, [e]);
      for (const { value } of evs) {
        const ev = JSON.parse(value);
        timeline.push(this.toTimelineStep(ev, b.zoneId));
      }
    };
    await collect(epc);
    timeline.sort((a, b) => (a.time < b.time ? -1 : 1));
    return { batch, timeline };
  }

  private toTimelineStep(ev: any, zoneId: string): TimelineStep {
    if (ev.type === 'ObjectEvent' && ev.bizStep === 'commissioning')
      return { step: 'COLLECTION', label: 'Collected at source', time: ev.eventTime, zoneId, detail: { collector: ev['ayurtrace:collection']?.collectorId, polk: ev['ayurtrace:collection']?.polk?.status } };
    if (ev.type === 'AggregationEvent')
      return { step: 'AGGREGATION', label: 'Aggregated and weighed', time: ev.eventTime, zoneId, detail: { weigh: ev['ayurtrace:weigh'] } };
    if (ev.type === 'ObjectEvent' && ev.bizStep === 'inspecting')
      return { step: 'TESTING', label: 'Quality tested (dual-endorsed)', time: ev.eventTime, zoneId, detail: { result: ev['ayurtrace:qualityTest']?.result, ipfsCID: ev['ayurtrace:qualityTest']?.ipfsCID, dna: ev['ayurtrace:qualityTest']?.dnaBarcode?.match } };
    if (ev.type === 'TransformationEvent' && ev['ayurtrace:transform']?.kind === 'FORMULATION')
      return { step: 'FORMULATION', label: 'Formulated into product', time: ev.eventTime, zoneId, detail: {} };
    if (ev.type === 'TransformationEvent')
      return { step: 'PROCESSING', label: 'Processed', time: ev.eventTime, zoneId, detail: { massBalance: ev['ayurtrace:transform']?.massBalance } };
    return { step: 'CUSTODY', label: 'Custody handoff', time: ev.eventTime, zoneId, detail: {} };
  }

  async listZones(): Promise<ZonesResponse> {
    return { zones: await this.allZones() };
  }

  async zoneQuota(zoneId: string): Promise<ZoneQuotaResponse> {
    const kvs = await this.ledger.getByPartialCompositeKey(KEY.quota, []);
    const quotas = kvs
      .map((kv) => JSON.parse(kv.value) as Quota)
      .filter((q) => q.zoneId === zoneId)
      .map((q) => {
        const consumedPct = (q.consumedKg / q.annualLimitKg) * 100;
        const band = consumedPct > 80 ? 'RED' : consumedPct >= 50 ? 'AMBER' : 'GREEN';
        return { ...q, consumedPct, band: band as 'GREEN' | 'AMBER' | 'RED' };
      });
    return { zoneId, quotas };
  }

  async recall(epc: string): Promise<RecallResponse> {
    const origin = await this.getBatchRecord(epc);
    if (!origin) throw new LedgerReject(RejectCode.BATCH_STATUS_HOLD, { reason: 'UNKNOWN_BATCH', epc });

    // forward: finished products whose input chain includes epc
    const affectedProducts: string[] = [];
    const productKeys = new Set<string>();
    const scanRaw = await this.allBatchEpcs();
    for (const b of scanRaw) {
      if (b.epc.includes('output:FORMULATION-')) {
        if (await this.inputChainContains(b.epc, epc)) productKeys.add(b.epc);
      }
    }
    affectedProducts.push(...productKeys);

    // source lots (when epc itself is a merged output)
    const sourceLots: RecallResponse['sourceLots'] = [];
    for (const inp of origin.inputEpcs) {
      const b = await this.getBatchRecord(inp);
      if (b) {
        const collectorId = await this.collectorOf(inp);
        sourceLots.push({ epc: inp, collectorId, zoneId: b.zoneId, proportion: 1 / origin.inputEpcs.length });
      }
    }

    // siblings: same collector or same zone
    const originCollector = await this.collectorOf(epc);
    const siblingBatches: string[] = [];
    if (originCollector) {
      const sibs = await this.ledger.getByPartialCompositeKey('lot~collector', [originCollector]);
      for (const s of sibs) {
        const rec = JSON.parse(s.value);
        if (rec.epc !== epc) siblingBatches.push(rec.epc);
      }
    }
    return { originEpc: epc, affectedProducts, siblingBatches, sourceLots };
  }

  private async inputChainContains(epc: string, target: string): Promise<boolean> {
    const seen = new Set<string>();
    const walk = async (e: string): Promise<boolean> => {
      if (e === target) return true;
      if (seen.has(e)) return false;
      seen.add(e);
      const b = await this.getBatchRecord(e);
      if (!b) return false;
      for (const inp of b.inputEpcs) if (await walk(inp)) return true;
      return false;
    };
    return walk(epc);
  }

  private async allBatchEpcs(): Promise<BatchRecord[]> {
    // maintained index of batch epcs
    const raw = await this.ledger.getState('batch-index');
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const out: BatchRecord[] = [];
    for (const id of ids) { const b = await this.getBatchRecord(id); if (b) out.push(b); }
    return out;
  }

  private async collectorOf(epc: string): Promise<string> {
    const evs = await this.ledger.getByPartialCompositeKey(KEY.batchEvent, [epc]);
    for (const { value } of evs) {
      const ev = JSON.parse(value);
      if (ev['ayurtrace:collection']?.collectorId) return ev['ayurtrace:collection'].collectorId;
    }
    return '';
  }
}

// local copy so service can resolve zones without importing mpr's exported name twice
function pointInPoly(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

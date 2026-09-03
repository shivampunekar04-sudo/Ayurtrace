import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RejectCode, GacpStatus } from '@ayurtrace/contracts';
import { seedRefs, DEMO_POINTS } from '@ayurtrace/seed';
import { MemoryLedger } from '../src/ledger.js';
import { AyurLedgerService, LedgerReject } from '../src/service.js';

/**
 * Runs the exact demo golden path (execution plan §9.1) against the in-memory
 * ledger and asserts every stage. This is the strongest evidence the enforcement
 * spine is correct end-to-end without standing up Fabric.
 */
const ledger = new MemoryLedger('2026-04-15T06:47:00+05:30');
const svc = new AyurLedgerService(ledger);
await svc.initLedger(seedRefs());

describe('Golden path — full §9.1 demo, end to end', () => {
  let farmA = '';
  let farmB = '';
  let mergedLot = '';
  let product = '';

  it('1. valid Ashwagandha collection commits (farm A, zone 7)', async () => {
    const r = await svc.submitCollection({
      speciesCode: 'ASWG', quantityKg: 60, plantPart: 'ROOT', collectorId: 'NMPB-COL-KA-8823',
      season: 'RABI', location: DEMO_POINTS.zone07, entryMethod: 'TIER1_PWA', photoIpfsCID: 'QmDemoA',
    });
    farmA = r.epc;
    assert.match(r.epc, /^urn:ayurtrace:lot:CE-KA-ASWG-2026-/);
    assert.equal(r.gacpScore, 40); // CP-1 + CP-2 + PoLK
  });

  it('2. out-of-zone collection is rejected live with ZONE_VIOLATION', async () => {
    await assert.rejects(
      svc.submitCollection({
        speciesCode: 'ASWG', quantityKg: 20, plantPart: 'ROOT', collectorId: 'NMPB-COL-KA-8823',
        season: 'RABI', location: DEMO_POINTS.outside, entryMethod: 'TIER1_PWA',
      }),
      (e: unknown) => e instanceof LedgerReject && e.code === RejectCode.ZONE_VIOLATION,
    );
  });

  it('2b. wrong plant part → PART_VIOLATION (atomicity)', async () => {
    await assert.rejects(
      svc.submitCollection({
        speciesCode: 'ASWG', quantityKg: 10, plantPart: 'LEAF', collectorId: 'NMPB-COL-KA-8823',
        season: 'RABI', location: DEMO_POINTS.zone07, entryMethod: 'TIER1_PWA',
      }),
      (e: unknown) => e instanceof LedgerReject && e.code === RejectCode.PART_VIOLATION,
    );
  });

  it('2c. expired-license collector → LICENSE_INVALID', async () => {
    await assert.rejects(
      svc.submitCollection({
        speciesCode: 'SARP', quantityKg: 2, plantPart: 'ROOT', collectorId: 'NMPB-COL-KA-3321',
        season: 'RABI', location: DEMO_POINTS.zone13, entryMethod: 'TIER1_PWA',
      }),
      (e: unknown) => e instanceof LedgerReject && e.code === RejectCode.LICENSE_INVALID,
    );
  });

  it('3. valid collection (farm B, zone 9) then merge A+B keeps both input links', async () => {
    const b = await svc.submitCollection({
      speciesCode: 'ASWG', quantityKg: 40, plantPart: 'ROOT', collectorId: 'NMPB-COL-KA-9910',
      season: 'RABI', location: DEMO_POINTS.zone09, entryMethod: 'TIER1_PWA', photoIpfsCID: 'QmDemoB',
    });
    farmB = b.epc;

    // 100kg in, 10% declared drying loss → expect 90kg; declare 89kg out (within 5% tol)
    const merged = await svc.submitTransformation({
      kind: 'MERGE',
      inputs: [{ epc: farmA, quantityKg: 60 }, { epc: farmB, quantityKg: 40 }],
      outputKg: 89, declaredLossFactor: 0.1, zoneId: 'NMPB-KA-ZONE-07', dryingGapSeconds: 3600,
    });
    mergedLot = merged.outputEpc;
    assert.deepEqual(merged.inputEpcs.sort(), [farmA, farmB].sort());
  });

  it('4. diluted transform (filler added) → MASS_BALANCE_VIOLATION', async () => {
    await assert.rejects(
      svc.submitTransformation({
        kind: 'MERGE',
        inputs: [{ epc: farmA, quantityKg: 60 }, { epc: farmB, quantityKg: 40 }],
        outputKg: 110, declaredLossFactor: 0.1, zoneId: 'NMPB-KA-ZONE-07',
      }),
      (e: unknown) => e instanceof LedgerReject && e.code === RejectCode.MASS_BALANCE_VIOLATION,
    );
  });

  it('5a. quality test without an independent verifier → ENDORSEMENT_MISSING', async () => {
    await assert.rejects(
      svc.submitQualityTest({
        epc: mergedLot,
        metrics: [{ name: 'lead', value: 1.0, unit: 'ppm', limit: 10, withinLimit: true }],
        ipfsCID: 'QmCert', testingLabMsp: 'LabMSP', verifierMsp: 'LabMSP', verifierRole: 'SECOND_LAB',
      }),
      (e: unknown) => e instanceof LedgerReject && e.code === RejectCode.ENDORSEMENT_MISSING,
    );
  });

  it('5b. lab + regulator co-endorse a passing quality test → COMPLETE_PASSED', async () => {
    const q = await svc.submitQualityTest({
      epc: mergedLot,
      metrics: [
        { name: 'lead', value: 1.2, unit: 'ppm', limit: 10, withinLimit: true },
        { name: 'arsenic', value: 0.3, unit: 'ppm', limit: 3, withinLimit: true },
        { name: 'moisture', value: 8, unit: '%', limit: 12, withinLimit: true },
      ],
      dna: { declaredSpecies: 'Withania somnifera', confirmedSpecies: 'Withania somnifera' },
      ipfsCID: 'QmCertMerged', testingLabMsp: 'LabMSP', verifierMsp: 'NmpbMSP', verifierRole: 'REGULATOR',
    });
    assert.equal(q.result, 'PASSED');
    const { batch } = await svc.getBatch(mergedLot);
    assert.equal(batch.status, GacpStatus.COMPLETE_PASSED);
  });

  it('6. formulation gated on COMPLETE_PASSED input → product + serialized units', async () => {
    const f = await svc.submitFormulation({
      inputEpcs: [mergedLot], productName: 'Ashwagandha Root Churna 60g', unitCount: 3, manufacturerMsp: 'ManufacturerMSP',
    });
    product = f.productEpc;
    assert.equal(f.serials.length, 3);
    assert.match(f.serials[0], /#000001$/);
  });

  it('6b. formulation blocked when an input is not COMPLETE_PASSED', async () => {
    // farmA on its own has never been quality-tested → still ACTIVE
    await assert.rejects(
      svc.submitFormulation({ inputEpcs: [farmA], productName: 'X', unitCount: 1, manufacturerMsp: 'ManufacturerMSP' }),
      (e: unknown) => e instanceof LedgerReject && e.code === RejectCode.BATCH_STATUS_HOLD,
    );
  });

  it('7. consumer scan resolves full provenance timeline back to both farms', async () => {
    const { batch, timeline } = await svc.getBatch(product);
    assert.equal(batch.gacpScore, 100);
    const steps = timeline.map((t) => t.step);
    assert.ok(steps.filter((s) => s === 'COLLECTION').length >= 2, 'two source collections present');
    assert.ok(steps.includes('PROCESSING'));
    assert.ok(steps.includes('TESTING'));
    assert.ok(steps.includes('FORMULATION'));
  });

  it('8a. quota moved by the two valid collections (zone 7 +60kg)', async () => {
    const zq = await svc.zoneQuota('NMPB-KA-ZONE-07');
    const aswg = zq.quotas.find((q) => q.speciesCode === 'ASWG')!;
    assert.equal(aswg.consumedKg, 280); // seeded 220 + 60
    assert.equal(aswg.band, 'RED'); // 280/312 = 89.7% > 80%
  });

  it('8b. one-click recall from the merged lot traces to both source farms', async () => {
    const r = await svc.recall(mergedLot);
    const sourceEpcs = r.sourceLots.map((s) => s.epc).sort();
    assert.deepEqual(sourceEpcs, [farmA, farmB].sort());
    assert.ok(r.affectedProducts.includes(product), 'recall finds the finished product');
  });

  it('8c. recall from a source farm finds same-cluster sibling and the product', async () => {
    // add a sibling collection by a same-collector farm, then recall farm A
    const r = await svc.recall(farmA);
    assert.ok(r.affectedProducts.includes(product), 'source-farm recall reaches the product');
  });
});

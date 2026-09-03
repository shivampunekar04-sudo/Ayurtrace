import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RejectCode,
  GacpStatus,
  type SpeciesRule,
  type Zone,
  type Collector,
  type Quota,
} from '@ayurtrace/contracts';
import {
  pointInPolygon,
  checkGeoFence,
  checkSeason,
  decideQuota,
  quotaWarning,
  checkLicense,
  checkPlantPart,
  runMpr,
  checkMassBalance,
  apportion,
  checkDryingTime,
  checkEndorsement,
  checkFormulationInputs,
  gacpScore,
} from '../src/mpr.js';

const zone: Zone = {
  id: 'NMPB-KA-ZONE-07',
  name: 'Tumkur Zone 7',
  polygon: [
    [77.0, 13.2],
    [77.2, 13.2],
    [77.2, 13.5],
    [77.0, 13.5],
    [77.0, 13.2],
  ],
};
const species: SpeciesRule = {
  code: 'ASWG',
  botanicalName: 'Withania somnifera',
  commonName: 'Ashwagandha',
  allowedParts: ['ROOT'],
  allowedSeasons: ['RABI'],
  endangered: false,
};
const collector: Collector = {
  id: 'NMPB-COL-KA-8823',
  cluster: 'CLUSTER-TUMKUR-04',
  licenseActive: true,
  licenseExpiry: '2027-12-31',
};
const quota = (): Quota => ({
  speciesCode: 'ASWG',
  zoneId: 'NMPB-KA-ZONE-07',
  season: 'RABI',
  annualLimitKg: 312,
  consumedKg: 0,
});

describe('MPR check 1 — geo-fence (point-in-polygon)', () => {
  it('point inside the ring is inside', () => {
    assert.equal(pointInPolygon(77.1018, 13.3409, zone.polygon), true);
  });
  it('point outside the ring is outside', () => {
    assert.equal(pointInPolygon(78.0, 14.0, zone.polygon), false);
  });
  it('valid coordinate PASSES the geo-fence', () => {
    assert.equal(checkGeoFence(77.1018, 13.3409, zone).ok, true);
  });
  it('out-of-zone coordinate → ZONE_VIOLATION', () => {
    const r = checkGeoFence(78.0, 14.0, zone);
    assert.equal(r.ok, false);
    assert.equal((r as any).code, RejectCode.ZONE_VIOLATION);
  });
});

describe('MPR check 2 — season', () => {
  it('permitted season PASSES', () => {
    assert.equal(checkSeason(species, 'RABI').ok, true);
  });
  it('off-season → SEASON_VIOLATION', () => {
    const r = checkSeason(species, 'KHARIF');
    assert.equal((r as any).code, RejectCode.SEASON_VIOLATION);
  });
});

describe('MPR check 3 — quota (atomic decrement + offline soft-reserve)', () => {
  it('within quota decrements and passes', () => {
    const d = decideQuota(quota(), 45.5, false);
    assert.equal(d.outcome.ok, true);
    assert.equal(d.newConsumedKg, 45.5);
    assert.equal(d.quotaRemainingAfterKg, 266.5);
    assert.equal(d.overDrawFlagged, false);
  });
  it('online over-quota → QUOTA_EXCEEDED (hard reject, no decrement)', () => {
    const q = quota();
    q.consumedKg = 300;
    const d = decideQuota(q, 50, false);
    assert.equal(d.outcome.ok, false);
    assert.equal((d.outcome as any).code, RejectCode.QUOTA_EXCEEDED);
    assert.equal(d.newConsumedKg, 300); // unchanged
  });
  it('offline over-draw commits FLAGGED, not rejected (§2B fix)', () => {
    const q = quota();
    q.consumedKg = 300;
    const d = decideQuota(q, 50, true);
    assert.equal(d.outcome.ok, true);
    assert.equal(d.overDrawFlagged, true);
    assert.ok(d.quotaRemainingAfterKg < 0);
  });
  it('80% warning fires only on the crossing draw', () => {
    const q = quota();
    q.consumedKg = 240; // 76.9%
    assert.equal(quotaWarning(q, 250), true); // crosses 80%
    q.consumedKg = 260;
    assert.equal(quotaWarning(q, 270), false); // already past 80%
  });
});

describe('MPR check 4 — license', () => {
  it('active, unexpired license PASSES', () => {
    assert.equal(checkLicense(collector, '2026-04-15T00:00:00+05:30').ok, true);
  });
  it('inactive license → LICENSE_INVALID', () => {
    const r = checkLicense({ ...collector, licenseActive: false }, '2026-04-15T00:00:00+05:30');
    assert.equal((r as any).code, RejectCode.LICENSE_INVALID);
  });
  it('expired license → LICENSE_INVALID', () => {
    const r = checkLicense({ ...collector, licenseExpiry: '2025-01-01' }, '2026-04-15T00:00:00+05:30');
    assert.equal((r as any).code, RejectCode.LICENSE_INVALID);
  });
});

describe('MPR check 5 — plant part', () => {
  it('permitted part PASSES', () => {
    assert.equal(checkPlantPart(species, 'ROOT').ok, true);
  });
  it('disallowed part → PART_VIOLATION', () => {
    const r = checkPlantPart(species, 'LEAF');
    assert.equal((r as any).code, RejectCode.PART_VIOLATION);
  });
});

describe('Atomic 5-check runner', () => {
  const base = {
    species,
    zone,
    quota: quota(),
    collector,
    lon: 77.1018,
    lat: 13.3409,
    season: 'RABI',
    part: 'ROOT',
    requestKg: 45.5,
    eventTimeIso: '2026-04-15T06:47:00+05:30',
    offlineSoftReserve: false,
  };
  it('all valid → ALL_PASSED', () => {
    const r = runMpr(base);
    assert.equal(r.outcome.ok, true);
    assert.equal(r.checks.geoFence.ok, true);
  });
  it('single failing check fails the whole transaction', () => {
    const r = runMpr({ ...base, part: 'LEAF' });
    assert.equal(r.outcome.ok, false);
    assert.equal((r.outcome as any).code, RejectCode.PART_VIOLATION);
  });
  it('geo-fence failure takes precedence and rejects the tx', () => {
    const r = runMpr({ ...base, lon: 78.0, lat: 14.0 });
    assert.equal((r.outcome as any).code, RejectCode.ZONE_VIOLATION);
  });
});

describe('Mass balance — the mixing/dilution solution (§4.1)', () => {
  it('honest processing within tolerance PASSES', () => {
    // 100kg fresh, 10% declared drying loss → expect 90kg out; 89kg is within 5%
    const r = checkMassBalance([60, 40], 89, 0.1, 5);
    assert.equal(r.outcome.ok, true);
  });
  it('dilution (filler added) → MASS_BALANCE_VIOLATION', () => {
    // 100kg fresh, 10% loss → expect 90kg; declaring 110kg out means filler was added
    const r = checkMassBalance([60, 40], 110, 0.1, 5);
    assert.equal(r.outcome.ok, false);
    assert.equal((r.outcome as any).code, RejectCode.MASS_BALANCE_VIOLATION);
  });
  it('apportionment sums to 1 and is proportional', () => {
    const props = apportion([
      { epc: 'A', quantityKg: 60 },
      { epc: 'B', quantityKg: 40 },
    ]);
    assert.equal(props.find((p) => p.epc === 'A')!.proportion, 0.6);
    assert.equal(props.reduce((a, p) => a + p.proportion, 0), 1);
  });
});

describe('CP-4 drying time', () => {
  it('dried within 24h PASSES', () => {
    assert.equal(checkDryingTime(3600).ok, true);
  });
  it('late drying → BATCH_STATUS_HOLD', () => {
    const r = checkDryingTime(90000);
    assert.equal((r as any).code, RejectCode.BATCH_STATUS_HOLD);
  });
});

describe('Dual endorsement (§2D — incentive-independent second signature)', () => {
  it('lab + regulator PASSES', () => {
    assert.equal(checkEndorsement('LabMSP', 'NmpbMSP', 'REGULATOR', ['ManufacturerMSP']).ok, true);
  });
  it('same MSP twice → ENDORSEMENT_MISSING', () => {
    const r = checkEndorsement('LabMSP', 'LabMSP', 'REGULATOR', ['ManufacturerMSP']);
    assert.equal((r as any).code, RejectCode.ENDORSEMENT_MISSING);
  });
  it('manufacturer as verifier is rejected (they want the PASS)', () => {
    const r = checkEndorsement('LabMSP', 'ManufacturerMSP', 'REGULATOR', ['ManufacturerMSP']);
    assert.equal((r as any).code, RejectCode.ENDORSEMENT_MISSING);
  });
});

describe('CP-7 formulation gate', () => {
  it('all inputs COMPLETE_PASSED → allowed', () => {
    const r = checkFormulationInputs([
      { epc: 'A', status: GacpStatus.COMPLETE_PASSED },
      { epc: 'B', status: GacpStatus.COMPLETE_PASSED },
    ]);
    assert.equal(r.ok, true);
  });
  it('any non-passed input → BATCH_STATUS_HOLD', () => {
    const r = checkFormulationInputs([
      { epc: 'A', status: GacpStatus.COMPLETE_PASSED },
      { epc: 'B', status: GacpStatus.HOLD },
    ]);
    assert.equal((r as any).code, RejectCode.BATCH_STATUS_HOLD);
  });
});

describe('GACP score (deterministic 0–100)', () => {
  it('two checkpoints + PoLK = 40', () => {
    assert.equal(gacpScore({ checkpointsPassed: 2, polkConfirmed: true, overDrawFlagged: false, weightHold: false }), 40);
  });
  it('all seven + PoLK caps at 100', () => {
    assert.equal(gacpScore({ checkpointsPassed: 7, polkConfirmed: true, overDrawFlagged: false, weightHold: false }), 100);
  });
  it('over-draw flag subtracts', () => {
    assert.equal(gacpScore({ checkpointsPassed: 2, polkConfirmed: true, overDrawFlagged: true, weightHold: false }), 20);
  });
});

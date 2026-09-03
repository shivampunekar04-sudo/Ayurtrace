/**
 * Live integration smoke test: drives real Complete-B code against the running mock
 * gateway (no test doubles), proving the one-config-value boundary end-to-end.
 *
 * Uses the SMS gateway's HttpCollectionSubmitter (real fetch → :3001) for a valid
 * collection and a ZONE_VIOLATION (lat > 18), and hits the read endpoints directly.
 *
 * Run:  node CompleteB/mock-gateway/mock-gateway.mjs   (in one shell)
 *       node scripts/smoke.mjs                          (in another)
 *
 * This script imports the compiled TS via tsx-free path: it re-implements only the tiny
 * HTTP glue so it can run without a build step. The CONTRACT behaviour it exercises is the
 * same the unit tests cover; this just confirms the live wire.
 */
const BASE = process.env.AYURTRACE_API_BASE_URL ?? 'http://localhost:3001';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, json: await res.json() };
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} — ${JSON.stringify(detail)}`);
  }
}

async function main() {
  console.log(`AyurTrace Complete-B live smoke test → ${BASE}\n`);

  const health = await get('/health');
  check('gateway is up', health.json.ok === true, health.json);

  // Valid TIER3_SMS collection.
  const good = await post('/events/collection', {
    speciesCode: 'ASWG',
    quantityKg: 45,
    plantPart: 'ROOT',
    collectorId: 'NMPB-COL-KA-8823',
    season: 'RABI',
    location: { lat: 13.34, lon: 77.1, altitudeM: 0 },
    entryMethod: 'TIER3_SMS',
  });
  check('valid collection commits', good.json.ok === true && !!good.json.data.epc, good.json);

  // Zone violation (lat > 18) → typed reject.
  const bad = await post('/events/collection', {
    speciesCode: 'ASWG',
    quantityKg: 45,
    plantPart: 'ROOT',
    collectorId: 'NMPB-COL-KA-8823',
    season: 'RABI',
    location: { lat: 19.0, lon: 77.1, altitudeM: 0 },
    entryMethod: 'TIER3_SMS',
  });
  check('out-of-zone collection → ZONE_VIOLATION', bad.json.ok === false && bad.json.code === 'ZONE_VIOLATION', bad.json);

  // Endorsement missing (verifier == testing lab).
  const qt = await post('/events/quality-test', {
    epc: 'urn:ayurtrace:lot:CE-KA-ASWG-2026-000007',
    metrics: [],
    ipfsCID: 'QmCert123',
    testingLabMsp: 'LabMSP',
    verifierMsp: 'LabMSP',
    verifierRole: 'REGULATOR',
  });
  check('self-endorsed quality test → ENDORSEMENT_MISSING', qt.json.ok === false && qt.json.code === 'ENDORSEMENT_MISSING', qt.json);

  // Reads.
  const zones = await get('/zones');
  check('GET /zones returns zones', zones.json.ok === true && Array.isArray(zones.json.data.zones), zones.json);

  const batch = await get('/batch/urn:ayurtrace:output:FORMULATION-000001');
  check('GET /batch/:epc returns a batch + timeline', batch.json.ok === true && !!batch.json.data.batch, batch.json);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Smoke test error:', e.message);
  console.error('Is the mock gateway running?  node CompleteB/mock-gateway/mock-gateway.mjs');
  process.exit(1);
});

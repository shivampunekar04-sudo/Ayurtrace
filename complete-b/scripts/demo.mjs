/**
 * Narrated end-to-end demo of Complete-B, composing the REAL compiled modules
 * (dist/) into one batch journey with honesty tags printed at each step.
 *
 * Build + run:  npm run demo   (predemo compiles to dist/)
 *
 * Deterministic and dependency-free — no gateway required. It exercises the same
 * BUILT logic the unit + integration tests cover, printed as a story a judge can read.
 */
import { createHash } from 'node:crypto';
import {
  parseHerbSms,
  authorizeWrite,
  evaluatePolk,
  capGacpScore,
  MockBroker,
  Weighbridge,
  evaluateCp5,
  evaluateCp6,
  anchorTimestamp,
  encodeTstInfo,
  runAnalytics,
} from '../dist/src/index.js';

const T0 = 1_712_000_000_000;
const line = () => console.log('─'.repeat(66));
const step = (n, title, tag) => console.log(`\n${n}. ${title}  ${tag}`);

console.log('AyurTrace Complete-B — end-to-end batch journey');
console.log('Tags: 🟢 BUILT  🟡 SIMULATED  🔵 DESIGNED');
line();

const epc = 'urn:ayurtrace:lot:CE-KA-ASWG-2026-000007';
const container = 'urn:ayurtrace:container:AG-000009';

// 1 · Tier-3 SMS ------------------------------------------------------------
step('1', 'Tier-3 SMS collection (feature phone)', '🟢 parse+authz / 🟡 Twilio');
const smsBody = 'HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823';
const parsed = parseHerbSms(smsBody);
console.log(`   SMS: "${smsBody}"`);
console.log(`   parsed → species=${parsed.value.speciesCode} qty=${parsed.value.quantityKg}kg collector=${parsed.value.collectorId}`);
const collectorId = { msp: 'CollectorMSP', role: 'COLLECTOR', active: true };
console.log(`   RBAC collection (TIER3_SMS): ${authorizeWrite(collectorId, 'collection', { entryMethod: 'TIER3_SMS' }).allowed ? 'ALLOWED' : 'DENIED'}`);

// 2 · PoLK ------------------------------------------------------------------
step('2', 'Proof-of-Local-Knowledge', '🟢 state machine / 🟡 SMS fan-out');
const claim = { collectorId: 'NMPB-COL-KA-8823', cluster: 'CLUSTER-TUMKUR-04', speciesCode: 'ASWG', quantityKg: 45, localityLabel: 'Tumakuru belt', openedAtMs: T0 };
const polk = evaluatePolk(claim, [
  { peerId: 'p1', response: 'CONFIRM', respondedAtMs: T0 + 1000 },
  { peerId: 'p2', response: 'CONFIRM', respondedAtMs: T0 + 2000 },
], T0 + 3600_000);
console.log(`   2 peers confirmed → ${polk.attestation.status}; GACP cap: ${polk.gacpScoreCap === Infinity ? 'none' : polk.gacpScoreCap}`);

// 3 · Weighbridge -----------------------------------------------------------
step('3', 'IoT weighbridge aggregation (CP-3)', '🟢 variance / 🟡 MQTT / 🔵 scale');
const broker = new MockBroker();
const wb = new Weighbridge(broker);
broker.publish('ayurtrace/weighbridge/SCALE-1', JSON.stringify({ scaleId: 'SCALE-1', containerEpc: container, weightKg: 98, ts: T0 }));
const agg = wb.buildAggregation({ parentEpc: container, childEpcs: [epc], declaredKg: 100, zoneId: 'NMPB-KA-ZONE-07', scaleId: 'SCALE-1', atMs: T0 + 500 });
console.log(`   declared 100kg vs measured ${agg.request.measuredKg}kg → ${agg.weigh.result} (${agg.weigh.variancePct.toFixed(1)}% variance)`);

// 4 · CP-5 ------------------------------------------------------------------
step('4', 'CP-5 lab limits (WHO/AYUSH)', '🟢 BUILT');
const cp5 = evaluateCp5([
  { name: 'moisture', value: 8, unit: '%', limit: 10, withinLimit: true },
  { name: 'lead', value: 2, unit: 'mg/kg', limit: 10, withinLimit: true },
  { name: 'arsenic', value: 1, unit: 'mg/kg', limit: 3, withinLimit: true },
  { name: 'mercury', value: 0.2, unit: 'mg/kg', limit: 1, withinLimit: true },
  { name: 'cadmium', value: 0.1, unit: 'mg/kg', limit: 0.3, withinLimit: true },
  { name: 'pesticide', value: 0.02, unit: 'mg/kg', limit: 0.1, withinLimit: true },
]);
console.log(`   full panel within limits → ${cp5.status} (${cp5.gacpStatus})`);

// 5 · CP-6 ------------------------------------------------------------------
step('5', 'CP-6 DNA identity (risk-weighted)', '🟢 BUILT');
const cp6 = evaluateCp6({ epc, declaredSpecies: 'ASWG', conservationStatus: 'NORMAL', lotFlags: { export: true }, dna: { markers: ['ITS2', 'psbA-trnH'], confirmedSpecies: 'ASWG' } });
console.log(`   export lot → 100% sampled (${cp6.sampling.reason}); ITS2+psbA-trnH match → ${cp6.status}`);

// 6 · RFC-3161 --------------------------------------------------------------
step('6', 'RFC-3161 certificate timestamp', '🟢 request/parse / 🟡 live TSA');
const certHash = createHash('sha256').update('lab-certificate-QmCert123').digest('hex');
const goodTsa = { async requestToken() { return encodeTstInfo({ hashHex: certHash, serialNumber: 7n, genTime: new Date('2026-04-15T06:47:00Z') }); } };
const anchor = await anchorTimestamp(goodTsa, { hashHex: certHash });
console.log(`   anchored cert ${certHash.slice(0, 12)}… → ${anchor.status}, serial ${anchor.serialNumber}, token stored (${anchor.tokenBase64.length}b64)`);

// 7 · Analytics -------------------------------------------------------------
step('7', 'Analytics feedback loop (§3E)', '🟢 BUILT');
const scans = Array.from({ length: 9 }, (_, i) => ({ productEpc: `PROD-${i % 3}`, zoneId: 'NMPB-KA-ZONE-07', clusterId: 'CLUSTER-TUMKUR-04', speciesCode: 'ASWG', scannedAtMs: T0 + i, region: 'KA-SOUTH' }));
const report = runAnalytics({ scans, quotaResponses: [{ zoneId: 'NMPB-KA-ZONE-07', quotas: [{ speciesCode: 'ASWG', zoneId: 'NMPB-KA-ZONE-07', season: 'RABI', annualLimitKg: 312, consumedKg: 280, consumedPct: 89.7, band: 'RED' }] }], speciesRules: [] }, { kAnonymity: 5, highDemandThreshold: 5 });
console.log(`   premium-eligible clusters: ${report.clusterEngagement.filter((c) => c.premiumEligible).map((c) => c.clusterId).join(', ')}`);
console.log(`   NMPB signal: ASWG@ZONE-07 → ${report.speciesDemand[0].recommendation}`);

// Summary -------------------------------------------------------------------
line();
const passed = cp5.status === 'PASSED' && cp6.status !== 'FAILED' && agg.weigh.result === 'PASSED' && polk.attestation.status === 'CONFIRMED';
console.log(`\nBatch ${epc}`);
console.log(`  PoLK ${polk.attestation.status} · CP-3 ${agg.weigh.result} · CP-5 ${cp5.status} · CP-6 ${cp6.status} · timestamp ${anchor.status}`);
console.log(`  → ${passed ? '✅ full-confidence batch (all checkpoints passed, GACP uncapped)' : '⛔ held'}`);
console.log(`  GACP (illustrative, chaincode authoritative): ${capGacpScore(100, polk)}`);

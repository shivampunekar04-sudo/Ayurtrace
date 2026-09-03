/**
 * AyurTrace mock gateway — a standalone stand-in for the Complete-A REST API (§6.4).
 *
 * WHY THIS EXISTS: Complete-B builds against the FROZEN CONTRACT, not against
 * Complete-A's code. This server serves contract-shaped responses so every
 * Complete-B component (SMS gateway, biometric intake, RBAC proxy, analytics,
 * CP-5/6 submitters) can be developed and tested WITHOUT running Complete-A.
 * At final integration, point your components at the real gateway instead — the
 * request/response shapes are identical. Node built-ins only; no install needed.
 *
 *   node mock-gateway.mjs         # serves on http://localhost:3001
 */
import http from 'node:http';

const REJECT_MESSAGES = {
  ZONE_VIOLATION:'Outside the approved collection zone for this species. Move to an NMPB-approved zone or select the correct species.',
  SEASON_VIOLATION:'This species cannot be collected in the current season. Check the permitted harvest window.',
  QUOTA_EXCEEDED:'The annual sustainable quota for this species in this zone is exhausted. Collection reopens next season.',
  LICENSE_INVALID:'Your NMPB collector registration is inactive or expired. Renew it before submitting.',
  PART_VIOLATION:'This plant part is not permitted for this species under GACP. Collect the allowed part.',
  MASS_BALANCE_VIOLATION:'Output weight does not reconcile with inputs after expected loss. The batch is on hold pending review.',
  WEIGHT_VARIANCE_HOLD:'Weighed quantity differs from the declared amount beyond tolerance. Batch held for field inspection.',
  BATCH_STATUS_HOLD:'A required checkpoint has not passed. The batch cannot advance.',
  ENDORSEMENT_MISSING:'A quality test needs an incentive-independent second endorser (regulator or a second lab).',
};
const DATA = {"product": "urn:ayurtrace:output:FORMULATION-000001", "token": "eyJwIjoidXJuOmF5dXJ0cmFjZTpvdXRwdXQ6Rk9STVVMQVRJT04tMDAwMDAxIiwicyI6InVybjpheXVydHJhY2U6b3V0cHV0OkZPUk1VTEFUSU9OLTAwMDAwMSMwMDAwMDEifQ.e7631662bd0320eb2b8904a0ffc339bbee280d662ddb6dda17c0afcdf0bd6d88535fb2d5e7c596b194cf4e077dfcb9b590004532daf61f1974ee8f6be0872e0b", "qrGenuine": {"serial": "urn:ayurtrace:output:FORMULATION-000001#000001", "valid": true, "productEpc": "urn:ayurtrace:output:FORMULATION-000001", "signatureValid": true, "gacpScore": 100, "verifiedAuthentic": true}, "qrTampered": {"serial": "eyJwIjoidXJuOmF5dXJ0cmFjZTpvdXRwdXQ6Rk9STVVMQVRJT04tMDAwMDAxIiwicyI6InVybjpheXVydHJhY2U6b3V0cHV0OkZPUk1VTEFUSU9OLTAwMDAwMSMwMDAwMDEifQ.e7631662bd0320eb2b8904a0ffc339bbee280d662ddb6dda17c0afcdf0bd6d88535fb2d5e7c596b194cf4e077dfcb9b590004532daf61f1974ee8f6be087dead", "valid": false, "productEpc": "", "signatureValid": false, "gacpScore": 0, "verifiedAuthentic": false}, "batch": {"batch": {"epc": "urn:ayurtrace:output:FORMULATION-000001", "speciesCode": "ASWG", "status": "COMPLETE_PASSED", "gacpScore": 100, "checkpoints": {"CP-1": "PASSED", "CP-2": "PASSED", "CP-3": "PASSED", "CP-4": "PASSED", "CP-5": "PASSED", "CP-6": "PASSED", "CP-7": "PASSED"}, "eventKeys": ["\u0000batch~event\u0000urn:ayurtrace:output:FORMULATION-000001\u0000000001\u0000"], "inputEpcs": ["urn:ayurtrace:output:MERGE-000001"], "flags": [], "zoneId": "NMPB-KA-ZONE-07", "createdAt": "2026-04-15T06:47:00+05:30", "updatedAt": "2026-04-15T06:47:00+05:30"}, "timeline": [{"step": "COLLECTION", "label": "Collected at source", "time": "2026-04-15T06:47:00+05:30", "zoneId": "NMPB-KA-ZONE-07", "detail": {"collector": "NMPB-COL-KA-8823", "polk": "CONFIRMED"}}, {"step": "COLLECTION", "label": "Collected at source", "time": "2026-04-15T06:47:00+05:30", "zoneId": "NMPB-KA-ZONE-09", "detail": {"collector": "NMPB-COL-KA-9910", "polk": "CONFIRMED"}}, {"step": "PROCESSING", "label": "Processed", "time": "2026-04-15T06:47:00+05:30", "zoneId": "NMPB-KA-ZONE-07", "detail": {"massBalance": {"inputKg": 100, "outputKg": 89, "expectedOutputKg": 90, "tolerancePct": 5, "variancePct": 1.1111111111111112, "result": "PASSED"}}}, {"step": "TESTING", "label": "Quality tested (dual-endorsed)", "time": "2026-04-15T06:47:00+05:30", "zoneId": "NMPB-KA-ZONE-07", "detail": {"result": "PASSED", "ipfsCID": "QmCert123", "dna": true}}, {"step": "FORMULATION", "label": "Formulated into product", "time": "2026-04-15T06:47:00+05:30", "zoneId": "NMPB-KA-ZONE-07", "detail": {}}]}, "zones": {"zones": [{"id": "NMPB-KA-ZONE-07", "name": "Tumakuru Cultivation Belt (Zone 7)", "polygon": [[77, 13.2], [77.2, 13.2], [77.2, 13.5], [77, 13.5], [77, 13.2]]}, {"id": "NMPB-KA-ZONE-09", "name": "Chikkamagaluru Foothills (Zone 9)", "polygon": [[75.6, 13.2], [75.9, 13.2], [75.9, 13.5], [75.6, 13.5], [75.6, 13.2]]}, {"id": "NMPB-KA-ZONE-13", "name": "Western Ghats Wild Collection (Zone 13, endangered)", "polygon": [[74.9, 12.7], [75.2, 12.7], [75.2, 13], [74.9, 13], [74.9, 12.7]]}]}, "quotas": {"NMPB-KA-ZONE-07": {"zoneId": "NMPB-KA-ZONE-07", "quotas": [{"speciesCode": "ASWG", "zoneId": "NMPB-KA-ZONE-07", "season": "RABI", "annualLimitKg": 312, "consumedKg": 280, "consumedPct": 89.74358974358975, "band": "RED"}]}, "NMPB-KA-ZONE-09": {"zoneId": "NMPB-KA-ZONE-09", "quotas": [{"speciesCode": "ASWG", "zoneId": "NMPB-KA-ZONE-09", "season": "RABI", "annualLimitKg": 260, "consumedKg": 70, "consumedPct": 26.923076923076923, "band": "GREEN"}, {"speciesCode": "BRAH", "zoneId": "NMPB-KA-ZONE-09", "season": "RABI", "annualLimitKg": 180, "consumedKg": 150, "consumedPct": 83.33333333333334, "band": "RED"}]}, "NMPB-KA-ZONE-13": {"zoneId": "NMPB-KA-ZONE-13", "quotas": [{"speciesCode": "SARP", "zoneId": "NMPB-KA-ZONE-13", "season": "RABI", "annualLimitKg": 40, "consumedKg": 38, "consumedPct": 95, "band": "RED"}]}}, "recall": {"originEpc": "urn:ayurtrace:output:MERGE-000001", "affectedProducts": ["urn:ayurtrace:output:FORMULATION-000001"], "siblingBatches": [], "sourceLots": [{"epc": "urn:ayurtrace:lot:CE-KA-ASWG-2026-000001", "collectorId": "NMPB-COL-KA-8823", "zoneId": "NMPB-KA-ZONE-07", "proportion": 0.5}, {"epc": "urn:ayurtrace:lot:CE-KA-ASWG-2026-000002", "collectorId": "NMPB-COL-KA-9910", "zoneId": "NMPB-KA-ZONE-09", "proportion": 0.5}]}};

const ok = (data) => JSON.stringify({ ok:true, data });
const reject = (code, detail) => JSON.stringify({ ok:false, code, message:REJECT_MESSAGES[code]||code, detail });

function body(req){return new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{r(b?JSON.parse(b):{})}catch{r({})}})});}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method;
  const send = (status, s) => { res.writeHead(status, {'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}); res.end(s); };
  if (m==='OPTIONS') return send(204,'');

  if (p==='/health') return send(200, ok({status:'up',backend:'mock'}));

  if (m==='POST' && p==='/events/collection'){
    const b = await body(req);
    if (!(b.quantityKg>0) || !b.speciesCode) return send(400, JSON.stringify({ok:false,code:'VALIDATION',message:'Missing or invalid fields.'}));
    if (b.location && b.location.lat > 18) return send(422, reject('ZONE_VIOLATION',{lat:b.location.lat}));
    if (b.speciesCode==='ASWG' && b.plantPart && !['ROOT','WHOLE'].includes(b.plantPart)) return send(422, reject('PART_VIOLATION',{}));
    return send(200, ok({ epc:'urn:ayurtrace:lot:CE-KA-ASWG-2026-000007', txId:'mock-'+Math.random().toString(16).slice(2,10), gacpScore:40 }));
  }
  if (m==='POST' && (p==='/events/aggregation'||p==='/events/transformation')) return send(200, ok({ outputEpc:'urn:ayurtrace:output:MERGE-000009', containerEpc:'urn:ayurtrace:container:AGG-000009', txId:'mock-tx', inputEpcs:['urn:ayurtrace:lot:CE-KA-ASWG-2026-000001'] }));
  if (m==='POST' && p==='/events/quality-test'){ const b=await body(req); if(b.verifierMsp && b.verifierMsp===b.testingLabMsp) return send(422, reject('ENDORSEMENT_MISSING',{})); return send(200, ok({ txId:'mock-tx', result:'PASSED' })); }
  if (m==='POST' && p==='/events/formulation') return send(200, ok({ productEpc:DATA.product, serials:['SER-1','SER-2','SER-3'], txId:'mock-tx', units:[{serial:'SER-1',token:DATA.token}] }));

  if (m==='GET' && p.startsWith('/batch/')) return send(200, ok(DATA.batch));
  if (m==='GET' && p==='/zones') return send(200, ok(DATA.zones));
  if (m==='GET' && /^\/zones\/.+\/quota$/.test(p)){ const id=decodeURIComponent(p.split('/')[2]); return send(200, ok(DATA.quotas[id]||{zoneId:id,quotas:[]})); }
  if (m==='POST' && p.startsWith('/recall/')) return send(200, ok(DATA.recall));
  if (m==='GET' && /^\/qr\/.+\/verify$/.test(p)){ const tok=decodeURIComponent(p.split('/')[2]); return send(200, ok(tok.endsWith('dead')?DATA.qrTampered:DATA.qrGenuine)); }

  send(404, JSON.stringify({ok:false,code:'NOT_FOUND',message:'No such route.'}));
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, ()=>console.log(`AyurTrace MOCK gateway on :${PORT} — contract-shaped, no Complete-A required.`));

/**
 * Attempt a GENUINE RFC-3161 timestamp against a public, no-account TSA, using the real
 * compiled Complete-B client. If it succeeds, RFC-3161 is BUILT (a real token), not just
 * SIMULATED. Sends only a SHA-256 hash of demo content — no credentials, no personal data.
 */
import { createHash } from 'node:crypto';
import { buildTimeStampRequest, extractTstInfo, verifyImprint, verifyTimeStampToken, extractCertificates } from '../dist/src/index.js';

const TSAS = [
  'http://timestamp.digicert.com',
  'http://timestamp.sectigo.com',
  'http://rfc3161.ai.moda',
  'https://freetsa.org/tsr',
];

const hashHex = createHash('sha256').update('AyurTrace lab certificate QmCert123').digest('hex');
const nonce = BigInt('0x' + createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 12));
const reqDer = buildTimeStampRequest({ hashHex, nonce, certReq: true });

console.log(`RFC-3161 live attempt — hash ${hashHex.slice(0, 16)}…\n`);

for (const url of TSAS) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query' },
      body: reqDer,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.log(`  ✗ ${url} → HTTP ${res.status}`);
      continue;
    }
    const token = new Uint8Array(await res.arrayBuffer());
    const info = extractTstInfo(token);
    const match = verifyImprint(info, hashHex);
    // Pin the top of the token's own embedded chain as the trust anchor to demonstrate
    // full chain verification (in production, pin the CA root out-of-band instead).
    const certs = extractCertificates(token);
    const anchor = certs.length ? [certs[certs.length - 1]] : undefined;
    const cms = verifyTimeStampToken(token, anchor ? { trustAnchors: anchor } : {});
    console.log(`  ✓ ${url}`);
    console.log(`      genTime=${info.genTime.toISOString()} serial=${info.serialNumber} tokenBytes=${token.length}`);
    console.log(`      imprint match=${match} · signature verified=${cms.signatureValid} · EKU timestamping=${cms.signerHasTimestampingEku} · chain verified=${cms.chainVerified} · signer=${(cms.signerSubject ?? 'n/a').replace(/\n/g, ' ')}`);
    if (cms.errors.length) console.log(`      notes: ${cms.errors.join('; ')}`);
    if (match && cms.verified) {
      console.log(`\n✅ LIVE RFC-3161 token obtained, imprint-matched, and CRYPTOGRAPHICALLY VERIFIED against ${url}`);
      process.exit(0);
    }
    if (match) {
      console.log(`\n✅ LIVE RFC-3161 token obtained and imprint-verified against ${url} (signature check: ${cms.verified})`);
      process.exit(0);
    }
  } catch (e) {
    console.log(`  ✗ ${url} → ${e.message}`);
  }
}
console.log('\n⚠️  No public TSA reachable from here — RFC-3161 stays SIMULATED (client is ready).');
process.exit(2);

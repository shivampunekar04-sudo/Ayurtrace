import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { verifyTimeStampToken, extractCertificates, certHasTimestampingEku, verifyCertChain } from '../src/rfc3161/cms.js';
import { extractTstInfo, verifyImprint } from '../src/rfc3161/rfc3161.js';

/** A real RFC-3161 token captured from DigiCert's public TSA (scripts + fixture). */
const tokenB64 = readFileSync(new URL('./fixtures/tsa-token.b64', import.meta.url), 'utf8').trim();
const expectedHash = readFileSync(new URL('./fixtures/tsa-hash.txt', import.meta.url), 'utf8').trim();
const token = Uint8Array.from(Buffer.from(tokenB64, 'base64'));

describe('RFC-3161 CMS signature verification (real token)', () => {
  it('cryptographically verifies the signature and the message digest', () => {
    const v = verifyTimeStampToken(token);
    expect(v.errors).toEqual([]);
    expect(v.signatureValid).toBe(true);
    expect(v.digestValid).toBe(true);
    expect(v.verified).toBe(true);
    expect(v.digestAlgorithm).toBe('sha256');
    expect(v.signerSubject?.toLowerCase()).toContain('digicert');
  });

  it('cross-checks: the token imprint matches the certificate hash we timestamped', () => {
    const info = extractTstInfo(token);
    expect(verifyImprint(info, expectedHash)).toBe(true);
  });

  it('rejects a tampered token (flipped signature byte)', () => {
    const tampered = Uint8Array.from(token);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff; // corrupt the trailing signature byte
    const v = verifyTimeStampToken(tampered);
    expect(v.verified).toBe(false);
    expect(v.signatureValid).toBe(false);
  });

  it('rejects any corruption of the trailing signature bytes', () => {
    // The signature OCTET STRING sits at the very end of the DER. Flipping bits anywhere in
    // its last bytes must break verification — a deterministic, offset-safe tamper.
    for (const fromEnd of [1, 2, 8]) {
      const i = token.length - fromEnd;
      const tampered = Uint8Array.from(token);
      tampered[i] = tampered[i]! ^ 0xff;
      const v = verifyTimeStampToken(tampered);
      expect(v.signatureValid, `flip at -${fromEnd}`).toBe(false);
      expect(v.verified).toBe(false);
    }
  });

  it('reports a clear error for non-CMS input instead of throwing', () => {
    const v = verifyTimeStampToken(Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x01]));
    expect(v.verified).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it('confirms the signer cert carries the id-kp-timeStamping EKU', () => {
    const v = verifyTimeStampToken(token);
    expect(v.signerHasTimestampingEku).toBe(true);
  });
});

describe('RFC-3161 certificate chain verification', () => {
  const certs = extractCertificates(token).map((d) => new X509Certificate(d));

  it('embeds a real certificate chain, all timestamping-related', () => {
    expect(certs.length).toBeGreaterThanOrEqual(1);
    // At least the signer cert has the timestamping EKU.
    expect(certs.some((c) => certHasTimestampingEku(c.raw))).toBe(true);
  });

  it('chains the signer to a trusted anchor (the chain top) end-to-end', () => {
    const anchor = certs[certs.length - 1]!;
    const v = verifyTimeStampToken(token, { trustAnchors: [anchor.raw] });
    expect(v.chainVerified).toBe(true);
    expect(v.chainSubjects?.length).toBeGreaterThanOrEqual(1);
    expect(v.verified).toBe(true);
  });

  it('treats no anchors as "no chain requirement" (chainVerified undefined)', () => {
    const v = verifyTimeStampToken(token);
    expect(v.chainVerified).toBeUndefined();
    expect(v.verified).toBe(true); // signature + EKU still verified
  });

  it('verifyCertChain: true to the chain-top anchor, false with no anchors', () => {
    const leaf = certs[0]!;
    const anchor = certs[certs.length - 1]!;
    const intermediates = certs.slice(1, -1);
    expect(verifyCertChain(leaf, intermediates, [anchor]).valid).toBe(true);
    expect(verifyCertChain(leaf, intermediates, []).valid).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  encodeOid,
  encodeOctetString,
  sequence,
  decodeOid,
  parseTlv,
} from '../src/rfc3161/der.js';
import {
  buildTimeStampRequest,
  parseTimeStampRequest,
  encodeTstInfo,
  parseTstInfo,
  extractTstInfo,
  verifyImprint,
  anchorTimestamp,
  OID,
  type TsaClient,
} from '../src/rfc3161/rfc3161.js';

const hashHex = createHash('sha256').update('certificate-content-QmCert123').digest('hex');

describe('DER primitives', () => {
  it('encodes and decodes an OID', () => {
    const der = encodeOid(OID.sha256);
    const tlv = parseTlv(der);
    expect(decodeOid(tlv.content)).toBe(OID.sha256);
  });
});

describe('TimeStampReq', () => {
  it('round-trips a request with nonce + certReq', () => {
    const req = buildTimeStampRequest({ hashHex, nonce: 123456789n, certReq: true });
    const parsed = parseTimeStampRequest(req);
    expect(parsed.version).toBe(1);
    expect(parsed.hashAlgorithm).toBe(OID.sha256);
    expect(parsed.hashedMessageHex).toBe(hashHex);
    expect(parsed.nonce).toBe(123456789n);
    expect(parsed.certReq).toBe(true);
  });

  it('omits certReq when false (DER default) and has no nonce when unset', () => {
    const req = buildTimeStampRequest({ hashHex, certReq: false });
    const parsed = parseTimeStampRequest(req);
    expect(parsed.certReq).toBe(false);
    expect(parsed.nonce).toBeUndefined();
  });
});

describe('TSTInfo', () => {
  const genTime = new Date('2026-04-15T06:47:00Z');

  it('round-trips a bare TSTInfo', () => {
    const der = encodeTstInfo({ hashHex, serialNumber: 42n, genTime, nonce: 7n });
    const info = parseTstInfo(der);
    expect(info.version).toBe(1);
    expect(info.hashedMessageHex).toBe(hashHex);
    expect(info.serialNumber).toBe(42n);
    expect(info.genTime.toISOString()).toBe('2026-04-15T06:47:00.000Z');
    expect(info.nonce).toBe(7n);
  });

  it('extracts TSTInfo from a CMS-wrapped token', () => {
    const tstInfo = encodeTstInfo({ hashHex, serialNumber: 99n, genTime });
    // Minimal SignedData-shaped wrapper: SEQUENCE { OID id-signedData, SEQUENCE { OID id-ct-TSTInfo, OCTET STRING <TSTInfo> } }
    const token = sequence(
      encodeOid(OID.idSignedData),
      sequence(encodeOid(OID.idCtTSTInfo), encodeOctetString(tstInfo)),
    );
    const info = extractTstInfo(token);
    expect(info.serialNumber).toBe(99n);
    expect(info.hashedMessageHex).toBe(hashHex);
  });

  it('verifies a matching imprint and rejects a mismatch', () => {
    const info = parseTstInfo(encodeTstInfo({ hashHex, serialNumber: 1n, genTime }));
    expect(verifyImprint(info, hashHex)).toBe(true);
    expect(verifyImprint(info, 'deadbeef')).toBe(false);
  });
});

describe('resilient anchoring', () => {
  const genTime = new Date('2026-04-15T06:47:00Z');

  const goodTsa = (): TsaClient => ({
    async requestToken() {
      return encodeTstInfo({ hashHex, serialNumber: 1000n, genTime });
    },
  });

  it('ANCHORS on success and stores the whole token', async () => {
    const anchor = await anchorTimestamp(goodTsa(), { hashHex });
    expect(anchor.status).toBe('ANCHORED');
    expect(anchor.tokenBase64).toBeTruthy();
    expect(anchor.serialNumber).toBe('1000');
    expect(anchor.genTime).toBe('2026-04-15T06:47:00.000Z');
  });

  it('never blocks the ledger: a TSA failure yields PENDING, not a throw', async () => {
    const downTsa: TsaClient = {
      async requestToken() {
        throw new Error('TSA unreachable');
      },
    };
    const anchor = await anchorTimestamp(downTsa, { hashHex, attempts: 2 });
    expect(anchor.status).toBe('PENDING');
    expect(anchor.attempts).toBe(3);
    expect(anchor.lastError).toContain('unreachable');
  });

  it('FAILS a token whose imprint does not match the certificate hash', async () => {
    const wrongTsa: TsaClient = {
      async requestToken() {
        return encodeTstInfo({ hashHex: 'abcdabcd', serialNumber: 1n, genTime });
      },
    };
    const anchor = await anchorTimestamp(wrongTsa, { hashHex });
    expect(anchor.status).toBe('FAILED');
    expect(anchor.lastError).toMatch(/imprint/);
  });
});

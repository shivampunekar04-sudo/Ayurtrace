/**
 * Property / fuzz tests — the parsers and the CMS verifier must never crash the process on
 * hostile input, and encode→decode round-trips must hold. Uses a seeded PRNG for reproducibility.
 */
import { describe, it, expect } from 'vitest';
import { parseHerbSms } from '../src/sms/parser.js';
import { encodeInteger, encodeOid, encodeOctetString, decodeOid, parseTlv, toHex } from '../src/rfc3161/der.js';
import { verifyTimeStampToken } from '../src/rfc3161/cms.js';
import { extractTstInfo } from '../src/rfc3161/rfc3161.js';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('DER encode/decode round-trips', () => {
  it('INTEGER round-trips for random non-negative bigints', () => {
    const rand = rng(1);
    for (let i = 0; i < 500; i++) {
      const v = BigInt(Math.floor(rand() * Number.MAX_SAFE_INTEGER));
      const tlv = parseTlv(encodeInteger(v));
      let back = 0n;
      for (const b of tlv.content) back = (back << 8n) | BigInt(b);
      expect(back).toBe(v);
    }
  });

  it('OID round-trips for random arc sequences', () => {
    const rand = rng(2);
    for (let i = 0; i < 300; i++) {
      const arcs = [rand() < 0.5 ? 1 : 2, Math.floor(rand() * 39)];
      const n = 1 + Math.floor(rand() * 6);
      for (let j = 0; j < n; j++) arcs.push(Math.floor(rand() * 1_000_000));
      const oid = arcs.join('.');
      expect(decodeOid(parseTlv(encodeOid(oid)).content)).toBe(oid);
    }
  });

  it('OCTET STRING round-trips for random byte buffers', () => {
    const rand = rng(3);
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rand() * 64);
      const bytes = Uint8Array.from({ length: len }, () => Math.floor(rand() * 256));
      expect(toHex(parseTlv(encodeOctetString(bytes)).content)).toBe(toHex(bytes));
    }
  });
});

describe('parsers never crash on hostile input', () => {
  it('SMS parser: random strings always return a structured result', () => {
    const rand = rng(4);
    const alphabet = ' HERBASWG0123456789.,+-abcdefXYZ\t\n';
    for (let i = 0; i < 2000; i++) {
      const len = Math.floor(rand() * 40);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      const r = parseHerbSms(s);
      expect(typeof r.ok).toBe('boolean');
      if (r.ok) {
        expect(r.value.quantityKg).toBeGreaterThan(0);
        expect(r.value.lat).toBeGreaterThanOrEqual(-90);
        expect(r.value.lat).toBeLessThanOrEqual(90);
        expect(r.value.lon).toBeGreaterThanOrEqual(-180);
        expect(r.value.lon).toBeLessThanOrEqual(180);
      } else {
        expect(r.help).toBeTruthy();
      }
    }
  });

  it('CMS verifier: random bytes never throw, always report unverified', () => {
    const rand = rng(5);
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * 200);
      const bytes = Uint8Array.from({ length: len }, () => Math.floor(rand() * 256));
      const v = verifyTimeStampToken(bytes);
      expect(v.verified).toBe(false);
      expect(Array.isArray(v.errors)).toBe(true);
    }
  });

  it('extractTstInfo either parses or throws a controlled error (never hangs/crashes)', () => {
    const rand = rng(6);
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * 120);
      const bytes = Uint8Array.from({ length: len }, () => Math.floor(rand() * 256));
      try {
        extractTstInfo(bytes);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });
});

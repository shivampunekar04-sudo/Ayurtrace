/**
 * RFC-3161 trusted timestamping (component 3).
 *
 * HONESTY TAG:
 *   🟢 BUILT — build a TimeStampReq (DER), parse it back, parse a TSTInfo, and verify the
 *     message imprint matches the certificate hash. All pure + unit-tested offline.
 *   🟡 SIMULATED — `HttpTsaClient` posts a real application/timestamp-query to a TSA URL;
 *     it works the moment a real TSA endpoint is configured (none is exercised here).
 *   🔵 DESIGNED — full CMS SignedData signature + TSA certificate-chain verification. This
 *     module structurally locates the TSTInfo inside a token and verifies the imprint, but
 *     does NOT cryptographically verify the TSA signature/chain — that needs the TSA cert
 *     and a real token. We store the whole token (not a boolean) so verification can be
 *     completed later.
 *
 * Resilience (spec §3): a TSA failure NEVER blocks the ledger. `anchorTimestamp` returns a
 * PENDING anchor to be retried; the quality_test event commits regardless.
 *
 * Contract: this augments quality_test metadata only; it changes no core enforcement and
 * adds no contract field (the anchor is stored/anchored alongside the event by the caller).
 */
import {
  concat,
  decodeOid,
  encodeBoolean,
  encodeGeneralizedTime,
  encodeInteger,
  encodeNull,
  encodeOctetString,
  encodeOid,
  fromHex,
  parseChildren,
  parseTlv,
  sequence,
  TAG,
  toHex,
  type Tlv,
} from './der.js';
import { verifyTimeStampToken } from './cms.js';

export const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  sha1: '1.3.14.3.2.26',
  sha512: '2.16.840.1.101.3.4.2.3',
  idSignedData: '1.2.840.113549.1.7.2',
  idCtTSTInfo: '1.2.840.113549.1.9.16.1.4',
  /** A placeholder policy OID for fixtures. Real policy comes from the TSA. */
  demoPolicy: '1.3.6.1.4.1.99999.1',
} as const;

export type HashAlgorithm = 'sha256' | 'sha1' | 'sha512';

function algorithmIdentifier(hashAlgorithm: HashAlgorithm): Uint8Array {
  return sequence(encodeOid(OID[hashAlgorithm]), encodeNull());
}

function messageImprint(hashAlgorithm: HashAlgorithm, hashHex: string): Uint8Array {
  return sequence(algorithmIdentifier(hashAlgorithm), encodeOctetString(fromHex(hashHex)));
}

export interface TimeStampRequestOptions {
  hashHex: string;
  hashAlgorithm?: HashAlgorithm;
  /** Random nonce to bind request↔response (recommended). */
  nonce?: bigint;
  /** Ask the TSA to include its signing cert (certReq). Default true. */
  certReq?: boolean;
}

/** Build an RFC-3161 TimeStampReq as DER bytes. */
export function buildTimeStampRequest(opts: TimeStampRequestOptions): Uint8Array {
  const hashAlgorithm = opts.hashAlgorithm ?? 'sha256';
  const certReq = opts.certReq ?? true;
  const parts: Uint8Array[] = [
    encodeInteger(1), // version v1
    messageImprint(hashAlgorithm, opts.hashHex),
  ];
  if (opts.nonce !== undefined) parts.push(encodeInteger(opts.nonce));
  if (certReq) parts.push(encodeBoolean(true)); // DEFAULT FALSE → only emit when true
  return sequence(...parts);
}

export interface ParsedTimeStampRequest {
  version: number;
  hashAlgorithm: string;
  hashedMessageHex: string;
  nonce?: bigint;
  certReq: boolean;
}

function intFromContent(content: Uint8Array): bigint {
  let v = 0n;
  for (const b of content) v = (v << 8n) | BigInt(b);
  return v;
}

/** Parse a TimeStampReq back (round-trip / inspection). */
export function parseTimeStampRequest(derBytes: Uint8Array): ParsedTimeStampRequest {
  const root = parseTlv(derBytes);
  const children = parseChildren(root.content);
  const version = Number(intFromContent(children[0]!.content));
  const imprint = parseChildren(children[1]!.content);
  const algId = parseChildren(imprint[0]!.content);
  const hashAlgorithm = decodeOid(algId[0]!.content);
  const hashedMessageHex = toHex(imprint[1]!.content);

  let nonce: bigint | undefined;
  let certReq = false;
  for (let i = 2; i < children.length; i++) {
    const c = children[i]!;
    if (c.tag === TAG.INTEGER) nonce = intFromContent(c.content);
    else if (c.tag === 0x01) certReq = c.content[0] === 0xff;
  }
  return { version, hashAlgorithm, hashedMessageHex, ...(nonce !== undefined ? { nonce } : {}), certReq };
}

export interface TstInfo {
  version: number;
  policy: string;
  hashAlgorithm: string;
  hashedMessageHex: string;
  serialNumber: bigint;
  genTime: Date;
  nonce?: bigint;
}

/** Encode a bare TSTInfo (for fixtures/tests; a real TSA wraps this in CMS SignedData). */
export function encodeTstInfo(info: {
  policy?: string;
  hashAlgorithm?: HashAlgorithm;
  hashHex: string;
  serialNumber: bigint;
  genTime: Date;
  nonce?: bigint;
}): Uint8Array {
  const hashAlgorithm = info.hashAlgorithm ?? 'sha256';
  const parts: Uint8Array[] = [
    encodeInteger(1),
    encodeOid(info.policy ?? OID.demoPolicy),
    messageImprint(hashAlgorithm, info.hashHex),
    encodeInteger(info.serialNumber),
    encodeGeneralizedTime(info.genTime),
  ];
  if (info.nonce !== undefined) parts.push(encodeInteger(info.nonce));
  return sequence(...parts);
}

function parseGeneralizedTime(content: Uint8Array): Date {
  const s = Buffer.from(content).toString('ascii'); // YYYYMMDDHHMMSSZ
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  return new Date(iso);
}

/** Parse a bare TSTInfo SEQUENCE. */
export function parseTstInfo(derBytes: Uint8Array): TstInfo {
  const root = parseTlv(derBytes);
  const c = parseChildren(root.content);
  const version = Number(intFromContent(c[0]!.content));
  const policy = decodeOid(c[1]!.content);
  const imprint = parseChildren(c[2]!.content);
  const algId = parseChildren(imprint[0]!.content);
  const hashAlgorithm = decodeOid(algId[0]!.content);
  const hashedMessageHex = toHex(imprint[1]!.content);
  const serialNumber = intFromContent(c[3]!.content);
  const genTime = parseGeneralizedTime(c[4]!.content);
  let nonce: bigint | undefined;
  for (let i = 5; i < c.length; i++) {
    if (c[i]!.tag === TAG.INTEGER) {
      nonce = intFromContent(c[i]!.content);
      break;
    }
  }
  return { version, policy, hashAlgorithm, hashedMessageHex, serialNumber, genTime, ...(nonce !== undefined ? { nonce } : {}) };
}

/**
 * Best-effort structural extraction of the TSTInfo from a timestamp token. Handles both a
 * bare TSTInfo and a CMS-wrapped TimeStampToken by searching for the OCTET STRING whose
 * content is a TSTInfo SEQUENCE (INTEGER version + OID policy). Does NOT verify the CMS
 * signature/chain — that is the DESIGNED step.
 */
export function extractTstInfo(tokenDer: Uint8Array): TstInfo {
  // Bare TSTInfo?
  try {
    const info = parseTstInfo(tokenDer);
    if (info.version === 1 && info.policy) return info;
  } catch {
    // fall through to CMS search
  }

  const found = findTstInfo(tokenDer);
  if (!found) throw new Error('extractTstInfo: no TSTInfo found in token');
  return found;
}

function looksLikeTstInfo(seq: Uint8Array): boolean {
  try {
    const root = parseTlv(seq);
    if (root.tag !== TAG.SEQUENCE) return false;
    const c = parseChildren(root.content);
    return c.length >= 5 && c[0]!.tag === TAG.INTEGER && c[1]!.tag === TAG.OID;
  } catch {
    return false;
  }
}

function findTstInfo(bytes: Uint8Array): TstInfo | null {
  // Walk the DER tree by absolute offset into the original buffer.
  const visit = (start: number, end: number): TstInfo | null => {
    let offset = start;
    while (offset < end) {
      let node: Tlv;
      try {
        node = parseTlv(bytes, offset);
      } catch {
        return null;
      }
      // An OCTET STRING wrapping a TSTInfo (eContent) — the RFC-3161 shape.
      if (node.tag === TAG.OCTET_STRING && looksLikeTstInfo(node.content)) {
        return parseTstInfo(node.content);
      }
      // A SEQUENCE that IS a TSTInfo.
      if (node.tag === TAG.SEQUENCE) {
        const whole = bytes.slice(offset, node.next);
        if (looksLikeTstInfo(whole)) return parseTstInfo(whole);
      }
      // Recurse into constructed nodes (constructed bit 0x20).
      if ((node.tag & 0x20) !== 0) {
        const found = visit(node.contentStart, node.contentEnd);
        if (found) return found;
      }
      offset = node.next;
    }
    return null;
  };
  return visit(0, bytes.length);
}

/** Verify the token's message imprint matches the expected content hash. */
export function verifyImprint(info: TstInfo, expectedHashHex: string, expectedAlg: HashAlgorithm = 'sha256'): boolean {
  return (
    info.hashedMessageHex.toLowerCase() === expectedHashHex.toLowerCase() &&
    info.hashAlgorithm === OID[expectedAlg]
  );
}

// ---- TSA client + resilient anchoring ---------------------------------------

/** A TSA client returns the raw timestamp-token bytes for a request. */
export interface TsaClient {
  requestToken(requestDer: Uint8Array): Promise<Uint8Array>;
}

/** 🟡 SIMULATED-until-run HTTP TSA client (RFC-3161 over HTTP). */
export class HttpTsaClient implements TsaClient {
  constructor(private readonly tsaUrl: string) {}
  async requestToken(requestDer: Uint8Array): Promise<Uint8Array> {
    const res = await fetch(this.tsaUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query' },
      body: requestDer,
    });
    if (!res.ok) throw new Error(`TSA HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export type AnchorStatus = 'ANCHORED' | 'PENDING' | 'FAILED';

export interface TimestampAnchor {
  hashHex: string;
  hashAlgorithm: HashAlgorithm;
  status: AnchorStatus;
  /** The whole token, base64 — stored so verification can complete later (not a boolean). */
  tokenBase64?: string;
  genTime?: string;
  serialNumber?: string;
  tsaUrl?: string;
  attempts: number;
  lastError?: string;
  /** true when the token is a real CMS SignedData whose signature verified (see cms.ts). */
  signatureVerified?: boolean;
  /** signer certificate subject, when the token carried one. */
  signerSubject?: string;
}

export interface AnchorOptions {
  hashHex: string;
  hashAlgorithm?: HashAlgorithm;
  nonce?: bigint;
  tsaUrl?: string;
  attempts?: number;
}

/**
 * Request a timestamp WITHOUT ever blocking the ledger. On success returns an ANCHORED
 * anchor (with the stored token, verified against the imprint); on any TSA failure returns
 * a PENDING anchor to retry. Never throws for TSA/network problems.
 */
export async function anchorTimestamp(client: TsaClient, opts: AnchorOptions): Promise<TimestampAnchor> {
  const hashAlgorithm = opts.hashAlgorithm ?? 'sha256';
  const attempts = (opts.attempts ?? 0) + 1;
  const base: TimestampAnchor = {
    hashHex: opts.hashHex,
    hashAlgorithm,
    status: 'PENDING',
    attempts,
    ...(opts.tsaUrl ? { tsaUrl: opts.tsaUrl } : {}),
  };

  try {
    const requestDer = buildTimeStampRequest({
      hashHex: opts.hashHex,
      hashAlgorithm,
      ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
    });
    const token = await client.requestToken(requestDer);
    const info = extractTstInfo(token);
    if (!verifyImprint(info, opts.hashHex, hashAlgorithm)) {
      return { ...base, status: 'FAILED', lastError: 'Token imprint does not match the certificate hash.' };
    }
    // Best-effort cryptographic verification: real CMS tokens get their signature checked;
    // a bare TSTInfo (e.g. a test double) simply reports signatureVerified=false.
    const cms = verifyTimeStampToken(token);
    return {
      ...base,
      status: 'ANCHORED',
      tokenBase64: Buffer.from(token).toString('base64'),
      genTime: info.genTime.toISOString(),
      serialNumber: info.serialNumber.toString(),
      signatureVerified: cms.verified,
      ...(cms.signerSubject ? { signerSubject: cms.signerSubject } : {}),
    };
  } catch (err) {
    return { ...base, status: 'PENDING', lastError: err instanceof Error ? err.message : String(err) };
  }
}

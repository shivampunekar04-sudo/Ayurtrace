/**
 * Minimal ASN.1 DER encoder + TLV parser — just enough for RFC-3161 (component 3).
 *
 * HONESTY TAG: 🟢 BUILT — pure, unit-tested. Not a general ASN.1 library; it supports the
 * types RFC-3161 TimeStampReq / TSTInfo need: INTEGER, OCTET STRING, OBJECT IDENTIFIER,
 * BOOLEAN, NULL, GeneralizedTime, and SEQUENCE.
 */

export const TAG = {
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  SEQUENCE: 0x30,
  GENERALIZED_TIME: 0x18,
} as const;

function encodeLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function tlv(tag: number, content: number[]): number[] {
  return [tag, ...encodeLength(content.length), ...content];
}

export function der(tag: number, content: number[]): Uint8Array {
  return Uint8Array.from(tlv(tag, content));
}

/** Encode a non-negative integer (number or bigint) as a DER INTEGER. */
export function encodeInteger(value: number | bigint): Uint8Array {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) throw new Error('encodeInteger: negative values not supported');
  const bytes: number[] = [];
  if (v === 0n) bytes.push(0);
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  // High bit set → prepend 0x00 so it stays positive.
  if (bytes[0]! & 0x80) bytes.unshift(0x00);
  return der(TAG.INTEGER, bytes);
}

export function encodeOctetString(bytes: Uint8Array): Uint8Array {
  return der(TAG.OCTET_STRING, Array.from(bytes));
}

export function encodeBoolean(value: boolean): Uint8Array {
  return der(0x01, [value ? 0xff : 0x00]);
}

export function encodeNull(): Uint8Array {
  return der(TAG.NULL, []);
}

/** Encode a dotted OID string, e.g. '2.16.840.1.101.3.4.2.1'. */
export function encodeOid(oid: string): Uint8Array {
  const parts = oid.split('.').map((p) => parseInt(p, 10));
  if (parts.length < 2) throw new Error('encodeOid: need at least two arcs');
  const first = parts[0]! * 40 + parts[1]!;
  const body: number[] = [first];
  for (let i = 2; i < parts.length; i++) {
    let arc = parts[i]!;
    const chunk: number[] = [arc & 0x7f];
    arc >>= 7;
    while (arc > 0) {
      chunk.unshift((arc & 0x7f) | 0x80);
      arc >>= 7;
    }
    body.push(...chunk);
  }
  return der(TAG.OID, body);
}

/** Encode a Date as GeneralizedTime (UTC, 'YYYYMMDDHHMMSSZ'). */
export function encodeGeneralizedTime(date: Date): Uint8Array {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const s =
    `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return der(TAG.GENERALIZED_TIME, Array.from(Buffer.from(s, 'ascii')));
}

export function sequence(...parts: Uint8Array[]): Uint8Array {
  const content: number[] = [];
  for (const part of parts) content.push(...Array.from(part));
  return der(TAG.SEQUENCE, content);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---- parsing ----------------------------------------------------------------

export interface Tlv {
  tag: number;
  /** byte offset where content starts. */
  contentStart: number;
  /** byte offset one past the end of content. */
  contentEnd: number;
  /** byte offset one past the whole TLV (next TLV). */
  next: number;
  content: Uint8Array;
}

/** Parse a single TLV at `offset`. */
export function parseTlv(bytes: Uint8Array, offset = 0): Tlv {
  if (offset >= bytes.length) throw new Error('parseTlv: offset past end');
  const tag = bytes[offset]!;
  let p = offset + 1;
  const first = bytes[p]!;
  p += 1;
  let length: number;
  if (first < 0x80) {
    length = first;
  } else {
    const numBytes = first & 0x7f;
    if (numBytes === 0 || numBytes > 4) throw new Error('parseTlv: unsupported length');
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | bytes[p]!;
      p += 1;
    }
  }
  const contentStart = p;
  const contentEnd = p + length;
  if (contentEnd > bytes.length) throw new Error('parseTlv: content exceeds buffer');
  return { tag, contentStart, contentEnd, next: contentEnd, content: bytes.slice(contentStart, contentEnd) };
}

/** Parse all TLV children within a SEQUENCE/SET content buffer. */
export function parseChildren(content: Uint8Array): Tlv[] {
  const out: Tlv[] = [];
  let offset = 0;
  while (offset < content.length) {
    const tlvNode = parseTlv(content, offset);
    out.push(tlvNode);
    offset = tlvNode.next;
  }
  return out;
}

/** Decode a DER OID content buffer back to a dotted string. */
export function decodeOid(content: Uint8Array): string {
  const first = content[0]!;
  const arcs: number[] = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let i = 1; i < content.length; i++) {
    const b = content[i]!;
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      arcs.push(value);
      value = 0;
    }
  }
  return arcs.join('.');
}

export const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
export const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));

/**
 * QR signing (solution §3A). On FormulationEvent the manufacturer key signs each
 * serialized unit; the QR encodes a signed token. Verification is cryptographic,
 * so a copied or edited QR fails signature check — it is not a database lookup.
 * The manufacturer key is held server-side (execution plan §Identity).
 */
import { Injectable } from '@nestjs/common';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// @noble/ed25519 v2 requires a SHA-512 implementation to be wired in.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const toB64Url = (b: Uint8Array): string =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s: string): Uint8Array =>
  new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const unhex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'hex'));
const enc = new TextEncoder();

export interface SignedUnit {
  serial: string;
  /** the string the QR image encodes: <payloadB64>.<signatureHex> */
  token: string;
}

@Injectable()
export class QrService {
  private readonly priv: Uint8Array;
  readonly pubHex: string;

  constructor() {
    const fromEnv = process.env.QR_SIGNING_KEY;
    this.priv = fromEnv ? unhex(fromEnv) : ed.utils.randomPrivateKey();
    this.pubHex = hex(ed.getPublicKey(this.priv));
  }

  /** Sign every serialized unit of a formulated product. */
  mint(productEpc: string, serials: string[]): SignedUnit[] {
    return serials.map((serial) => {
      const payload = toB64Url(enc.encode(JSON.stringify({ p: productEpc, s: serial })));
      const signature = hex(ed.sign(enc.encode(payload), this.priv));
      return { serial, token: `${payload}.${signature}` };
    });
  }

  /** Verify a scanned token. Returns the product/serial when the signature holds. */
  verify(token: string): { signatureValid: boolean; productEpc?: string; serial?: string } {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return { signatureValid: false };
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    let signatureValid = false;
    try {
      signatureValid = ed.verify(unhex(sig), enc.encode(payload), unhex(this.pubHex));
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) return { signatureValid: false };
    try {
      const decoded = JSON.parse(Buffer.from(fromB64Url(payload)).toString('utf8'));
      return { signatureValid: true, productEpc: decoded.p, serial: decoded.s };
    } catch {
      return { signatureValid: false };
    }
  }
}

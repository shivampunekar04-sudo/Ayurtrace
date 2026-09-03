/**
 * CMS SignedData signature verification for RFC-3161 timestamp tokens (component 3).
 *
 * HONESTY TAG: 🟢 BUILT — cryptographically verifies a real TimeStampToken: parses the CMS
 * SignedData, checks the signed `messageDigest` attribute equals the digest of the TSTInfo,
 * and verifies the signer's signature over the signed attributes using the TSA certificate
 * embedded in the token (RSA PKCS#1 v1.5, RSA-PSS, and ECDSA). Verified against a REAL token
 * from a public TSA (test/fixtures + scripts/tsa-live.mjs). 🔵 DESIGNED remaining: chaining
 * the TSA certificate to a trusted root — this verifies the signature and the cert's validity
 * window, but not that the cert descends from a pinned trust anchor (supply one to complete it).
 */
import crypto from 'node:crypto';
import {
  parseTlv,
  toHex,
  TAG,
  type Tlv,
} from './der.js';

interface Node extends Tlv {
  /** absolute offset of this node's tag byte. */
  start: number;
}

function readNode(bytes: Uint8Array, start: number): Node {
  return { start, ...parseTlv(bytes, start) };
}

/** Child nodes of a constructed node, with absolute offsets preserved. */
function childNodes(bytes: Uint8Array, parent: Node): Node[] {
  const out: Node[] = [];
  let offset = parent.contentStart;
  while (offset < parent.contentEnd) {
    const node = readNode(bytes, offset);
    out.push(node);
    offset = node.next;
  }
  return out;
}

function fullBytes(bytes: Uint8Array, node: Node): Uint8Array {
  return bytes.slice(node.start, node.next);
}

function firstOid(bytes: Uint8Array, algIdSeq: Node): string {
  const children = childNodes(bytes, algIdSeq);
  const oidNode = children.find((c) => c.tag === TAG.OID);
  return oidNode ? decodeOidContent(oidNode.content) : '';
}

function decodeOidContent(content: Uint8Array): string {
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

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  messageDigest: '1.2.840.113549.1.9.4',
  contentType: '1.2.840.113549.1.9.3',
  // signature algorithms
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  sha384WithRSA: '1.2.840.113549.1.1.12',
  sha512WithRSA: '1.2.840.113549.1.1.13',
  rsaPss: '1.2.840.113549.1.1.10',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  ecdsaSha512: '1.2.840.10045.4.3.4',
} as const;

const HASH_BY_OID: Record<string, string> = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};

export interface VerifyOptions {
  /** Trusted root/anchor certificates (PEM string or DER bytes). When supplied, the signer's
   *  certificate is chained up to one of these and the id-kp-timeStamping EKU is required. */
  trustAnchors?: (string | Uint8Array | Buffer)[];
}

export interface TokenVerification {
  /** signature over the signed attributes verifies against the embedded TSA cert. */
  signatureValid: boolean;
  /** the signed messageDigest attribute equals the digest of the TSTInfo content. */
  digestValid: boolean;
  /** signatureValid && digestValid && cert currently within validity window. */
  verified: boolean;
  signerSubject?: string;
  signerIssuer?: string;
  signerSerial?: string;
  validFrom?: string;
  validTo?: string;
  digestAlgorithm?: string;
  signatureAlgorithmOid?: string;
  /** true when the signer cert carries the id-kp-timeStamping extended key usage. */
  signerHasTimestampingEku?: boolean;
  /** set only when trustAnchors were supplied: signer chains to a trusted anchor. */
  chainVerified?: boolean;
  /** subjects along the verified path, signer → anchor. */
  chainSubjects?: string[];
  errors: string[];
}

const OID_EKU = '2.5.29.37';
const OID_TIMESTAMPING = '1.3.6.1.5.5.7.3.8';

function toCert(input: string | Uint8Array | Buffer): crypto.X509Certificate {
  return new crypto.X509Certificate(typeof input === 'string' ? input : Buffer.from(input));
}

/** Does a certificate (DER) carry the id-kp-timeStamping extended key usage? */
export function certHasTimestampingEku(certDer: Uint8Array): boolean {
  try {
    const cert = readNode(certDer, 0); // Certificate SEQUENCE
    const tbs = childNodes(certDer, cert)[0]!; // tbsCertificate SEQUENCE
    // Extensions live in a [3] EXPLICIT context tag (0xA3) inside tbsCertificate.
    const extsCtx = childNodes(certDer, tbs).find((c) => c.tag === 0xa3);
    if (!extsCtx) return false;
    const extsSeq = childNodes(certDer, extsCtx)[0]!; // Extensions SEQUENCE OF
    for (const ext of childNodes(certDer, extsSeq)) {
      const parts = childNodes(certDer, ext);
      const oidNode = parts.find((p) => p.tag === TAG.OID);
      if (!oidNode || decodeOidContent(oidNode.content) !== OID_EKU) continue;
      const octet = parts.find((p) => p.tag === TAG.OCTET_STRING);
      if (!octet) return false;
      const ekuSeq = readNode(octet.content, 0); // SEQUENCE OF KeyPurposeId
      for (const purpose of childNodes(octet.content, ekuSeq)) {
        if (purpose.tag === TAG.OID && decodeOidContent(purpose.content) === OID_TIMESTAMPING) return true;
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

function sameCert(a: crypto.X509Certificate, b: crypto.X509Certificate): boolean {
  return a.raw.equals(b.raw);
}

export interface ChainResult {
  valid: boolean;
  subjects: string[];
}

/** Verify a certificate chain from `leaf` up to one of `anchors`, using `intermediates`. */
export function verifyCertChain(
  leaf: crypto.X509Certificate,
  intermediates: crypto.X509Certificate[],
  anchors: crypto.X509Certificate[],
): ChainResult {
  const subjects: string[] = [leaf.subject];
  const now = Date.now();
  const withinValidity = (c: crypto.X509Certificate) =>
    new Date(c.validFrom).getTime() <= now && now <= new Date(c.validTo).getTime();

  if (!withinValidity(leaf)) return { valid: false, subjects };

  let current = leaf;
  const pool = [...intermediates, ...anchors];
  for (let depth = 0; depth < 10; depth++) {
    if (anchors.some((a) => sameCert(a, current))) return { valid: true, subjects };
    const issuer = pool.find((c) => {
      try {
        return current.checkIssued(c) && current.verify(c.publicKey) && withinValidity(c);
      } catch {
        return false;
      }
    });
    if (!issuer) {
      // current might itself be a trusted self-signed anchor.
      return { valid: anchors.some((a) => sameCert(a, current)), subjects };
    }
    subjects.push(issuer.subject);
    if (anchors.some((a) => sameCert(a, issuer))) return { valid: true, subjects };
    current = issuer;
  }
  return { valid: false, subjects };
}

/** Normalise a hex serial: uppercase, strip leading zero bytes. */
function normSerial(hex: string): string {
  return hex.replace(/^0+/, '').toUpperCase();
}

/** Is this SEQUENCE node a ContentInfo whose contentType is id-signedData? */
function isSignedDataContentInfo(bytes: Uint8Array, node: Node): boolean {
  if (node.tag !== TAG.SEQUENCE) return false;
  const kids = childNodes(bytes, node);
  return kids[0]?.tag === TAG.OID && decodeOidContent(kids[0]!.content) === OID.signedData;
}

/** Find the SignedData ContentInfo in a bare token or a wrapping TimeStampResp. */
function locateContentInfo(bytes: Uint8Array): Node | null {
  const root = readNode(bytes, 0);
  if (isSignedDataContentInfo(bytes, root)) return root;
  // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken ContentInfo }
  for (const child of childNodes(bytes, root)) {
    if (isSignedDataContentInfo(bytes, child)) return child;
  }
  return null;
}

/** Verify a real RFC-3161 timestamp token's CMS signature end-to-end. */
export function verifyTimeStampToken(tokenDer: Uint8Array, options: VerifyOptions = {}): TokenVerification {
  const errors: string[] = [];
  const result: TokenVerification = { signatureValid: false, digestValid: false, verified: false, errors };

  try {
    // Accept either a bare TimeStampToken (ContentInfo) or a full TimeStampResp
    // (SEQUENCE { PKIStatusInfo, TimeStampToken }); locate the SignedData ContentInfo.
    const contentInfo = locateContentInfo(tokenDer);
    if (!contentInfo) {
      errors.push('not a CMS SignedData (no signedData ContentInfo found)');
      return result;
    }
    const ciChildren = childNodes(tokenDer, contentInfo);
    const explicit0 = ciChildren.find((c) => c.tag === 0xa0);
    if (!explicit0) {
      errors.push('missing SignedData content');
      return result;
    }
    const signedData = childNodes(tokenDer, explicit0)[0]!;
    const sdChildren = childNodes(tokenDer, signedData);

    // encapContentInfo is the first SEQUENCE after version(INT) + digestAlgorithms(SET).
    const encap = sdChildren.find((c, i) => i >= 2 && c.tag === TAG.SEQUENCE);
    if (!encap) {
      errors.push('missing encapContentInfo');
      return result;
    }
    const encapChildren = childNodes(tokenDer, encap);
    const eContentExplicit = encapChildren.find((c) => c.tag === 0xa0);
    if (!eContentExplicit) {
      errors.push('missing eContent');
      return result;
    }
    const eContentOctet = childNodes(tokenDer, eContentExplicit)[0]!;
    const tstInfoDer = eContentOctet.content; // the bytes that were signed/digested

    // certificates [0] IMPLICIT
    const certsNode = sdChildren.find((c) => c.tag === 0xa0);
    const certDers: Uint8Array[] = certsNode
      ? childNodes(tokenDer, certsNode).filter((c) => c.tag === TAG.SEQUENCE).map((c) => fullBytes(tokenDer, c))
      : [];

    // signerInfos SET OF SignerInfo (the last SET, tag 0x31)
    const signerInfos = [...sdChildren].reverse().find((c) => c.tag === 0x31);
    if (!signerInfos) {
      errors.push('missing signerInfos');
      return result;
    }
    const signerInfo = childNodes(tokenDer, signerInfos)[0]!;
    const siChildren = childNodes(tokenDer, signerInfo);

    // SignerInfo: version, sid, digestAlgorithm, [signedAttrs], sigAlgorithm, signature
    const sid = siChildren[1]!;
    let signerSerial: string | undefined;
    if (sid.tag === TAG.SEQUENCE) {
      const sidChildren = childNodes(tokenDer, sid);
      const serialNode = [...sidChildren].reverse().find((c) => c.tag === TAG.INTEGER);
      if (serialNode) signerSerial = normSerial(toHex(serialNode.content));
    }

    const digestAlgSeq = siChildren.find((c, i) => i >= 2 && c.tag === TAG.SEQUENCE)!;
    const digestOid = firstOid(tokenDer, digestAlgSeq);
    const hashName = HASH_BY_OID[digestOid] ?? 'sha256';
    result.digestAlgorithm = hashName;

    const signedAttrs = siChildren.find((c) => c.tag === 0xa0); // [0] IMPLICIT
    // signatureAlgorithm is the SEQUENCE after signedAttrs (or after digestAlg if no attrs)
    const seqNodes = siChildren.filter((c) => c.tag === TAG.SEQUENCE);
    const sigAlgSeq = seqNodes[seqNodes.length - 1]!;
    const sigAlgOid = firstOid(tokenDer, sigAlgSeq);
    result.signatureAlgorithmOid = sigAlgOid;

    const sigOctet = [...siChildren].reverse().find((c) => c.tag === TAG.OCTET_STRING)!;
    const signature = Buffer.from(sigOctet.content);

    // --- digest check: messageDigest attr == hash(eContent) ---
    if (signedAttrs) {
      const attrs = childNodes(tokenDer, signedAttrs);
      const md = findAttrValue(tokenDer, attrs, OID.messageDigest);
      if (md) {
        const computed = crypto.createHash(hashName).update(Buffer.from(tstInfoDer)).digest();
        result.digestValid = Buffer.from(md).equals(computed);
        if (!result.digestValid) errors.push('messageDigest attribute does not match TSTInfo digest');
      } else {
        errors.push('no messageDigest signed attribute');
      }
    } else {
      // No signed attrs: signature is over eContent directly; digest is implicit.
      result.digestValid = true;
    }

    // --- signature check ---
    // Verify over the signed attributes re-encoded as a SET OF (tag 0x31), per CMS.
    let signedData2: Buffer;
    if (signedAttrs) {
      const raw = Uint8Array.from(fullBytes(tokenDer, signedAttrs));
      raw[0] = 0x31; // [0] IMPLICIT -> SET OF for the signature
      signedData2 = Buffer.from(raw);
    } else {
      signedData2 = Buffer.from(tstInfoDer);
    }

    const cert = selectSignerCert(certDers, signerSerial);
    if (!cert) {
      errors.push('no signer certificate in token');
      return result;
    }
    result.signerSubject = cert.subject;
    result.signerIssuer = cert.issuer;
    result.signerSerial = normSerial(cert.serialNumber);
    result.validFrom = cert.validFrom;
    result.validTo = cert.validTo;

    result.signatureValid = verifySignature(sigAlgOid, hashName, signedData2, cert.publicKey, signature);
    if (!result.signatureValid) errors.push('signature does not verify against the signer certificate');

    // Signer must be a timestamping cert.
    result.signerHasTimestampingEku = certHasTimestampingEku(cert.raw);
    if (!result.signerHasTimestampingEku) errors.push('signer certificate lacks the id-kp-timeStamping EKU');

    // validity window
    const now = Date.now();
    const withinValidity = new Date(cert.validFrom).getTime() <= now && now <= new Date(cert.validTo).getTime();
    if (!withinValidity) errors.push('signer certificate is outside its validity window');

    // Optional: chain the signer to a supplied trust anchor.
    if (options.trustAnchors && options.trustAnchors.length > 0) {
      const anchors = options.trustAnchors.map(toCert);
      const allCerts = certDers.map((d) => new crypto.X509Certificate(Buffer.from(d)));
      const intermediates = allCerts.filter((c) => !sameCert(c, cert));
      const chain = verifyCertChain(cert, intermediates, anchors);
      result.chainVerified = chain.valid;
      result.chainSubjects = chain.subjects;
      if (!chain.valid) errors.push('signer certificate does not chain to a trusted anchor');
    }

    const chainOk = result.chainVerified !== false; // undefined (no anchors given) counts as ok
    result.verified =
      result.signatureValid &&
      result.digestValid &&
      withinValidity &&
      result.signerHasTimestampingEku &&
      chainOk;
    return result;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
}

/** Extract the certificate(s) embedded in a timestamp token, as DER buffers. */
export function extractCertificates(tokenDer: Uint8Array): Buffer[] {
  const contentInfo = locateContentInfo(tokenDer);
  if (!contentInfo) return [];
  const explicit0 = childNodes(tokenDer, contentInfo).find((c) => c.tag === 0xa0);
  if (!explicit0) return [];
  const signedData = childNodes(tokenDer, explicit0)[0]!;
  const certsNode = childNodes(tokenDer, signedData).find((c) => c.tag === 0xa0);
  if (!certsNode) return [];
  return childNodes(tokenDer, certsNode)
    .filter((c) => c.tag === TAG.SEQUENCE)
    .map((c) => Buffer.from(fullBytes(tokenDer, c)));
}

function findAttrValue(bytes: Uint8Array, attrs: Node[], attrOid: string): Uint8Array | null {
  for (const attr of attrs) {
    if (attr.tag !== TAG.SEQUENCE) continue;
    const parts = childNodes(bytes, attr); // { type OID, values SET }
    const oidNode = parts.find((p) => p.tag === TAG.OID);
    if (!oidNode || decodeOidContent(oidNode.content) !== attrOid) continue;
    const set = parts.find((p) => p.tag === 0x31);
    if (!set) return null;
    const value = childNodes(bytes, set)[0];
    return value ? value.content : null;
  }
  return null;
}

function selectSignerCert(certDers: Uint8Array[], serial?: string): crypto.X509Certificate | null {
  const certs = certDers.map((d) => new crypto.X509Certificate(Buffer.from(d)));
  if (serial) {
    const match = certs.find((c) => normSerial(c.serialNumber) === serial);
    if (match) return match;
  }
  return certs[0] ?? null;
}

function verifySignature(
  sigAlgOid: string,
  hashName: string,
  data: Buffer,
  publicKey: crypto.KeyObject,
  signature: Buffer,
): boolean {
  try {
    // RSA-PSS
    if (sigAlgOid === OID.rsaPss) {
      return crypto.verify(hashName, data, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, signature);
    }
    // ECDSA — hash pinned by the algorithm OID; CMS signatures are DER-encoded.
    if (sigAlgOid === OID.ecdsaSha256) return crypto.verify('sha256', data, publicKey, signature);
    if (sigAlgOid === OID.ecdsaSha384) return crypto.verify('sha384', data, publicKey, signature);
    if (sigAlgOid === OID.ecdsaSha512) return crypto.verify('sha512', data, publicKey, signature);
    // RSA PKCS#1 v1.5 (sha*WithRSA, or rsaEncryption with the digestAlgorithm's hash)
    const rsaHash =
      sigAlgOid === OID.sha256WithRSA ? 'sha256' :
      sigAlgOid === OID.sha384WithRSA ? 'sha384' :
      sigAlgOid === OID.sha512WithRSA ? 'sha512' :
      hashName;
    return crypto.verify(rsaHash, data, publicKey, signature);
  } catch {
    return false;
  }
}

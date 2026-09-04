/**
 * IpfsService — real IPFS anchoring for lab certificates (§2D).
 *
 * When a pinning token is present it uploads bytes to IPFS and returns the REAL
 * content-addressed CID, so the CID stored on-chain is verifiable and the cert is
 * resolvable at a public gateway. With no token it degrades to a deterministic
 * content hash tagged provider:'mock' — the interface is identical, so the demo
 * works offline and goes live the instant a token is set. No credential is ever
 * hard-coded; it is read from the environment.
 *
 * Providers (first configured wins):
 *   PINATA_JWT           → Pinata pinFileToIPFS (recommended, simplest)
 *   WEB3_STORAGE_TOKEN   → web3.storage legacy upload
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface PinResult {
  cid: string;
  url: string;
  provider: 'pinata' | 'web3.storage' | 'mock';
  live: boolean;
}

@Injectable()
export class IpfsService {
  private readonly log = new Logger('IPFS');
  private readonly pinataJwt = process.env.PINATA_JWT ?? '';
  private readonly web3Token = process.env.WEB3_STORAGE_TOKEN ?? '';
  private readonly gatewayBase = process.env.IPFS_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs/';

  /** Which live provider (if any) is configured. */
  provider(): PinResult['provider'] {
    if (this.pinataJwt) return 'pinata';
    if (this.web3Token) return 'web3.storage';
    return 'mock';
  }
  isLive(): boolean {
    return this.provider() !== 'mock';
  }

  /** Pin bytes to IPFS and return the CID (real when configured, deterministic mock otherwise). */
  async pin(bytes: Uint8Array, filename = 'certificate.pdf', contentType = 'application/octet-stream'): Promise<PinResult> {
    const provider = this.provider();
    if (provider === 'pinata') return this.pinPinata(bytes, filename, contentType);
    if (provider === 'web3.storage') return this.pinWeb3(bytes, filename, contentType);
    return this.mock(bytes);
  }

  private async pinPinata(bytes: Uint8Array, filename: string, contentType: string): Promise<PinResult> {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: contentType }), filename);
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.pinataJwt}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Pinata pin failed HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { IpfsHash: string };
    const cid = json.IpfsHash;
    this.log.log(`Pinned ${filename} to IPFS via Pinata: ${cid}`);
    return { cid, url: this.gatewayBase + cid, provider: 'pinata', live: true };
  }

  private async pinWeb3(bytes: Uint8Array, filename: string, contentType: string): Promise<PinResult> {
    const res = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.web3Token}`, 'x-name': filename, 'content-type': contentType },
      body: bytes,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`web3.storage upload failed HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { cid: string };
    this.log.log(`Uploaded ${filename} to IPFS via web3.storage: ${json.cid}`);
    return { cid: json.cid, url: `https://${json.cid}.ipfs.w3s.link`, provider: 'web3.storage', live: true };
  }

  /** Deterministic, offline stand-in: a content hash tagged so it is never mistaken for a real pin. */
  private mock(bytes: Uint8Array): PinResult {
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 46);
    const cid = `mock-Qm${hash}`;
    return { cid, url: this.gatewayBase + cid, provider: 'mock', live: false };
  }
}

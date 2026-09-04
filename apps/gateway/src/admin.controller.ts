import { Controller, Get, Inject, Post } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { QrService } from './qr/qr.service.js';
import { LEDGER_BACKEND, type LedgerBackend } from './ledger/ledger.backend.js';
import { backendKind, port } from './config/env.js';

/** A backend that can be re-seeded exposes reset(); demo + live do, fabric does not. */
interface Resettable { reset(): Promise<void>; }
function isResettable(b: unknown): b is Resettable {
  return typeof (b as Resettable).reset === 'function';
}

@Controller()
export class AdminController {
  constructor(
    private readonly qr: QrService,
    @Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend,
  ) {}

  @Get('health')
  health() {
    return { ok: true, data: { status: 'up', backend: backendKind() } };
  }

  /** LAN addresses this server is reachable at — so a phone on the same Wi-Fi can
   *  open the dashboards and scan product QRs. */
  @Get('net')
  net() {
    const p = port();
    const hosts: string[] = [];
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) hosts.push(`http://${a.address}:${p}`);
      }
    }
    return { ok: true, data: { port: p, lanUrls: hosts } };
  }

  /** Manufacturer public key so a fully offline verifier can check QR signatures. */
  @Get('qr/pubkey')
  pubkey() {
    return { ok: true, data: { publicKey: this.qr.pubHex, algorithm: 'ed25519' } };
  }

  /** Deterministic re-seed for the active backend — the `reset-demo` hook. */
  @Post('admin/reset-demo')
  async reset() {
    const can = isResettable(this.ledger);
    if (can) await this.ledger.reset();
    return { ok: true, data: { reset: can, backend: backendKind() } };
  }
}

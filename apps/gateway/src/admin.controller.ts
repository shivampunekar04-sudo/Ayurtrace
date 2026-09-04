import { Controller, Get, Inject, Post } from '@nestjs/common';
import { QrService } from './qr/qr.service.js';
import { LEDGER_BACKEND, type LedgerBackend } from './ledger/ledger.backend.js';
import { backendKind } from './config/env.js';

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

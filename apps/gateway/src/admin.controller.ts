import { Controller, Get, Post } from '@nestjs/common';
import { QrService } from './qr/qr.service.js';
import { DemoLedgerBackend } from './ledger/demo.backend.js';
import { backendKind } from './config/env.js';

@Controller()
export class AdminController {
  constructor(
    private readonly qr: QrService,
    private readonly demo: DemoLedgerBackend,
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

  /** Deterministic re-seed for the demo backend — the `reset-demo` HTTP hook. */
  @Post('admin/reset-demo')
  async reset() {
    if (backendKind() === 'demo') await this.demo.reset();
    return { ok: true, data: { reset: backendKind() === 'demo' } };
  }
}

import { Controller, Get, Inject, Param } from '@nestjs/common';
import { GacpStatus, type Ok, type QrVerifyResponse } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';
import { QrService } from './qr.service.js';

@Controller('qr')
export class QrController {
  constructor(
    @Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend,
    private readonly qr: QrService,
  ) {}

  /** :serial is the full signed token the QR encodes (<payload>.<signature>). */
  @Get(':serial/verify')
  async verify(@Param('serial') serial: string): Promise<Ok<QrVerifyResponse>> {
    const token = decodeURIComponent(serial);
    const checked = this.qr.verify(token);

    if (!checked.signatureValid || !checked.productEpc) {
      return {
        ok: true,
        data: {
          serial: token, valid: false, productEpc: checked.productEpc ?? '',
          signatureValid: false, gacpScore: 0, verifiedAuthentic: false,
        },
      };
    }

    // signature holds → confirm the product's on-chain compliance state
    const { batch } = await this.ledger.getBatch(checked.productEpc);
    const verifiedAuthentic =
      batch.status === GacpStatus.COMPLETE_PASSED && batch.flags.length === 0 && batch.gacpScore === 100;

    return {
      ok: true,
      data: {
        serial: checked.serial ?? token, valid: true, productEpc: checked.productEpc,
        signatureValid: true, gacpScore: batch.gacpScore, verifiedAuthentic,
      },
    };
  }
}

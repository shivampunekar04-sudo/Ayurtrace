import { Controller, Get, Header, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import QRCode from 'qrcode';
import { GacpStatus, type Ok, type QrVerifyResponse } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';
import { QrService } from './qr.service.js';

@Controller('qr')
export class QrController {
  constructor(
    @Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend,
    private readonly qr: QrService,
  ) {}

  /**
   * Real scannable QR as an SVG. It encodes a URL to the consumer provenance page,
   * built from the Host the request came in on — so if the dashboard is opened at the
   * laptop's LAN address (e.g. http://192.168.1.x:3001), the QR points there and a phone
   * on the same Wi-Fi can open it. Generated server-side, so it never depends on a CDN.
   */
  @Get(':serial/qr.svg')
  @Header('content-type', 'image/svg+xml')
  @Header('cache-control', 'no-store')
  async qrImage(@Param('serial') serial: string, @Req() req: Request): Promise<string> {
    const token = decodeURIComponent(serial);
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:3001';
    const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http';
    const url = `${proto}://${host}/consumer.html?token=${encodeURIComponent(token)}`;
    return QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#1E2B23', light: '#FBFAF5' },
    });
  }

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

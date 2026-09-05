import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { QrService } from './qr.service.js';

/**
 * Short scan link. The printed QR encodes /p/<serial> (a few dozen chars) instead
 * of the full ~210-char signed token, so it stays low-density and phone-scannable.
 * The signature is deterministic, so we re-mint the token here and redirect to the
 * consumer verify page — the cryptographic check is unchanged.
 */
@Controller('p')
export class ShortLinkController {
  constructor(private readonly qr: QrService) {}

  @Get(':serial')
  redirect(@Param('serial') serial: string, @Res() res: Response): void {
    const s = decodeURIComponent(serial);
    const productEpc = s.split('#')[0];
    const [unit] = this.qr.mint(productEpc, [s]);
    res.redirect(302, '/consumer.html?token=' + encodeURIComponent(unit.token));
  }
}

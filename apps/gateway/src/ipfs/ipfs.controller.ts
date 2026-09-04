import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { Ok } from '@ayurtrace/contracts';
import { IpfsService } from './ipfs.service.js';

class PinDto {
  /** file bytes, base64-encoded (a lab certificate PDF/image). */
  @IsString() contentBase64!: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsString() contentType?: string;
}

/** IPFS anchoring for lab certificates — real CID when a pinning token is configured. */
@Controller('ipfs')
export class IpfsController {
  constructor(private readonly ipfs: IpfsService) {}

  @Get('status')
  status(): Ok<unknown> {
    return { ok: true, data: { live: this.ipfs.isLive(), provider: this.ipfs.provider() } };
  }

  @Post('pin')
  async pin(@Body() dto: PinDto): Promise<Ok<unknown>> {
    const bytes = new Uint8Array(Buffer.from(dto.contentBase64, 'base64'));
    const result = await this.ipfs.pin(
      bytes,
      dto.filename ?? 'certificate.pdf',
      dto.contentType ?? 'application/octet-stream',
    );
    return { ok: true, data: result };
  }
}

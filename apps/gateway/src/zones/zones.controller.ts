import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { Ok } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';

@Controller('zones')
export class ZonesController {
  constructor(@Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend) {}

  @Get()
  async zones(): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.listZones() };
  }

  @Get(':id/quota')
  async quota(@Param('id') id: string): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.zoneQuota(decodeURIComponent(id)) };
  }
}

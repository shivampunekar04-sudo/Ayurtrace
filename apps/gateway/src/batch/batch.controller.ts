import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { Ok } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';

@Controller('batch')
export class BatchController {
  constructor(@Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend) {}

  @Get(':epc')
  async batch(@Param('epc') epc: string): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.getBatch(decodeURIComponent(epc)) };
  }
}

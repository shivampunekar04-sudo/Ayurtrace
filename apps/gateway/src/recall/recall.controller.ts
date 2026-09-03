import { Controller, Inject, Param, Post } from '@nestjs/common';
import type { Ok } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';

@Controller('recall')
export class RecallController {
  constructor(@Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend) {}

  @Post(':epc')
  async recall(@Param('epc') epc: string): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.recall(decodeURIComponent(epc)) };
  }
}

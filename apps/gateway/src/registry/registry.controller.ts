import { Controller, Get, Inject } from '@nestjs/common';
import type { Ok } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';

/**
 * Fleet-wide read endpoints that power the dashboards (registry + overview).
 * All delegate to the same enforcement service as every other read path.
 */
@Controller()
export class RegistryController {
  constructor(@Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend) {}

  @Get('batches')
  async batches(): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.listBatches() };
  }

  @Get('species')
  async species(): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.listSpecies() };
  }

  @Get('collectors')
  async collectors(): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.listCollectors() };
  }

  @Get('stats')
  async stats(): Promise<Ok<unknown>> {
    return { ok: true, data: await this.ledger.stats() };
  }
}

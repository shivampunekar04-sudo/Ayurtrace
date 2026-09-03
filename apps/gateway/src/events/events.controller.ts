import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { Ok } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';
import { QrService } from '../qr/qr.service.js';
import { CollectionDto, AggregationDto, TransformationDto, QualityTestDto, FormulationDto } from './dto.js';

const ok = <T>(data: T): Ok<T> => ({ ok: true, data });

@Controller('events')
export class EventsController {
  constructor(
    @Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend,
    private readonly qr: QrService,
  ) {}

  @Post('collection')
  async collection(@Body() dto: CollectionDto) {
    return ok(await this.ledger.submitCollection(dto));
  }

  @Post('aggregation')
  async aggregation(@Body() dto: AggregationDto) {
    return ok(await this.ledger.submitAggregation(dto));
  }

  @Post('transformation')
  async transformation(@Body() dto: TransformationDto) {
    return ok(await this.ledger.submitTransformation(dto));
  }

  @Post('quality-test')
  async qualityTest(@Body() dto: QualityTestDto) {
    return ok(await this.ledger.submitQualityTest(dto));
  }

  @Post('formulation')
  async formulation(@Body() dto: FormulationDto) {
    const result = await this.ledger.submitFormulation(dto);
    // sign each serialized unit; the signed token is what the printed QR encodes
    const units = this.qr.mint(result.productEpc, result.serials);
    return ok({ ...result, units, signingPubKey: this.qr.pubHex });
  }
}

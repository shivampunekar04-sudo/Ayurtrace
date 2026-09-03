import { Module, type Provider } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LEDGER_BACKEND } from './ledger/ledger.backend.js';
import { DemoLedgerBackend } from './ledger/demo.backend.js';
import { FabricLedgerBackend } from './ledger/fabric.backend.js';
import { RejectFilter } from './common/reject.filter.js';
import { QrService } from './qr/qr.service.js';
import { EventsController } from './events/events.controller.js';
import { BatchController } from './batch/batch.controller.js';
import { ZonesController } from './zones/zones.controller.js';
import { RecallController } from './recall/recall.controller.js';
import { QrController } from './qr/qr.controller.js';
import { AdminController } from './admin.controller.js';
import { backendKind } from './config/env.js';

const backendProvider: Provider =
  backendKind() === 'fabric'
    ? { provide: LEDGER_BACKEND, useClass: FabricLedgerBackend }
    : { provide: LEDGER_BACKEND, useClass: DemoLedgerBackend };

@Module({
  controllers: [
    EventsController, BatchController, ZonesController, RecallController, QrController, AdminController,
  ],
  providers: [
    QrService,
    // expose the concrete demo backend too, so AdminController can reset it locally
    DemoLedgerBackend,
    backendProvider,
    { provide: APP_FILTER, useClass: RejectFilter },
  ],
})
export class AppModule {}

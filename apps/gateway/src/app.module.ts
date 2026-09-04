import { Module, type Provider, type Type } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LEDGER_BACKEND, type LedgerBackend } from './ledger/ledger.backend.js';
import { DemoLedgerBackend } from './ledger/demo.backend.js';
import { LiveLedgerBackend } from './ledger/live.backend.js';
import { FabricLedgerBackend } from './ledger/fabric.backend.js';
import { RejectFilter } from './common/reject.filter.js';
import { QrService } from './qr/qr.service.js';
import { EventsController } from './events/events.controller.js';
import { BatchController } from './batch/batch.controller.js';
import { ZonesController } from './zones/zones.controller.js';
import { RecallController } from './recall/recall.controller.js';
import { RegistryController } from './registry/registry.controller.js';
import { QrController } from './qr/qr.controller.js';
import { IpfsController } from './ipfs/ipfs.controller.js';
import { IpfsService } from './ipfs/ipfs.service.js';
import { FhirController } from './fhir/fhir.controller.js';
import { FhirService } from './fhir/fhir.service.js';
import { AdminController } from './admin.controller.js';
import { backendKind } from './config/env.js';

function backendClass(): Type<LedgerBackend> {
  switch (backendKind()) {
    case 'fabric': return FabricLedgerBackend;
    case 'live': return LiveLedgerBackend;
    default: return DemoLedgerBackend;
  }
}

const backendProvider: Provider = { provide: LEDGER_BACKEND, useClass: backendClass() };

@Module({
  controllers: [
    EventsController, BatchController, ZonesController, RecallController,
    RegistryController, QrController, IpfsController, FhirController, AdminController,
  ],
  providers: [
    QrService,
    IpfsService,
    FhirService,
    backendProvider,
    { provide: APP_FILTER, useClass: RejectFilter },
  ],
})
export class AppModule {}

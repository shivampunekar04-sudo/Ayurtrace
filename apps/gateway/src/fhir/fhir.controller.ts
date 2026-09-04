import { Controller, Get, Param } from '@nestjs/common';
import { FhirService } from './fhir.service.js';

/**
 * FHIR R4 read projection. AyurTrace stores GS1 EPCIS 2.0; these endpoints render
 * any batch as FHIR on demand for clinical-system interoperability. Responses are
 * raw FHIR resources (not the {ok,data} envelope) so a FHIR client can consume them.
 */
@Controller('fhir')
export class FhirController {
  constructor(private readonly fhir: FhirService) {}

  @Get('metadata')
  metadata(): Record<string, unknown> {
    return this.fhir.capabilityStatement();
  }

  @Get('Provenance/:epc')
  async provenance(@Param('epc') epc: string): Promise<Record<string, unknown>> {
    return this.fhir.provenanceBundle(decodeURIComponent(epc));
  }
}

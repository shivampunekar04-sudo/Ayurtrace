/**
 * FHIR read-adapter (HL7 FHIR R4).
 *
 * AyurTrace's source of truth is GS1 EPCIS 2.0 — the actual supply-chain
 * traceability standard, whose native event types model the mixing/merge case.
 * The problem brief said "FHIR-style," so this adapter PROJECTS any batch into a
 * FHIR R4 Bundle on demand (Substance + Provenance + Observations), giving clinical
 * systems an interoperable view without making FHIR the storage model. It is a pure
 * read projection over the same getBatch() every other reader uses — no new state.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { BatchTimelineResponse, TimelineStep } from '@ayurtrace/contracts';
import { LEDGER_BACKEND, type LedgerBackend } from '../ledger/ledger.backend.js';

const SPECIES_SYSTEM = 'https://ayurtrace.example/fhir/CodeSystem/species';

@Injectable()
export class FhirService {
  constructor(@Inject(LEDGER_BACKEND) private readonly ledger: LedgerBackend) {}

  /** Project a batch/product EPC into a FHIR R4 Bundle (collection). */
  async provenanceBundle(epc: string): Promise<Record<string, unknown>> {
    const data = await this.ledger.getBatch(epc);
    const { batch, timeline } = data;

    const collections = timeline.filter((t) => t.step === 'COLLECTION');
    const testing = timeline.find((t) => t.step === 'TESTING');
    const times = timeline.map((t) => t.time).filter(Boolean).sort();

    const substance = {
      resourceType: 'Substance',
      id: this.fhirId(epc),
      status: batch.status === 'COMPLETE_PASSED' ? 'active' : 'inactive',
      code: {
        coding: [{ system: SPECIES_SYSTEM, code: batch.speciesCode }],
        text: batch.speciesCode,
      },
    };

    const provenance = {
      resourceType: 'Provenance',
      id: `prov-${this.fhirId(epc)}`,
      target: [{ reference: `Substance/${this.fhirId(epc)}` }],
      occurredPeriod: times.length ? { start: times[0], end: times[times.length - 1] } : undefined,
      recorded: batch.updatedAt,
      agent: collections.length
        ? collections.map((c) => ({
            type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }] },
            who: { display: `Collector ${(c.detail as Record<string, unknown>)?.collector ?? 'unknown'} (zone ${c.zoneId})` },
          }))
        : [{ type: { coding: [{ code: 'author' }] }, who: { display: 'AyurTrace ledger' } }],
      entity: batch.inputEpcs.map((e) => ({
        role: 'source',
        what: { reference: `Substance/${this.fhirId(e)}` },
      })),
    };

    const observations: Record<string, unknown>[] = [
      {
        resourceType: 'Observation',
        id: `gacp-${this.fhirId(epc)}`,
        status: 'final',
        code: { text: 'GACP compliance score' },
        subject: { reference: `Substance/${this.fhirId(epc)}` },
        valueQuantity: { value: batch.gacpScore, unit: 'score', system: 'http://unitsofmeasure.org', code: '{score}' },
        interpretation: [{ text: batch.gacpScore >= 80 ? 'compliant' : 'review' }],
      },
    ];
    if (testing) {
      const d = (testing.detail ?? {}) as Record<string, unknown>;
      observations.push({
        resourceType: 'Observation',
        id: `qc-${this.fhirId(epc)}`,
        status: 'final',
        code: { text: 'Quality test (dual-endorsed)' },
        subject: { reference: `Substance/${this.fhirId(epc)}` },
        valueString: String(d.result ?? 'UNKNOWN'),
        note: d.ipfsCID ? [{ text: `Certificate IPFS CID: ${d.ipfsCID}` }] : undefined,
      });
      if (d.dna !== undefined) {
        observations.push({
          resourceType: 'Observation',
          id: `dna-${this.fhirId(epc)}`,
          status: 'final',
          code: { text: 'Species identity (DNA barcode ITS2 + psbA-trnH)' },
          subject: { reference: `Substance/${this.fhirId(epc)}` },
          valueString: d.dna ? 'confirmed-match' : 'mismatch',
        });
      }
    }

    return {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      meta: { tag: [{ system: 'https://ayurtrace.example/fhir', code: 'projection-from-epcis-2.0' }] },
      entry: [substance, provenance, ...observations].map((r) => ({
        fullUrl: `urn:uuid:${(r as { id: string }).id}`,
        resource: r,
      })),
    };
  }

  /** Minimal CapabilityStatement so a FHIR client can discover this read projection. */
  capabilityStatement(): Record<string, unknown> {
    return {
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: new Date().toISOString(),
      kind: 'instance',
      software: { name: 'AyurTrace FHIR read-adapter (projection over GS1 EPCIS 2.0)' },
      fhirVersion: '4.0.1',
      format: ['json'],
      rest: [{
        mode: 'server',
        resource: [{ type: 'Provenance', interaction: [{ code: 'read' }] }],
        operation: [{ name: 'provenance-bundle', definition: 'GET /fhir/Provenance/:epc' }],
      }],
    };
  }

  private fhirId(epc: string): string {
    // FHIR ids allow [A-Za-z0-9-.]; map an EPC URN into a safe id.
    return epc.replace(/[^A-Za-z0-9.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  }
}

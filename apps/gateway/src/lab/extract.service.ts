/**
 * LabReportExtractService — read an official Certificate of Analysis and pull the
 * test values out of it, so the analyst can't retype "approximate" numbers into
 * the dashboard. Values come from the issued document, not a human keyboard.
 *
 * Parses plain-text / CSV / labelled reports (no external key needed). The result
 * maps onto the QualityTestRequest metrics the chaincode enforces.
 */
import { Injectable } from '@nestjs/common';

const METRIC_LIMITS: Record<string, number> = {
  moisture: 10, lead: 10, arsenic: 3, mercury: 1, cadmium: 0.3, pesticide: 0.5,
};
const METRIC_KEYWORDS: Array<{ name: keyof typeof METRIC_LIMITS; kw: RegExp }> = [
  { name: 'moisture',  kw: /moisture/i },
  { name: 'lead',      kw: /lead|(\bpb\b)/i },
  { name: 'arsenic',   kw: /arsenic|(\bas\b)/i },
  { name: 'mercury',   kw: /mercury|(\bhg\b)/i },
  { name: 'cadmium',   kw: /cadmium|(\bcd\b)/i },
  { name: 'pesticide', kw: /pesticide/i },
];

export interface ExtractedMetric {
  name: string; value: number; unit: string; limit: number; withinLimit: boolean;
}
export interface ExtractResult {
  epc: string | null;
  species: string | null;
  testingLabMsp: string | null;
  verifierMsp: string | null;
  ipfsCID: string | null;
  dna: { declaredSpecies: string; confirmedSpecies: string } | null;
  metrics: ExtractedMetric[];
  overall: string | null;
  note?: string;
}

@Injectable()
export class LabReportExtractService {
  extract(buffer: Buffer): ExtractResult {
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);

    const metrics: ExtractedMetric[] = [];
    for (const { name, kw } of METRIC_KEYWORDS) {
      const line = lines.find((l) => kw.test(l));
      if (!line) continue;
      const nums = (line.match(/[0-9]+(?:\.[0-9]+)?/g) || []).map(Number);
      if (!nums.length) continue;
      const unit = (line.match(/%|\bppm\b|\bppb\b|\bmg\/kg\b/i) || [])[0] || 'ppm';
      const value = nums[0];
      // limit = the report's stated limit if present, else our known GACP limit
      const limit = nums.length >= 2 ? nums[nums.length - 1] : METRIC_LIMITS[name];
      metrics.push({ name, value, unit, limit, withinLimit: value <= limit });
    }

    const find = (re: RegExp): string | null => {
      const m = text.match(re);
      return m ? m[1].trim() : null;
    };
    const dnaDecl = find(/declared\s+([A-Z][a-z]+\s+[a-z]+)/);
    const dnaConf = find(/confirmed\s+([A-Z][a-z]+\s+[a-z]+)/);

    return {
      epc: (text.match(/urn:ayurtrace:lot:[^\s]+/) || [null])[0],
      species: find(/Species\s*:\s*(.+)/i),
      testingLabMsp: find(/Testing Lab MSP\s*:\s*(\S+)/i),
      verifierMsp: find(/Verifier[^:]*:\s*(\S+)/i),
      ipfsCID: find(/IPFS[^:]*:\s*(\S+)/i) || (text.match(/\bQm[0-9A-Za-z]{6,}/) || [null])[0],
      dna: dnaDecl && dnaConf ? { declaredSpecies: dnaDecl, confirmedSpecies: dnaConf } : null,
      metrics,
      overall: find(/Overall[^:]*:\s*(\w+)/i),
      note: metrics.length
        ? `Extracted ${metrics.length} parameters from the certificate.`
        : 'No recognisable lab parameters found — is this a Certificate of Analysis?',
    };
  }
}

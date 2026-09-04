/**
 * SpeciesIdentifyService — recognise the herb species in a photo.
 *
 * Uses the free Pl@ntNet identification API when PLANTNET_API_KEY is set
 * (server-side only), and maps its botanical result onto the AyurTrace species
 * codes. Without a key it runs in DEMO mode (matches from the file name) so the
 * UI + flow are fully testable offline. This feeds the "species photo-check":
 * the recognised species can be compared to the collector's declaration.
 */
import { Injectable, Logger } from '@nestjs/common';

interface Known { code: string; commonName: string; latin: string; }

// Botanical name -> AyurTrace species code (matches seed/src SPECIES).
const KNOWN: Known[] = [
  { code: 'ASWG', commonName: 'Ashwagandha', latin: 'Withania somnifera' },
  { code: 'BRAH', commonName: 'Brahmi',      latin: 'Bacopa monnieri' },
  { code: 'SARP', commonName: 'Sarpagandha', latin: 'Rauvolfia serpentina' },
  { code: 'KUTK', commonName: 'Kutki',       latin: 'Picrorhiza kurroa' },
  { code: 'JATA', commonName: 'Jatamansi',   latin: 'Nardostachys jatamansi' },
  { code: 'SHAT', commonName: 'Shatavari',   latin: 'Asparagus racemosus' },
  { code: 'GUDU', commonName: 'Guduchi',     latin: 'Tinospora cordifolia' },
  { code: 'AMLA', commonName: 'Amla',        latin: 'Phyllanthus emblica' },
];

export interface IdentifyResult {
  code: string | null;          // AyurTrace species code, or null if no tracked match
  commonName: string | null;
  scientificName: string | null;
  confidence: number;           // 0..1
  source: 'plantnet' | 'demo';
  candidates?: { name: string; score: number }[];
  note?: string;
}

@Injectable()
export class SpeciesIdentifyService {
  private readonly log = new Logger('SpeciesIdentify');

  async identify(buffer: Buffer, filename: string, mimetype: string): Promise<IdentifyResult> {
    const key = process.env.PLANTNET_API_KEY;
    if (key) {
      try { return await this.viaPlantNet(buffer, filename, mimetype, key); }
      catch (e) { this.log.warn(`Pl@ntNet call failed (${(e as Error).message}); using demo fallback`); }
    }
    return this.demo(filename);
  }

  private async viaPlantNet(buffer: Buffer, filename: string, mimetype: string, key: string): Promise<IdentifyResult> {
    const url = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&nb-results=5`;
    const fd = new FormData();
    fd.append('images', new Blob([buffer], { type: mimetype || 'image/jpeg' }), filename || 'herb.jpg');
    fd.append('organs', 'auto');
    const res = await fetch(url, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { results?: Array<{ score?: number; species?: { scientificNameWithoutAuthor?: string } }> };
    const results = Array.isArray(json.results) ? json.results : [];
    const candidates = results.slice(0, 5).map((r) => ({
      name: r?.species?.scientificNameWithoutAuthor ?? 'unknown',
      score: Number(r?.score ?? 0),
    }));
    for (const r of results) {
      const sci = String(r?.species?.scientificNameWithoutAuthor ?? '').toLowerCase();
      const hit = KNOWN.find((k) => sci.includes(k.latin.toLowerCase()));
      if (hit) {
        return {
          code: hit.code, commonName: hit.commonName, scientificName: hit.latin,
          confidence: Number(r?.score ?? 0), source: 'plantnet', candidates,
        };
      }
    }
    const top = candidates[0];
    return {
      code: null, commonName: null, scientificName: top?.name ?? null,
      confidence: top?.score ?? 0, source: 'plantnet', candidates,
      note: 'Recognised a plant, but not one of the tracked AyurTrace species.',
    };
  }

  /** No API key: match from the file name so the feature still demos offline. */
  private demo(filename: string): IdentifyResult {
    const f = (filename || '').toLowerCase();
    const hit = KNOWN.find((k) =>
      f.includes(k.code.toLowerCase()) ||
      f.includes(k.commonName.toLowerCase()) ||
      f.includes(k.latin.split(' ')[0].toLowerCase()));
    if (hit) {
      return {
        code: hit.code, commonName: hit.commonName, scientificName: hit.latin,
        confidence: 0.92, source: 'demo',
        note: 'Demo mode (no PLANTNET_API_KEY): matched from the file name. Add a free Pl@ntNet key for real image recognition.',
      };
    }
    return {
      code: null, commonName: null, scientificName: null, confidence: 0, source: 'demo',
      note: 'Demo mode: name the test image after a species (e.g. brahmi.jpg) to simulate a match, or set PLANTNET_API_KEY for real recognition.',
    };
  }
}

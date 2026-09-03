/**
 * Tier-3 SMS parser (component 1).
 *
 * HONESTY TAG: 🟢 BUILT — pure, unit-tested parser for the feature-phone short-code.
 *
 * Documented grammar (spec §1):
 *   HERB <SPECIES> <QTY> [<PART>] <lat,lon> <COLLECTOR_ID>
 *   e.g.  HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823
 *         HERB ASWG 45 ROOT 13.34,77.10 NMPB-COL-KA-8823   (optional PART, additive)
 *
 * PART is an optional extension to OUR input grammar (not a contract change): if omitted
 * the gateway fills the species' GACP-permitted part. The lat,lon token is located by its
 * comma, so the parser is position-tolerant around the optional part.
 */
export interface ParsedHerbSms {
  speciesCode: string;
  quantityKg: number;
  plantPart?: string;
  lat: number;
  lon: number;
  collectorId: string;
}

export type SmsParseError =
  | 'EMPTY'
  | 'BAD_KEYWORD'
  | 'TOO_FEW_TOKENS'
  | 'BAD_QUANTITY'
  | 'BAD_LATLON'
  | 'MISSING_COLLECTOR';

export type SmsParseResult =
  | { ok: true; value: ParsedHerbSms }
  | { ok: false; error: SmsParseError; help: string };

export const SMS_HELP =
  'Format: HERB <SPECIES> <QTY_KG> <lat,lon> <COLLECTOR_ID>. ' +
  'Example: HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823';

const fail = (error: SmsParseError): SmsParseResult => ({ ok: false, error, help: SMS_HELP });

function parseLatLon(token: string): { lat: number; lon: number } | null {
  if (!token.includes(',')) return null;
  const parts = token.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Parse an inbound SMS body into structured collection fields. */
export function parseHerbSms(raw: string): SmsParseResult {
  if (!raw || !raw.trim()) return fail('EMPTY');

  const tokens = raw.trim().split(/\s+/);
  const [keyword, ...rest] = tokens;
  if (!keyword || keyword.toUpperCase() !== 'HERB') return fail('BAD_KEYWORD');

  // Need at least: SPECIES QTY LATLON COLLECTOR_ID
  if (rest.length < 4) return fail('TOO_FEW_TOKENS');

  const speciesCode = rest[0]!.toUpperCase();

  const quantityKg = Number(rest[1]);
  if (!Number.isFinite(quantityKg) || quantityKg <= 0) return fail('BAD_QUANTITY');

  // The lat,lon token is the one containing a comma; collector id is the last token.
  const latLonIndex = rest.findIndex((t, i) => i >= 2 && t.includes(','));
  if (latLonIndex === -1) return fail('BAD_LATLON');
  const coords = parseLatLon(rest[latLonIndex]!);
  if (!coords) return fail('BAD_LATLON');

  // An optional PART token sits between QTY and the lat,lon token.
  const plantPart = latLonIndex > 2 ? rest[2]!.toUpperCase() : undefined;

  const collectorId = rest[rest.length - 1]!;
  if (latLonIndex >= rest.length - 1 || !collectorId) return fail('MISSING_COLLECTOR');

  return {
    ok: true,
    value: {
      speciesCode,
      quantityKg,
      ...(plantPart ? { plantPart } : {}),
      lat: coords.lat,
      lon: coords.lon,
      collectorId,
    },
  };
}

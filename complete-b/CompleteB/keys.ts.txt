/**
 * Composite-key helpers (§6.5) and EPC URN builders.
 * CouchDB composite keys and Fabric createCompositeKey use the same field order,
 * so recall queries and dashboard reads stay index-aligned across lanes.
 */

/** Fabric composite-key object-type names, kept identical to CouchDB index prefixes. */
export const KEY = {
  quota: 'species~zone~season',
  batchEvent: 'batch~event',
  clusterCollector: 'cluster~collector',
} as const;

export function quotaKey(species: string, zone: string, season: string): string[] {
  return [species, zone, season];
}

export function batchEventKey(batchEpc: string, seq: number): string[] {
  // zero-padded seq keeps lexical order == chronological order for range reads.
  return [batchEpc, String(seq).padStart(6, '0')];
}

export function clusterCollectorKey(cluster: string, collectorId: string): string[] {
  return [cluster, collectorId];
}

/** EPC URN builders — one scheme everywhere so links resolve across lanes. */
export const EPC = {
  /** collection lot, e.g. urn:ayurtrace:lot:CE-KA-ASWG-2026-001234 */
  lot: (state: string, species: string, year: number, seq: number) =>
    `urn:ayurtrace:lot:CE-${state}-${species}-${year}-${String(seq).padStart(6, '0')}`,
  /** aggregation container */
  container: (seq: number) =>
    `urn:ayurtrace:container:AG-${String(seq).padStart(6, '0')}`,
  /** transformation output lot */
  output: (kind: string, seq: number) =>
    `urn:ayurtrace:output:${kind}-${String(seq).padStart(6, '0')}`,
  /** finished-product serialized unit */
  serial: (productEpc: string, unit: number) =>
    `${productEpc}#${String(unit).padStart(6, '0')}`,
  species: (code: string) => `urn:ayurtrace:species:${code}`,
  zone: (id: string) => `urn:ayurtrace:zone:${id}`,
} as const;

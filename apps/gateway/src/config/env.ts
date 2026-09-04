/**
 * Environment configuration.
 *   LEDGER_BACKEND=demo  (default) — in-memory, deterministic clock, resets on
 *                        restart. Used by the golden-path test.
 *   LEDGER_BACKEND=live  — same enforcement code over a durable file-backed
 *                        ledger with a real wall-clock. This is the product
 *                        demo: data judges enter persists across restarts.
 *   LEDGER_BACKEND=fabric — connects to the peer using the enrollment material.
 */
export type BackendKind = 'demo' | 'live' | 'fabric';

export function backendKind(): BackendKind {
  const v = process.env.LEDGER_BACKEND;
  if (v === 'fabric') return 'fabric';
  if (v === 'live') return 'live';
  return 'demo';
}

/** Where the `live` backend persists ledger state (durable across restarts). */
export function dataFile(): string {
  return process.env.LEDGER_DATA_FILE ?? 'data/ledger.json';
}

export interface FabricConfig {
  channel: string;
  chaincode: string;
  mspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  certPath: string;
  keyPath: string;
}

export function fabricConfig(): FabricConfig {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing required env var ${k} for LEDGER_BACKEND=fabric`);
    return v;
  };
  return {
    channel: process.env.FABRIC_CHANNEL ?? 'provenance-channel',
    chaincode: process.env.FABRIC_CHAINCODE ?? 'ayurledger',
    mspId: process.env.FABRIC_MSP_ID ?? 'CollectorMSP',
    peerEndpoint: need('FABRIC_PEER_ENDPOINT'),
    peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS ?? 'peer0.collector.ayurtrace.local',
    tlsCertPath: need('FABRIC_TLS_CERT_PATH'),
    certPath: need('FABRIC_CERT_PATH'),
    keyPath: need('FABRIC_KEY_PATH'),
  };
}

export function port(): number {
  return Number(process.env.PORT ?? 3001);
}

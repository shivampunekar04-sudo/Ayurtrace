/**
 * Single source of truth for Complete-B's runtime configuration.
 *
 * INDEPENDENCE BOUNDARY: every Complete-B component reaches the ledger only through
 * this one base URL. During development it points at the bundled mock gateway
 * (CompleteB/mock-gateway/mock-gateway.mjs on :3001). Switching to a live, contract-
 * compatible gateway — or to a ledger Complete-B stands up itself — is a one-line
 * change here, with no code dependency on Complete-A.
 */
export interface AyurTraceConfig {
  /** Base URL of a contract-compatible §6.4 gateway. */
  apiBaseUrl: string;
}

export const CONFIG: AyurTraceConfig = {
  apiBaseUrl: process.env.AYURTRACE_API_BASE_URL ?? 'http://localhost:3001',
};

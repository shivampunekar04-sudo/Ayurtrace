/**
 * AyurTrace Complete-B — public surface.
 *
 * Every export here is built strictly against the frozen `contracts/` and reaches a ledger
 * only through `CONFIG.apiBaseUrl`. See STATUS.md for per-component honesty tags.
 */
export { CONFIG, type AyurTraceConfig } from './config/config.js';

// Integration layer — unified §6.4 client + submission wiring
export * from './client/api-client.js';
export * from './client/submit.js';

// Persistence adapters (file-backed implementations of the store interfaces)
export * from './persistence/json-file.js';
export * from './persistence/file-stores.js';

// Governed policy numbers (single place for NMPB/AYUSH sign-off)
export * from './policy/policy.js';

// 6. Live CP-5 / CP-6 enforcement 🟢
export * from './enforcement/reference-limits.js';
export * from './enforcement/cp5.js';
export * from './enforcement/cp6.js';

// 8. Full PoLK 🟢 (SMS fan-out 🟡) + session orchestrator
export * from './polk/polk.js';
export * from './polk/session.js';

// 5. Analytics feedback loop 🟢
export * from './analytics/analytics.js';

// 4. 7-role RBAC 🟢 config/middleware (live enforcement 🔵)
export * from './rbac/roles.js';
export * from './rbac/rbac.js';

// 1. Tier-3 SMS gateway 🟢 logic (Twilio 🟡)
export * from './sms/parser.js';
export * from './sms/enrichment.js';
export * from './sms/gateway.js';
export * from './sms/twilio.js';

// 2. Tier-4 CFA biometrics + DPDP consent 🟢 (capture 🟡, on-chain revocation 🔵)
export * from './cfa/consent.js';
export * from './cfa/biometric.js';
export * from './cfa/intake.js';

// 3. RFC-3161 timestamping 🟢 logic (live TSA 🟡/🔵)
export * from './rfc3161/der.js';
export * from './rfc3161/rfc3161.js';
export * from './rfc3161/cms.js';
export * from './rfc3161/anchor-store.js';

// 7. IoT weighbridge + RFID 🟢 variance (MQTT 🟡, hardware 🔵)
export * from './weighbridge/variance.js';
export * from './weighbridge/broker.js';
export * from './weighbridge/weighbridge.js';

/**
 * DPDP Act 2023 consent state machine (component 2).
 *
 * HONESTY TAG: 🟢 BUILT — pure, unit-tested consent lifecycle. ⚠️ LEGAL WORKSTREAM: the
 * DPDP compliance model (notice, purpose limitation, retention, grievance, data-fiduciary
 * duties) is a legal review item, not just code — flagged for counsel, not "done".
 *
 * Model:
 *   - Consent is EXPLICIT and PURPOSE-LIMITED: a record binds (collector, cfa, purpose).
 *   - It is REVOCABLE: withdraw() blocks all future TIER4 writes by that CFA for that
 *     collector under that purpose.
 *   - RIGHT TO ERASURE: erase() clears the biometric hash + salt and marks the record
 *     ERASED (also a terminal block).
 *
 * Lifecycle:  (none) --grant--> GRANTED --withdraw--> WITHDRAWN --erase--> ERASED
 *                                   \-------------------erase-------------------^
 */
export type ConsentStatus = 'GRANTED' | 'WITHDRAWN' | 'ERASED';

export interface ConsentRecord {
  id: string;
  collectorId: string;
  cfaId: string;
  /** e.g. 'COLLECTION_LOGGING' — purpose limitation is mandatory under DPDP. */
  purpose: string;
  status: ConsentStatus;
  grantedAtMs: number;
  updatedAtMs: number;
  /** Salted biometric hash (never the raw template); cleared on erasure. */
  biometricHash?: string;
  biometricSalt?: string;
}

export interface GrantParams {
  id: string;
  collectorId: string;
  cfaId: string;
  purpose: string;
  atMs: number;
  biometricHash?: string;
  biometricSalt?: string;
}

const key = (collectorId: string, cfaId: string, purpose: string) =>
  `${collectorId}::${cfaId}::${purpose}`;

/** In-memory consent store. A durable, DPDP-compliant datastore replaces this in prod. */
export class ConsentStore {
  private readonly byKey = new Map<string, ConsentRecord>();
  /** Optional hook fired after every mutation (used by the file-backed adapter to persist). */
  private readonly onChange?: (records: ConsentRecord[]) => void;

  constructor(options: { onChange?: (records: ConsentRecord[]) => void } = {}) {
    if (options.onChange) this.onChange = options.onChange;
  }

  /** All records (for persistence snapshots). */
  snapshot(): ConsentRecord[] {
    return [...this.byKey.values()];
  }

  /** Replace all state from a snapshot (used when loading from disk). */
  restore(records: ConsentRecord[]): void {
    this.byKey.clear();
    for (const r of records) this.byKey.set(key(r.collectorId, r.cfaId, r.purpose), r);
  }

  private changed(): void {
    this.onChange?.(this.snapshot());
  }

  /** Record explicit, purpose-limited consent. Re-granting after withdrawal is allowed. */
  grant(params: GrantParams): ConsentRecord {
    const record: ConsentRecord = {
      id: params.id,
      collectorId: params.collectorId,
      cfaId: params.cfaId,
      purpose: params.purpose,
      status: 'GRANTED',
      grantedAtMs: params.atMs,
      updatedAtMs: params.atMs,
      ...(params.biometricHash ? { biometricHash: params.biometricHash } : {}),
      ...(params.biometricSalt ? { biometricSalt: params.biometricSalt } : {}),
    };
    this.byKey.set(key(params.collectorId, params.cfaId, params.purpose), record);
    this.changed();
    return record;
  }

  get(collectorId: string, cfaId: string, purpose: string): ConsentRecord | undefined {
    return this.byKey.get(key(collectorId, cfaId, purpose));
  }

  /** Withdraw consent — blocks future writes but retains the (now inactive) record. */
  withdraw(collectorId: string, cfaId: string, purpose: string, atMs: number): ConsentRecord | undefined {
    const rec = this.get(collectorId, cfaId, purpose);
    if (!rec || rec.status === 'ERASED') return rec;
    rec.status = 'WITHDRAWN';
    rec.updatedAtMs = atMs;
    this.changed();
    return rec;
  }

  /** Right to erasure — clear biometric material and mark ERASED (terminal). */
  erase(collectorId: string, cfaId: string, purpose: string, atMs: number): ConsentRecord | undefined {
    const rec = this.get(collectorId, cfaId, purpose);
    if (!rec) return undefined;
    rec.status = 'ERASED';
    rec.updatedAtMs = atMs;
    delete rec.biometricHash;
    delete rec.biometricSalt;
    this.changed();
    return rec;
  }

  /** True only when an active GRANTED consent exists for this exact purpose. */
  hasActiveConsent(collectorId: string, cfaId: string, purpose: string): boolean {
    return this.get(collectorId, cfaId, purpose)?.status === 'GRANTED';
  }
}

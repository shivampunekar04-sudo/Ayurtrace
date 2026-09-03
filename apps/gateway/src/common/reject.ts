import { RejectCode, REJECT_MESSAGES } from '@ayurtrace/contracts';

/** Gateway-side reject carrying a frozen §6.2 code. */
export class LedgerReject extends Error {
  constructor(
    public readonly code: RejectCode,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(REJECT_MESSAGES[code] ?? code);
    this.name = 'LedgerReject';
  }
}

/** Duck-typed: rejects from the demo backend and the gateway share `name` + `code`. */
export function isLedgerReject(e: unknown): e is { code: RejectCode; detail?: Record<string, unknown> } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: string }).name === 'LedgerReject' &&
    typeof (e as { code?: unknown }).code === 'string' &&
    (e as { code: string }).code in RejectCode
  );
}

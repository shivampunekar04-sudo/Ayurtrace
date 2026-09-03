/**
 * CP-3 weigh-variance logic for the IoT weighbridge (component 7).
 *
 * HONESTY TAG: 🟢 BUILT — pure, unit-tested. This turns a raw scale reading into the
 * frozen `ayurtrace:weigh` block (declared vs measured, ±tolerance) and reuses the frozen
 * `WEIGHT_VARIANCE_HOLD` code. It does NOT replace chaincode enforcement — the ledger stays
 * authoritative; this prepares the measuredKg input and mirrors the contract shape so the
 * field can flag a hold before submission.
 */
import { RejectCode } from '../../contracts/index.js';

export const DEFAULT_TOLERANCE_PCT = 10;

export interface WeighResult {
  declaredKg: number;
  measuredKg: number;
  variancePct: number;
  tolerancePct: number;
  result: 'PASSED' | 'WEIGHT_VARIANCE_HOLD';
}

/** Compute the weigh block. Variance is |measured − declared| / declared × 100. */
export function computeWeigh(
  declaredKg: number,
  measuredKg: number,
  tolerancePct: number = DEFAULT_TOLERANCE_PCT,
): WeighResult {
  if (!(declaredKg > 0)) {
    throw new Error('computeWeigh: declaredKg must be positive');
  }
  const variancePct = (Math.abs(measuredKg - declaredKg) / declaredKg) * 100;
  const result = variancePct <= tolerancePct ? 'PASSED' : 'WEIGHT_VARIANCE_HOLD';
  return { declaredKg, measuredKg, variancePct, tolerancePct, result };
}

/** The reject code a hold maps to (frozen). */
export const WEIGH_HOLD_CODE = RejectCode.WEIGHT_VARIANCE_HOLD;

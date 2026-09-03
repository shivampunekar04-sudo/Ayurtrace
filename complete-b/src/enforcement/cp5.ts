/**
 * CP-5 — Lab limits enforcement (moisture / heavy-metals / pesticide).
 *
 * HONESTY TAG: 🟢 BUILT. Pure, dependency-free enforcement function in the same
 * unit-tested style as the chaincode's mpr.ts. This is NEW enforcement Complete-B
 * adds (additive, not a re-implementation of MPR / mass-balance).
 *
 * Contract integration:
 *   - Input metrics use the frozen `QualityMetric` shape (epcis.ts).
 *   - A failure maps to the frozen `RejectCode.BATCH_STATUS_HOLD` and drives the
 *     batch to `GacpStatus.HOLD`; a pass leaves it `GacpStatus.ACTIVE`.
 *   - No contract fields are added or changed.
 *
 * Design rule: enforcement never trusts the client-supplied `withinLimit` flag on a
 * metric — it independently re-derives pass/fail from `value` vs the effective limit.
 */
import {
  Checkpoint,
  GacpStatus,
  RejectCode,
  type QualityMetric,
} from '../../contracts/index.js';
import {
  CP5_REQUIRED_METRICS,
  WHO_AYUSH_REFERENCE_LIMITS,
  type MetricName,
} from './reference-limits.js';

export type Cp5FailureReason =
  | 'OVER_LIMIT'
  | 'MISSING_REQUIRED_METRIC'
  | 'INVALID_VALUE';

export interface Cp5Failure {
  metric: MetricName;
  reason: Cp5FailureReason;
  value?: number;
  /** The limit actually enforced (stricter of contract limit and WHO/AYUSH reference). */
  effectiveLimit?: number;
  unit?: string;
}

/** A non-blocking advisory: the submitted limit was looser than the WHO/AYUSH reference. */
export interface Cp5LimitWarning {
  metric: MetricName;
  submittedLimit: number;
  referenceLimit: number;
}

export interface Cp5Result {
  checkpoint: Checkpoint.CP5_LAB_LIMITS;
  status: 'PASSED' | 'FAILED';
  /** ACTIVE on pass; HOLD on fail. */
  gacpStatus: GacpStatus;
  /** Present only on failure. */
  rejectCode?: RejectCode.BATCH_STATUS_HOLD;
  failures: Cp5Failure[];
  /** Advisories that did not by themselves fail the checkpoint. */
  warnings: Cp5LimitWarning[];
}

export interface Cp5Options {
  /**
   * Require the full CP5_REQUIRED_METRICS panel to be present. Default true — a
   * missing required metric holds the batch (can't clear what wasn't measured).
   */
  requireFullPanel?: boolean;
  /**
   * Cross-check each metric's contract limit against the WHO/AYUSH reference and
   * enforce the stricter of the two. Default true.
   */
  crossCheckReference?: boolean;
}

const isFiniteNonNegative = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * Evaluate CP-5 for a lab result.
 *
 * @param metrics measured `QualityMetric`s (frozen contract shape).
 * @returns a Cp5Result mapping to GacpStatus + BATCH_STATUS_HOLD on failure.
 */
export function evaluateCp5(
  metrics: QualityMetric[],
  options: Cp5Options = {},
): Cp5Result {
  const requireFullPanel = options.requireFullPanel ?? true;
  const crossCheckReference = options.crossCheckReference ?? true;

  const failures: Cp5Failure[] = [];
  const warnings: Cp5LimitWarning[] = [];

  const byName = new Map<MetricName, QualityMetric>();
  for (const m of metrics) byName.set(m.name, m);

  if (requireFullPanel) {
    for (const required of CP5_REQUIRED_METRICS) {
      if (!byName.has(required)) {
        failures.push({ metric: required, reason: 'MISSING_REQUIRED_METRIC' });
      }
    }
  }

  for (const metric of metrics) {
    const reference = WHO_AYUSH_REFERENCE_LIMITS[metric.name];

    if (!isFiniteNonNegative(metric.value) || !isFiniteNonNegative(metric.limit)) {
      failures.push({
        metric: metric.name,
        reason: 'INVALID_VALUE',
        ...(typeof metric.value === 'number' ? { value: metric.value } : {}),
      });
      continue;
    }

    // Effective limit = stricter of the contract limit and the WHO/AYUSH reference.
    let effectiveLimit = metric.limit;
    if (crossCheckReference && reference) {
      if (metric.limit > reference.max) {
        warnings.push({
          metric: metric.name,
          submittedLimit: metric.limit,
          referenceLimit: reference.max,
        });
        effectiveLimit = reference.max;
      }
    }

    if (metric.value > effectiveLimit) {
      failures.push({
        metric: metric.name,
        reason: 'OVER_LIMIT',
        value: metric.value,
        effectiveLimit,
        unit: metric.unit,
      });
    }
  }

  if (failures.length > 0) {
    return {
      checkpoint: Checkpoint.CP5_LAB_LIMITS,
      status: 'FAILED',
      gacpStatus: GacpStatus.HOLD,
      rejectCode: RejectCode.BATCH_STATUS_HOLD,
      failures,
      warnings,
    };
  }

  return {
    checkpoint: Checkpoint.CP5_LAB_LIMITS,
    status: 'PASSED',
    gacpStatus: GacpStatus.ACTIVE,
    failures: [],
    warnings,
  };
}

/**
 * CP-6 — DNA barcode species identity with risk-weighted sampling.
 *
 * HONESTY TAG: 🟢 BUILT. Pure, dependency-free enforcement + sampling logic, unit
 * tested. This is NEW enforcement Complete-B adds.
 *
 * Policy (solution §2C):
 *   - DNA barcoding (ITS2 + psbA-trnH) is NOT run on 100% of batches — that is cost-
 *     and time-prohibitive. It is run on a RISK-WEIGHTED SAMPLE:
 *       100% for endangered species, flagged lots, and export lots;
 *       a statistical baseline sample otherwise.
 *   - On a sampled batch: declared vs confirmed species must match. A mismatch fails
 *     the checkpoint, flags the batch, and holds it (BATCH_STATUS_HOLD → HOLD).
 *   - A required batch missing its barcode (or a required marker) is HELD, not passed.
 *   - A batch that is not sampled passes through as SKIPPED (checkpoint guarantee,
 *     not an achieved per-batch DNA claim) — but if a barcode is present anyway and
 *     mismatches, we never ignore a positive adulteration signal: it still fails.
 *
 * Contract integration: uses the frozen `dnaBarcode` marker vocabulary and maps
 * failures to `RejectCode.BATCH_STATUS_HOLD` / `GacpStatus.HOLD`. No fields added.
 */
import {
  Checkpoint,
  GacpStatus,
  RejectCode,
} from '../../contracts/index.js';
import { CP6_BASELINE_SAMPLING_RATIO } from '../policy/policy.js';

export type DnaMarker = 'ITS2' | 'psbA-trnH';

/** Both markers are required for a complete CP-6 confirmation (solution §2C). */
export const REQUIRED_DNA_MARKERS: readonly DnaMarker[] = ['ITS2', 'psbA-trnH'] as const;

export type ConservationStatus = 'ENDANGERED' | 'NORMAL';

export interface Cp6LotFlags {
  /** Lot is destined for export (EU/US FDA-grade proof required). */
  export?: boolean;
  /** Lot was flagged upstream (PoLK dispute, over-draw, anomaly, etc.). */
  flagged?: boolean;
}

export interface Cp6DnaResult {
  markers: DnaMarker[];
  confirmedSpecies: string;
}

export interface Cp6Input {
  /** Batch EPC — also the deterministic seed for statistical sampling. */
  epc: string;
  declaredSpecies: string;
  conservationStatus: ConservationStatus;
  lotFlags?: Cp6LotFlags;
  /** The lab's barcode result, when one was produced. */
  dna?: Cp6DnaResult;
}

export interface Cp6SamplingPolicy {
  /**
   * Baseline statistical sampling ratio (0..1) for non-endangered, non-flagged,
   * non-export lots. [ASSUMPTION] needs an NMPB-backed policy number.
   */
  baselineSamplingRatio: number;
}

export const DEFAULT_CP6_POLICY: Cp6SamplingPolicy = {
  baselineSamplingRatio: CP6_BASELINE_SAMPLING_RATIO.value,
};

export type Cp6SamplingReason =
  | 'ENDANGERED'
  | 'FLAGGED'
  | 'EXPORT'
  | 'STATISTICAL_SAMPLE'
  | 'NOT_SAMPLED';

export interface Cp6Sampling {
  required: boolean;
  reason: Cp6SamplingReason;
  /** Effective ratio applied for this decision (1.0 for mandatory categories). */
  ratioApplied: number;
}

export type Cp6FailureReason =
  | 'DNA_MISMATCH'
  | 'MISSING_BARCODE'
  | 'INCOMPLETE_MARKERS';

export interface Cp6Result {
  checkpoint: Checkpoint.CP6_DNA_IDENTITY;
  /** PASSED (match) | FAILED (mismatch/missing) | SKIPPED (not sampled). */
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  gacpStatus: GacpStatus;
  rejectCode?: RejectCode.BATCH_STATUS_HOLD;
  sampling: Cp6Sampling;
  /** Present when a barcode was evaluated. */
  match?: boolean;
  failureReason?: Cp6FailureReason;
  /** e.g. 'DNA_MISMATCH' — surfaced onto the batch's flags[]. */
  flags: string[];
}

/**
 * Deterministic, uniform hash of the EPC into [0, 1). Lets "statistical sample"
 * decisions be reproducible in tests and stable across re-evaluation of the same
 * batch (the same lot is never re-rolled in or out of the sample).
 */
export function sampleFraction(epc: string): number {
  // FNV-1a 32-bit — small, dependency-free, well-distributed.
  let h = 0x811c9dc5;
  for (let i = 0; i < epc.length; i++) {
    h ^= epc.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 to unsigned, then normalise to [0,1).
  return (h >>> 0) / 0x100000000;
}

/** Decide whether CP-6 must run for this lot, and why. */
export function decideSampling(
  input: Cp6Input,
  policy: Cp6SamplingPolicy = DEFAULT_CP6_POLICY,
): Cp6Sampling {
  if (input.conservationStatus === 'ENDANGERED') {
    return { required: true, reason: 'ENDANGERED', ratioApplied: 1 };
  }
  if (input.lotFlags?.flagged) {
    return { required: true, reason: 'FLAGGED', ratioApplied: 1 };
  }
  if (input.lotFlags?.export) {
    return { required: true, reason: 'EXPORT', ratioApplied: 1 };
  }
  const ratio = policy.baselineSamplingRatio;
  if (sampleFraction(input.epc) < ratio) {
    return { required: true, reason: 'STATISTICAL_SAMPLE', ratioApplied: ratio };
  }
  return { required: false, reason: 'NOT_SAMPLED', ratioApplied: ratio };
}

function hasCompleteMarkers(markers: DnaMarker[]): boolean {
  return REQUIRED_DNA_MARKERS.every((m) => markers.includes(m));
}

function speciesMatch(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

const held = (
  sampling: Cp6Sampling,
  failureReason: Cp6FailureReason,
  flags: string[],
  match?: boolean,
): Cp6Result => ({
  checkpoint: Checkpoint.CP6_DNA_IDENTITY,
  status: 'FAILED',
  gacpStatus: GacpStatus.HOLD,
  rejectCode: RejectCode.BATCH_STATUS_HOLD,
  sampling,
  ...(match !== undefined ? { match } : {}),
  failureReason,
  flags,
});

/**
 * Evaluate CP-6 for a lot.
 *
 * @returns a Cp6Result; FAILED maps to BATCH_STATUS_HOLD + GacpStatus.HOLD.
 */
export function evaluateCp6(
  input: Cp6Input,
  policy: Cp6SamplingPolicy = DEFAULT_CP6_POLICY,
): Cp6Result {
  const sampling = decideSampling(input, policy);

  // Never ignore a positive adulteration signal, sampled or not.
  if (input.dna) {
    if (!hasCompleteMarkers(input.dna.markers)) {
      // Incomplete markers only hold when CP-6 was actually required.
      if (sampling.required) {
        return held(sampling, 'INCOMPLETE_MARKERS', []);
      }
    } else {
      const match = speciesMatch(input.declaredSpecies, input.dna.confirmedSpecies);
      if (!match) {
        return held(sampling, 'DNA_MISMATCH', ['DNA_MISMATCH'], false);
      }
      // A genuine, complete, matching barcode passes regardless of sampling.
      return {
        checkpoint: Checkpoint.CP6_DNA_IDENTITY,
        status: 'PASSED',
        gacpStatus: GacpStatus.ACTIVE,
        sampling,
        match: true,
        flags: [],
      };
    }
  }

  // No usable barcode present.
  if (sampling.required) {
    return held(sampling, 'MISSING_BARCODE', []);
  }

  // Not sampled and no barcode → passes through as SKIPPED (checkpoint guarantee).
  return {
    checkpoint: Checkpoint.CP6_DNA_IDENTITY,
    status: 'SKIPPED',
    gacpStatus: GacpStatus.ACTIVE,
    sampling,
    flags: [],
  };
}

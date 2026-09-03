/**
 * Submission wiring — turns the requests that CFA intake and the weighbridge PRODUCE into
 * actual gateway calls through the unified client (component 2 + 7 operational layer).
 *
 * HONESTY TAG: 🟢 BUILT — thin, tested glue mirroring how the SMS gateway already submits.
 * The underlying transport is the same `AyurTraceClient` (mock or live via one env var).
 */
import type { ApiResult, CollectionResponse } from '../../contracts/index.js';
import type { AyurTraceClient } from './api-client.js';
import type { CfaIntakeResult } from '../cfa/intake.js';
import type { AggregationBuildResult } from '../weighbridge/weighbridge.js';

export type CfaSubmitResult =
  | { submitted: true; result: ApiResult<CollectionResponse>; endorsers: string[] }
  | { submitted: false; reason: string };

/** Submit a Tier-4 CFA collection if the intake gate passed; otherwise report why not. */
export async function submitCfaIntake(client: AyurTraceClient, intake: CfaIntakeResult): Promise<CfaSubmitResult> {
  if (!intake.ok) return { submitted: false, reason: intake.reason };
  const result = await client.collection(intake.request);
  return { submitted: true, result, endorsers: intake.attribution.endorsers };
}

export interface WeighSubmitResult {
  result: ApiResult<Record<string, unknown>>;
  /** locally-computed weigh block + flags carried from the sensor reading. */
  weigh: AggregationBuildResult['weigh'];
  flags: string[];
}

/** Submit a weighbridge-built aggregation through the gateway, carrying the local flags. */
export async function submitWeighAggregation(
  client: AyurTraceClient,
  built: AggregationBuildResult,
): Promise<WeighSubmitResult> {
  const result = await client.aggregation(built.request);
  return { result, weigh: built.weigh, flags: built.flags };
}

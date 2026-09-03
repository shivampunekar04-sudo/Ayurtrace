/**
 * Unified §6.4 API client (integration layer).
 *
 * HONESTY TAG: 🟢 BUILT — a single typed client every Complete-B component can use to reach
 * a contract-compatible gateway, built on the frozen `ENDPOINTS` map and DTOs. Injectable
 * `fetchImpl` makes it unit-testable; it runs live against the mock gateway or any real
 * gateway with only `AYURTRACE_API_BASE_URL` changed.
 *
 * This is the concrete realisation of "point B at a real gateway by URL" — one base URL,
 * no Complete-A source, no contract change.
 */
import {
  ENDPOINTS,
  type AggregationRequest,
  type ApiResult,
  type BatchTimelineResponse,
  type CollectionRequest,
  type CollectionResponse,
  type FormulationRequest,
  type FormulationResponse,
  type QrVerifyResponse,
  type QualityTestRequest,
  type RecallResponse,
  type TransformationRequest,
  type TransformationResponse,
  type ZoneQuotaResponse,
  type ZonesResponse,
} from '../../contracts/index.js';
import { CONFIG } from '../config/config.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface AyurTraceClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class AyurTraceClient {
  readonly baseUrl: string;
  private readonly doFetch: FetchLike;

  constructor(options: AyurTraceClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? CONFIG.apiBaseUrl).replace(/\/$/, '');
    this.doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiResult<T>;
  }

  private async get<T>(path: string): Promise<ApiResult<T>> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, { method: 'GET' });
    return (await res.json()) as ApiResult<T>;
  }

  // ---- writes ----
  collection(req: CollectionRequest): Promise<ApiResult<CollectionResponse>> {
    return this.post(ENDPOINTS.collection, req);
  }
  aggregation(req: AggregationRequest): Promise<ApiResult<Record<string, unknown>>> {
    return this.post(ENDPOINTS.aggregation, req);
  }
  transformation(req: TransformationRequest): Promise<ApiResult<TransformationResponse>> {
    return this.post(ENDPOINTS.transformation, req);
  }
  qualityTest(req: QualityTestRequest): Promise<ApiResult<Record<string, unknown>>> {
    return this.post(ENDPOINTS.qualityTest, req);
  }
  formulation(req: FormulationRequest): Promise<ApiResult<FormulationResponse>> {
    return this.post(ENDPOINTS.formulation, req);
  }

  // ---- reads ----
  batch(epc: string): Promise<ApiResult<BatchTimelineResponse>> {
    return this.get(ENDPOINTS.batch(epc));
  }
  zones(): Promise<ApiResult<ZonesResponse>> {
    return this.get(ENDPOINTS.zones);
  }
  zoneQuota(zoneId: string): Promise<ApiResult<ZoneQuotaResponse>> {
    return this.get(ENDPOINTS.zoneQuota(zoneId));
  }
  recall(epc: string): Promise<ApiResult<RecallResponse>> {
    return this.post(ENDPOINTS.recall(epc), {});
  }
  qrVerify(serial: string): Promise<ApiResult<QrVerifyResponse>> {
    return this.get(ENDPOINTS.qrVerify(serial));
  }

  /** Liveness check — true if the gateway answers. Never throws. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.doFetch(`${this.baseUrl}/health`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Adapter so the SMS gateway (or anything expecting a `CollectionSubmitter`) can submit
 * through the unified client instead of its own fetch glue.
 */
export function collectionSubmitterFrom(client: AyurTraceClient): {
  submit(req: CollectionRequest): Promise<ApiResult<CollectionResponse>>;
} {
  return { submit: (req) => client.collection(req) };
}

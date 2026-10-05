import { env } from "../config/env";
import { ApiError } from "../lib/errors";

/**
 * Thin server-side client for DataFast's analytics REST API
 * (https://datafa.st/docs/api-introduction). Kept out of the frontend
 * entirely — the `df_` website API key must stay secret, so the frontend
 * only ever talks to our own /api/admin/stats route, which calls this.
 */
const DATAFAST_BASE_URL = "https://datafa.st/api/v1";

export interface DatafastOverview {
  visitors: number;
  pageviews: number;
  sessions: number;
  revenue: number;
  payments: number;
}

export interface DatafastTimeseriesPoint {
  date: string;
  visitors: number;
  pageviews: number;
  sessions: number;
  revenue: number;
  payments: number;
}

export interface DatafastStats {
  overview: DatafastOverview;
  timeseries: DatafastTimeseriesPoint[];
  range: { startAt: string; endAt: string };
}

function requireApiKey(): string {
  if (!env.DATAFAST_API_KEY) {
    throw new Error(
      "DATAFAST_API_KEY is not configured. Generate a website-scoped API key " +
        "at https://datafa.st (Settings -> API keys) and set it in the backend env.",
    );
  }
  return env.DATAFAST_API_KEY;
}

async function call<T>(path: string): Promise<T> {
  const apiKey = requireApiKey();
  const response = await fetch(`${DATAFAST_BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new ApiError(
      "DATAFAST_REQUEST_FAILED",
      `DataFast API request failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}

/**
 * Live visitor count (active in the last 10 minutes), for the small
 * "N online" badge in the site nav. Unlike every other endpoint here,
 * DataFast wraps /analytics/realtime's payload in an array — `data: [{...}]`
 * rather than `data: {...}` — so this bypasses the generic `call<T>()`
 * helper instead of fighting its shape assumption.
 */
async function getRealtimeVisitors(): Promise<number> {
  const apiKey = requireApiKey();
  const response = await fetch(`${DATAFAST_BASE_URL}/analytics/realtime`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new ApiError(
      "DATAFAST_REQUEST_FAILED",
      `DataFast API request failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { data: Array<{ visitors: number }> };
  return body.data[0]?.visitors ?? 0;
}

/**
 * All-time total visitor count, for the "· N visitors" half of the nav
 * badge. No startAt/endAt is passed — omitting the range gives DataFast's
 * all-time total, which is what the badge wants (a running site-wide
 * counter, not a windowed one). `fields=visitors` keeps the response to
 * just the number we need.
 */
async function getTotalVisitors(): Promise<number> {
  const apiKey = requireApiKey();
  const response = await fetch(`${DATAFAST_BASE_URL}/analytics/overview?fields=visitors`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new ApiError(
      "DATAFAST_REQUEST_FAILED",
      `DataFast API request failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { data: Array<{ visitors: number }> };
  return body.data[0]?.visitors ?? 0;
}

/**
 * Combined payload for the public "N online · M visitors" nav badge.
 * Fetched in parallel since the two numbers come from separate endpoints.
 */
export async function getLiveVisitorStats(): Promise<{ online: number; visitors: number }> {
  const [online, visitors] = await Promise.all([getRealtimeVisitors(), getTotalVisitors()]);
  return { online, visitors };
}

/**
 * Fetches an overview + daily timeseries for the given date range in one
 * shot, which is all the admin stats page needs. Dates are `YYYY-MM-DD`.
 */
export async function getDatafastStats(startAt: string, endAt: string): Promise<DatafastStats> {
  const fields = "visitors,pageviews,sessions,revenue,payments";

  const [overview, timeseriesResult] = await Promise.all([
    call<DatafastOverview>(`/analytics/overview?startAt=${startAt}&endAt=${endAt}`),
    call<{ timeseries: DatafastTimeseriesPoint[] } | DatafastTimeseriesPoint[]>(
      `/analytics/timeseries?fields=${fields}&interval=day&startAt=${startAt}&endAt=${endAt}`,
    ),
  ]);

  // DataFast wraps the array under `timeseries` on some API versions and
  // returns it bare on others — normalize either shape defensively rather
  // than assume one, since a shape change here would otherwise throw deep
  // inside the render instead of at the boundary.
  const timeseries = Array.isArray(timeseriesResult)
    ? timeseriesResult
    : (timeseriesResult.timeseries ?? []);

  return { overview, timeseries, range: { startAt, endAt } };
}

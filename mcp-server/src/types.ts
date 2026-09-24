/** API response envelope. */
export interface APIResponse<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

/** Paginated API response. */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  has_prev: boolean;
  comparison?: Record<string, unknown> | null;
  totals?: Record<string, unknown> | null;
  timestamp: string;
}

/** Site info returned by GET /sites. */
export interface SiteInfo {
  id: string;
  name: string;
  domains: string[];
  timezone: string;
  currency: string;
  is_active: boolean;
  created_at: string;
}

export interface SiteListResponse {
  sites: SiteInfo[];
  total: number;
}

/** Date range in overview response. */
export interface DateRange {
  start_date: string;
  end_date: string;
  days: number;
}

/** Traffic metrics. */
export interface TrafficMetrics {
  entrances: number;
  engaged_entrances: number;
  page_views: number;
  microconversions: number;
  conversions: number;
  revenue: string;
  bounce_rate: number;
  pages_per_session: number;
}

/** Conversion metrics. */
export interface ConversionMetrics {
  conversions: number;
  revenue: string;
  microconversions: number;
  conversion_rate: number;
  average_order_value: string;
}

/** Time series point. */
export interface TimeSeriesPoint {
  date: string;
  hour?: number | null;
  day_of_week?: number | null;
  value: number;
}

/** Time series data. */
export interface TimeSeries {
  metric: string;
  points: TimeSeriesPoint[];
  total: number;
  average: number;
}

/** Overview response. */
export interface StatsOverview {
  date_range: DateRange;
  traffic: TrafficMetrics;
  conversions: ConversionMetrics;
  traffic_change?: TrafficMetrics | null;
  conversions_change?: ConversionMetrics | null;
  entrances_series?: TimeSeries;
  engaged_entrances_series?: TimeSeries;
  page_views_series?: TimeSeries;
  conversions_series?: TimeSeries;
  microconversions_series?: TimeSeries;
  revenue_series?: TimeSeries;
}

/** Devices breakdown response. */
export interface DevicesBreakdown {
  by_device: DeviceMetric[];
  by_browser: DeviceMetric[];
  by_os: DeviceMetric[];
}

export interface DeviceMetric {
  name: string;
  entrances: number;
  engaged_entrances: number;
  page_views: number;
  conversions: number;
  revenue: string;
  bounce_rate: number;
}

/** Funnel response. */
export interface FunnelStep {
  name: string;
  count: number;
  rate: number;
  dropoff: number;
}

export interface FunnelReport {
  steps: FunnelStep[];
  total_entrances: number;
  overall_conversion_rate: number;
}

/** Valid period values. */
export const VALID_PERIODS = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "90d",
  "12m",
  "this_week",
  "wtd",
  "last_week",
  "this_month",
  "mtd",
  "last_month",
  "this_quarter",
  "qtd",
  "last_quarter",
  "this_year",
  "ytd",
  "last_year",
] as const;

export type Period = (typeof VALID_PERIODS)[number];

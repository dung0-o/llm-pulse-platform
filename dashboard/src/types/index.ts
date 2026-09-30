export interface LeaderboardItem {
  brand: string;
  model: string;
  post_count: number;
  sum_score: number;
  weighted_score: number;
}

export interface PostCountItem {
  brand: string;
  model: string;
  post_count: number;
  percentage: number;
}

export interface LeaderboardResponse {
  allowed_brands: string[] | null;
  days_analysed: number;
  group_by_brand: boolean;
  ranking: LeaderboardItem[];
}

export interface PostCountResponse {
  allowed_brands: string[] | null;
  days_analysed: number;
  group_by_brand: boolean;
  ranking: PostCountItem[];
}

export interface TrendPoint {
  date: string; // ISO date
  avg_sentiment: number;
  post_count: number;
}

export interface TrendResponse {
  model: string;
  days_analysed: number;
  trend: TrendPoint[];
}

export interface AspectSentimentPair {
  model: string;
  sentiment_label: string | null;
}

export interface SearchResult {
  post_id: string;
  title: string;
  url: string;
  published_at: string;
  aspect_sentiment_pairs: AspectSentimentPair[];
}

export interface SearchResponse {
  keyword: string;
  limit: number;
  number_of_posts: number;
  posts: SearchResult[];
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  bigquery: 'connected' | 'disconnected' | 'error';
  redis: 'connected' | 'disconnected' | 'error';
  model: 'ready' | 'loading' | 'error';
}

export type SentimentLabel = 'Positive' | 'Negative' | 'Neutral';

export interface LeaderboardFilters {
  allowedBrands: string[];
  days: number;
  groupByBrand: boolean;
}

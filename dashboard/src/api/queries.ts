import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  HealthResponse,
  LeaderboardFilters,
  LeaderboardResponse,
  PostCountResponse,
  SearchResponse,
  TrendResponse,
} from '@/types';

export interface QueryDescriptor<T> {
  key: readonly unknown[];
  path: string;
  enabled?: boolean;
  refetchInterval?: number;
  readonly __response?: T;
}

function buildLeaderboardParams(f: LeaderboardFilters): string {
  const params = new URLSearchParams();
  f.allowedBrands.forEach((brand) =>
    params.append('allowed_brands', encodeURIComponent(brand)),
  );
  params.set('days', String(f.days));
  params.set('group_by_brand', String(f.groupByBrand));
  return params.toString();
}

export const queries = {
  leaderboard: (f: LeaderboardFilters): QueryDescriptor<LeaderboardResponse> => ({
    key: ['leaderboard', f.allowedBrands, f.days, f.groupByBrand] as const,
    path: `/leaderboard?${buildLeaderboardParams(f)}`,
  }),

  postCount: (f: LeaderboardFilters): QueryDescriptor<PostCountResponse> => ({
    key: ['post-count', f.allowedBrands, f.days, f.groupByBrand] as const,
    path: `/post-count?${buildLeaderboardParams(f)}`,
  }),

  trend: (
    model: string,
    days: number,
    enabled = true,
  ): QueryDescriptor<TrendResponse> => ({
    key: ['trend', model, days] as const,
    path: `/trend?model=${encodeURIComponent(model)}&days=${days}`,
    enabled: enabled && model.length > 0,
  }),

  search: (
    keyword: string,
    limit: number,
    enabled = true,
  ): QueryDescriptor<SearchResponse> => ({
    key: ['search', keyword, limit] as const,
    path: `/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`,
    enabled: enabled && keyword.trim().length > 0,
  }),

  health: (): QueryDescriptor<HealthResponse> => ({
    key: ['health'] as const,
    path: '/health',
    refetchInterval: 1800_000,
  }),
};

export function useQueryWrapper<T>(descriptor: QueryDescriptor<T>) {
  return useQuery({
    queryKey: descriptor.key,
    queryFn: () => api.get<T>(descriptor.path),
    enabled: descriptor.enabled ?? true,
    refetchInterval: descriptor.refetchInterval,
  });
}

type RefreshInput = Pick<QueryDescriptor<unknown>, 'key' | 'path'>;

export function useRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, path }: RefreshInput) => {
      const separator = path.includes('?') ? '&' : '?';
      const data = await api.get<unknown>(`${path}${separator}refresh=true`);
      qc.setQueryData(key, data);
      return data;
    },
  });
}

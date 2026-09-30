import { useState } from 'react';
import { queries, useQueryWrapper, useRefresh } from '@/api/queries';
import { Card } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { FilterCard } from '@/features/leaderboard/FilterCard';
import { LeaderboardTable } from '@/features/leaderboard/LeaderboardTable';
import type { LeaderboardFilters } from '@/types';

type SentimentLabel = 'Positive' | 'Negative' | 'Neutral';
type Tone = 'default' | 'positive' | 'negative';

export default function DashboardPage() {
  const [filters, setFilters] = useState<LeaderboardFilters>({
    allowedBrands: [],
    days: 7,
    groupByBrand: false,
  });

  const leaderboard = queries.leaderboard(filters);
  const { data, isLoading, error } = useQueryWrapper(leaderboard);
  const refresh = useRefresh();

  const ranking = data?.ranking ?? [];
  const topModel = ranking[0];
  const totalMentions = ranking.reduce((sum, r) => sum + r.post_count, 0);

  const overallScore =
    ranking.length === 0
      ? 0
      : ranking.reduce((sum, r) => sum + r.sum_score, 0) / totalMentions;

  const overallSentiment: SentimentLabel =
    overallScore > 0.15 ? 'Positive' :
    overallScore < -0.15 ? 'Negative' : 'Neutral';

  const overallTone: Tone =
    overallSentiment === 'Positive' ? 'positive' :
    overallSentiment === 'Negative' ? 'negative' : 'default';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <Metric
            label="Top model"
            value={topModel?.model ?? '—'}
            hint={topModel ? `Score ${topModel.weighted_score.toFixed(2)}` : undefined}
          />
        </Card>
        <Card>
          <Metric
            label="Total mentions"
            value={totalMentions.toLocaleString()}
            hint={`Last ${filters.days} days`}
          />
        </Card>
        <Card>
          <Metric
            label="Overall sentiment"
            value={overallSentiment}
            tone={overallTone}
            hint={`Average score ${overallScore.toFixed(2)}`}
          />
        </Card>
      </div>

      <FilterCard
        allowedBrands={filters.allowedBrands}
        days={filters.days}
        groupByBrand={filters.groupByBrand}
        onSelectBrand={(allowedBrands) => setFilters((f) => ({ ...f, allowedBrands }))}
        onSelectDays={(days) => setFilters((f) => ({ ...f, days }))}
        onToggle={(groupByBrand) => setFilters((f) => ({ ...f, groupByBrand }))}
      />

      <Card
        title="Leaderboard"
        action={
          <RefreshButton
            onClick={() => refresh.mutate(leaderboard)}
            isRefreshing={refresh.isPending}
          />
        }
      >
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} />}
        {data && ranking.length === 0 && (
          <EmptyState
            title="No models match your filters"
            description="Try widening the date range or clearing the brand filter."
          />
        )}
        {data && ranking.length > 0 && (
          <LeaderboardTable items={ranking} groupByBrand={filters.groupByBrand} />
        )}
      </Card>
    </div>
  );
}

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { queries, useQueryWrapper, useRefresh } from '@/api/queries';
import { Card } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { FilterCard } from '@/features/leaderboard/FilterCard';
import { buildColorMap } from '@/features/share-of-voice/colors';
import { formatNumber } from '@/lib/utils';
import type { LeaderboardFilters } from '@/types';

export default function ShareOfVoicePage() {
  const [filters, setFilters] = useState<LeaderboardFilters>({
    allowedBrands: [],
    days: 7,
    groupByBrand: false,
  });

  const postCount = queries.postCount(filters);
  const { data, isLoading, error } = useQueryWrapper(postCount);
  const refresh = useRefresh();

  const ranking = data?.ranking ?? [];
  const totalMentions = ranking.reduce(
    (sum, r) => sum + r.post_count,
    0,
  );
  const topModel = ranking[0];

  const colors = buildColorMap(
    ranking.map((r) => ({ brand: r.brand })),
    filters.groupByBrand,
  );

  const chartData = ranking.map((r, i) => ({
    model: r.model,
    mentions: r.post_count,
    share: r.percentage,
    fill: colors[i],
  }));

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <Metric
            label="Leading model"
            value={topModel?.model ?? '—'}
            hint={
              topModel && totalMentions > 0
                ? `${topModel.percentage.toFixed(1)}% of voice`
                : undefined
            }
          />
        </Card>
        <Card>
          <Metric
            label="Total mentions"
            value={formatNumber(totalMentions)}
            hint={`Last ${filters.days} days`}
          />
        </Card>
        <Card>
          <Metric
            label={`${filters.groupByBrand ? 'Brands' : 'Families'} tracked`}
            value={ranking.length}
            hint="With at least one mention"
          />
        </Card>
      </div>

      {/* Filters */}
      <FilterCard
        allowedBrands={filters.allowedBrands}
        days={filters.days}
        groupByBrand={filters.groupByBrand}
        onSelectBrand={(allowedBrands) => setFilters((f) => ({ ...f, allowedBrands }))}
        onSelectDays={(days) => setFilters((f) => ({ ...f, days: days }))}
        onToggle={(groupByBrand) => setFilters((f) => ({ ...f, groupByBrand: groupByBrand }))}
      />

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Distribution">
            <Skeleton className="h-72 w-full" />
          </Card>
          <Card title="Mention count">
            <Skeleton className="h-72 w-full" />
          </Card>
        </div>
      )}

      {error && <ErrorState error={error} />}

      {data && ranking.length === 0 && (
        <Card title="Share of voice">
          <EmptyState
            title="No mentions in this window"
            description="Try widening the time range."
          />
        </Card>
      )}

      {data && ranking.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Pie chart: share of total mentions */}
          <Card
            title="Share of voice"
            action={
              <RefreshButton
                onClick={() => refresh.mutate(postCount)}
                isRefreshing={refresh.isPending}
              />
            }
          >
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="mentions"
                    nameKey="model"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={100}
                    paddingAngle={2}
                    label={({ model, share }) =>
                      share > 5 ? `${model} (${(share as number).toFixed(0)}%)` : ''
                    }
                    labelLine={false}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.model} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #E5E7EB',
                      fontSize: 12,
                      color: 'black',
                    }}
                    formatter={(value: number, name, item) => {
                      const share = (item?.payload as { share?: number })?.share ?? 0;
                      return [`${value} mentions (${share.toFixed(1)}%)`, name];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Horizontal bar chart: raw mention counts */}
          <Card
            title="Mention count"
            action={
              <RefreshButton
                onClick={() => refresh.mutate(postCount)}
                isRefreshing={refresh.isPending}
              />
            }
          >
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 8, right: 24, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="model"
                    width={88}
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #E5E7EB',
                      fontSize: 12,
                      color: 'black',
                    }}
                    formatter={(value: number) => [`${value} mentions`, 'Count']}
                  />
                  <Bar dataKey="mentions" radius={[0, 3, 3, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.model} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* Tabular breakdown */}
      {data && ranking.length > 0 && (
        <Card title="Breakdown">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Mentions</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((row) => (
                  <tr
                    key={row.model}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: row.fill }}
                        />
                        <span className="font-medium">{row.model}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatNumber(row.mentions)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {row.share.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

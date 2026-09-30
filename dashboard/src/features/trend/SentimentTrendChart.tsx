import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPoint } from '@/types';
import { formatDate } from '@/lib/utils';

export function SentimentTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No trend data available for this model.
      </p>
    );
  }

  const formatted = data.map((p) => ({ ...p, label: formatDate(p.date) }));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={formatted}
          margin={{ top: 8, right: 16, bottom: 0, left: -8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#6B7280' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="sentiment"
            domain={[-1, 1]}
            ticks={[-1, -0.5, 0, 0.5, 1]}
            tick={{ fontSize: 11, fill: '#6B7280' }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <YAxis
            yAxisId="volume"
            orientation="right"
            tick={false}
            tickLine={false}
            axisLine={false}
            width={16}
          />
          <ReferenceLine
            yAxisId="sentiment"
            y={0}
            stroke="#9CA3AF"
            strokeDasharray="2 2"
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: '1px solid #E5E7EB',
              fontSize: 12,
              color: 'black',
            }}
          />
          <Bar
            yAxisId="volume"
            dataKey="post_count"
            fill="#a7b2de"
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
          />
          <Line
            yAxisId="sentiment"
            type="monotone"
            dataKey="avg_sentiment"
            stroke="hsl(var(--accent))"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

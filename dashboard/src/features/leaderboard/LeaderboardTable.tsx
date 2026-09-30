import { Link } from 'react-router-dom';
import type { LeaderboardItem } from '@/types';
import { cn, formatNumber, scoreColor } from '@/lib/utils';

interface Props {
  items: LeaderboardItem[];
  groupByBrand: boolean;
}

export function LeaderboardTable({ items, groupByBrand }: Props) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No models match the current filters.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">#</th>
            {!groupByBrand && (
              <th className="px-3 py-2 font-medium">Family</th>
            )}
            <th className="px-3 py-2 font-medium">Brand</th>
            <th className="px-3 py-2 text-right font-medium">Score</th>
            <th className="px-3 py-2 text-right font-medium">Mentions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={`${item.model}`}
              className="border-b border-border last:border-0 hover:bg-[hsl(var(--muted))]/50"
            >
              <td className="px-3 py-2 text-muted-foreground">
                {idx + 1}
              </td>
              <td className="px-3 py-2 font-medium">
                <Link
                  to={`/trend?model=${encodeURIComponent(item.model)}`}
                  className="text-accent hover:underline"
                >
                  {item.model}
                </Link>
              </td>
              {!groupByBrand && (
                <td className="px-3 py-2 text-muted-foreground">
                  {item.brand}
                </td>
              )}
              <td
                className={cn(
                  'px-3 py-2 text-right font-mono font-semibold',
                  scoreColor(item.weighted_score),
                )}
              >
                {item.weighted_score.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatNumber(item.post_count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

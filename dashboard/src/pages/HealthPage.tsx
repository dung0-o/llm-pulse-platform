import { queries, useQueryWrapper } from '@/api/queries';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn, formatRelativeDate } from '@/lib/utils';

function StatusRow({ label, status }: { label: string; status: string }) {
  const tone =
    status === 'connected' || status === 'ready'
      ? 'text-positive'
      : status === 'error'
        ? 'text-negative'
        : 'text-[hsl(var(--muted-foreground))]';

  return (
    <div className="flex items-center justify-between border-b border-[hsl(var(--border))] py-3 last:border-0">
      <span className="text-sm font-medium">{label}</span>
      <span className={cn('text-sm font-mono', tone)}>{status}</span>
    </div>
  );
}

export default function HealthPage() {
  const { data, isLoading, error, refetch } = useQueryWrapper(queries.health());

  return (
    <div className="space-y-6">
      <Card
        title="System health"
        action={
          <RefreshButton
            onClick={refetch}
            isRefreshing={isLoading}
          />
        }
      >
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {error && <ErrorState error={error} />}
        {data && (
          <div>
            <StatusRow label="BigQuery" status={data.bigquery} />
            <StatusRow label="Redis" status={data.redis} />
            <StatusRow label="Inference model" status={data.model} />
            <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
              Last checked {formatRelativeDate(data.timestamp)} &middot; Overall:{' '}
              <span className="font-medium">{data.status}</span>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

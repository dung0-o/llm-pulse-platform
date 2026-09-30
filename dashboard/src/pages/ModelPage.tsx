import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { queries, useQueryWrapper, useRefresh } from '@/api/queries';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { SentimentTrendChart } from '@/features/trend/SentimentTrendChart';
import { MODEL_BRANDS } from '@/lib/models';
import { cn } from '@/lib/utils';

export default function ModelPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const model = searchParams.get('model') ?? '';

  const [brand, setBrand] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [days, setDays] = useState(30);

  const enabled = model.length > 0;

  const trend = queries.trend(model, days, enabled);
  const { data, isLoading, error } = useQueryWrapper(trend);
  const refresh = useRefresh();

  const resolveModel = (model: string) => {
    const next = new URLSearchParams(searchParams);
    if (model) next.set('model', model);
    else next.delete('model');
    setSearchParams(next, { replace: true });
  };

  const selectBrand = (b: string) => {
    resolveModel(b);
    setBrand(b);
    setCustom('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    resolveModel(custom);
    setBrand('');
  };

  return (
    <div className="space-y-6">
      <Card title="Search a model trend">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {MODEL_BRANDS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => selectBrand(b)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  brand === b
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-card text-muted-foreground hover:border-accent/50',
                )}
              >
                {b}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Range</span>
              <select
                className="input w-25"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
            <form onSubmit={submit} className="flex flex-1 gap-2">
              <input
                className="input w-80"
                placeholder="Or type a specific family (e.g. Qwen-3.6)"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={!custom.trim()}>
                <Search className="h-4 w-4" />
                Search
              </button>
            </form>
          </div>
        </div>
      </Card>

      {!enabled && (
        <Card>
          <EmptyState
            title="Pick a model brand or type a specific model family"
            description="Sentiment trend will appear here."
          />
        </Card>
      )}

      {enabled && (
        <>
          <Card
            title={`Sentiment trend - ${model}`}
            action={
              <RefreshButton
                onClick={() => refresh.mutate(trend)}
                isRefreshing={refresh.isPending}
              />
            }
          >
            {isLoading && <Skeleton className="h-64 w-full" />}
            {error && <ErrorState error={error} />}
            {data && (
              <div className="space-y-2">
                <SentimentTrendChart data={data.trend} />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

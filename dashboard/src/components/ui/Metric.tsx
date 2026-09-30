import { cn } from '@/lib/utils';

interface MetricProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative';
}

export function Metric({ label, value, hint, tone = 'default' }: MetricProps) {
  return (
    <div className="card-body">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

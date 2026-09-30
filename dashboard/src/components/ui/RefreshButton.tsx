import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onClick: () => void;
  isRefreshing: boolean;
  className?: string;
}

export function RefreshButton({ onClick, isRefreshing, className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isRefreshing}
      title="Fetch fresh data, bypassing the cache"
      className={cn(
        'btn-ghost text-xs disabled:opacity-50',
        className,
      )}
    >
      <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
      {isRefreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}

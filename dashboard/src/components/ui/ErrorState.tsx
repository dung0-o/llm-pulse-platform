import { AlertTriangle } from 'lucide-react';
import { ApiError } from '@/api/client';

export function ErrorState({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? `${error.status}: ${error.detail}`
      : error instanceof Error
        ? error.message
        : 'An unknown error occurred.';

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertTriangle className="mb-3 h-6 w-6 text-negative" />
      <p className="text-sm font-medium">Failed to load data</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{message}</p>
    </div>
  );
}

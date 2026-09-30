import { Moon, Sun, Github } from 'lucide-react';
import { queries, useQueryWrapper } from '@/api/queries';
import { useTheme } from '@/hooks/useTheme';
import { GITHUB_URL } from '@/lib/config';
import { cn } from '@/lib/utils';

export function Topbar() {
  const { data } = useQueryWrapper(queries.health());
  const { theme, toggle } = useTheme();

  const dotClass = (status?: string) =>
    cn(
      'h-2 w-2 rounded-full',
      status === 'connected' || status === 'ready'
        ? 'bg-positive'
        : status === 'error'
          ? 'bg-negative'
          : 'bg-neutral',
    );

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6 lg:px-10">
      <h1 className="text-sm font-semibold text-foreground">
        Community sentiment for open-weight models
      </h1>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className={dotClass(data?.bigquery)} /> BigQuery
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className={dotClass(data?.redis)} /> Redis
        </span>
        <span className="flex items-center gap-1.5">
          <span className={dotClass(data?.model)} /> Model
        </span>

        <div className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          onClick={toggle}
          className="btn-ghost -mx-1 px-1.5"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost -mx-1 px-1.5"
          title="View source on GitHub"
          aria-label="GitHub repository"
        >
          <Github className="h-4 w-4" />
        </a>
      </div>
    </header>
  );
}
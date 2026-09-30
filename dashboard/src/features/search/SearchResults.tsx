import { ExternalLink } from 'lucide-react';
import type { AspectSentimentPair, SearchResult } from '@/types';
import { cn, formatRelativeDate } from '@/lib/utils';

function chipTone(label: string): string {
  const l = label.toLowerCase();
  if (l === 'positive') return 'border-positive/25 bg-positive/10 text-positive';
  if (l === 'negative') return 'border-negative/25 bg-negative/10 text-negative';
  return 'border-border bg-muted text-muted-foreground';
}

function SentimentChip({ pair }: { pair: AspectSentimentPair }) {
  if (!pair.sentiment_label) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        chipTone(pair.sentiment_label),
      )}
    >
      {pair.model}
    </span>
  );
}

export function SearchResults({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No posts found.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {results.map((r) => {
        const pairs = r.aspect_sentiment_pairs.filter(
          (p) => p.model && p.sentiment_label,
        );

        return (
          <li key={r.post_id} className="py-3 first:pt-0 last:pb-0">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-medium leading-snug group-hover:text-accent">
                  {r.title}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatRelativeDate(r.published_at)}</span>

                  {pairs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {pairs.map((pair, i) => (
                        <SentimentChip
                          key={`${pair.model}-${pair.sentiment_label}-${i}`}
                          pair={pair}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-accent" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

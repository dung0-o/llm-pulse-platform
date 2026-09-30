import { useState } from 'react';
import { Search } from 'lucide-react';
import { queries, useQueryWrapper, useRefresh } from '@/api/queries';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { SearchResults } from '@/features/search/SearchResults';

export default function SearchPage() {
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');

  const search = queries.search(keyword, 20);
  const { data, isLoading, error } = useQueryWrapper(search);
  const refresh = useRefresh();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(input.trim());
  };

  return (
    <div className="space-y-6">
      <Card title="Search posts">
        <form onSubmit={submit} className="flex gap-2">
          <input
            className="input"
            placeholder="e.g. Qwen-3.6, GGUF, quantization..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={!input.trim()}>
            <Search className="h-4 w-4" />
            Search
          </button>
        </form>
      </Card>

      {keyword && (
        <Card
          title={`Results for "${keyword}"`}
          action={
            <RefreshButton
              onClick={() => refresh.mutate(search)}
              isRefreshing={refresh.isPending}
            />
          }
        >
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {error && <ErrorState error={error} />}
          {data && data.posts.length === 0 && (
            <EmptyState
              title="No posts found"
              description="Try a different keyword or check your spelling."
            />
          )}
          {data && data.posts.length > 0 && (
            <SearchResults results={data.posts} />
          )}
        </Card>
      )}
    </div>
  );
}

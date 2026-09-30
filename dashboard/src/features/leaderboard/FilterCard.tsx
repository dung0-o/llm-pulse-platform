import { cn } from '@/lib/utils';
import { MODEL_BRANDS } from '@/lib/models';
import { Card } from '@/components/ui/Card';

interface Filters {
  allowedBrands: string[];
  days: number;
  groupByBrand: boolean;

  onSelectBrand: (next: string[]) => void;
  onSelectDays: (next: number) => void;
  onToggle: (next: boolean) => void;
}

export function FilterCard(f: Filters) {
  const selectBrand = (brand: string) => {
    f.onSelectBrand(
      f.allowedBrands.includes(brand)
        ? f.allowedBrands.filter((b) => b !== brand)
        : [...f.allowedBrands, brand],
    );
  };

  return (
    <Card title="Filters">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {MODEL_BRANDS.map((brand) => {
            const active = f.allowedBrands.includes(brand);
            return (
              <button
                key={brand}
                type="button"
                onClick={() => selectBrand(brand)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-accent bg-accent text-white'
                    : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted-foreground))] hover:border-accent/50',
                )}
              >
                {brand}
              </button>
            );
          })}
          {f.allowedBrands.length > 0 && (
            <button
              type="button"
              onClick={() => f.onSelectBrand([])}
              className="rounded-full px-3 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-[hsl(var(--muted-foreground))]">Days</span>
            <input
              type="number"
              className="input w-16"
              value={f.days}
              min={1}
              max={30}
              step={1}
              onChange={(e) => {
                const val = Number(e.currentTarget.value);
                if (!Number.isNaN(val)) {
                  f.onSelectDays(Math.min(30, Math.max(1, val)));
                }
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={f.groupByBrand}
              onChange={(e) => f.onToggle(e.target.checked)}
            />
            <span className="text-[hsl(var(--muted-foreground))]">
              Group by brand
            </span>
          </label>
        </div>
      </div>
    </Card>
  );
}

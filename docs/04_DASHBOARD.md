# Dashboard

React + Vite single-page application. Deployed to Vercel.

## Tech stack

| Concern | Tool |
| :--- | :--- |
| Framework | React 18 |
| Build | Vite 8 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Data fetching | TanStack Query |
| Routing | React Router |
| Icons | lucide-react |
| Testing | Vitest + Testing Library |

## Route map

| Path | Page component | Purpose |
| :--- | :--- | :--- |
| `/` | `DashboardPage` | Ranked leaderboard with KPI tiles and filters |
| `/trend?model=...` | `ModelPage` | Trend chart for one model |
| `/share-of-voice` | `ShareOfVoicePage` | Mention distribution as pie + bar charts |
| `/search` | `SearchPage` | Full-text search across posts |
| `/health` | `HealthPage` | Dependency status |
| `*` | redirect to `/` | - |

`ModelPage` reads its model from the query string, so links are shareable: `/trend?model=Qwen`.

## Component tree

```
App
└── QueryClientProvider
    └── BrowserRouter
        └── AppShell
            ├── Sidebar
            │   └── NavLink × 5
            ├── Topbar
            │   ├── HealthDots (BigQuery, Redis, Model)
            │   ├── ThemeToggle
            │   └── GitHubLink
            └── Routes
                ├── DashboardPage
                │   ├── Metric × 3
                │   ├── FilterCard
                │   └── LeaderboardTable
                ├── ShareOfVoicePage
                │   ├── Metric × 3
                │   ├── FilterCard
                │   ├── PieChart
                │   ├── BarChart
                │   └── BreakdownTable
                ├── ModelPage
                │   ├── FamilyPicker
                │   └── SentimentTrendChart
                ├── SearchPage
                │   ├── SearchBox
                │   └── SearchResults
                └── HealthPage
                    └── StatusRow × 3
```

## Directory layout

```
dashboard/src/
├── api/
│   ├── client.ts            fetch wrapper with typed ApiError
│   └── queries.ts           descriptors + useQueryWrapper + useRefresh
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx     sidebar + topbar + main + footer
│   │   ├── Sidebar.tsx      navigation
│   │   └── Topbar.tsx       health dots, theme toggle, GitHub link
│   └── ui/
│       ├── Card.tsx         container with title and optional action
│       ├── EmptyState.tsx   no data
│       ├── ErrorState.tsx   failed request
│       ├── Metric.tsx       KPI tile
│       ├── RefreshButton.tsx
│       └── Skeleton.tsx     loading placeholder
├── features/
│   ├── leaderboard/
│   │   ├── FilterCard.tsx   brand chips, days input, group toggle
│   │   └── LeaderboardTable.tsx
│   ├── search/
│   │   └── SearchResults.tsx
│   ├── share-of-voice/
│   │   ├── colors.ts        deterministic hue assignment
│   │   └── colors.test.ts
│   └── trend/
│       └── SentimentTrendChart.tsx
├── hooks/
│   └── useTheme.ts          dark mode with localStorage
├── lib/
│   ├── config.ts            GITHUB_URL, APP_VERSION
│   ├── models.ts            AUTO-GENERATED from config/models.yaml
│   └── utils.ts             cn, formatNumber, safeNumber, formatScore, ...
├── pages/
│   ├── DashboardPage.tsx
│   ├── HealthPage.tsx
│   ├── ModelPage.tsx
│   ├── SearchPage.tsx
│   └── ShareOfVoicePage.tsx
├── test/
│   └── setup.ts             jest-dom matchers
├── types/
│   └── index.ts             mirrors of Pydantic schemas
├── App.tsx
├── index.css
└── main.tsx
```

The structure follows a **feature-based** organization. Anything used by exactly one page lives under `features/`. Anything reused across pages lives under `components/` or `lib/`.

## State management

Three kinds of state, each handled differently:

| Kind | Example | Where it lives |
| :--- | :--- | :--- |
| **Server state** | Leaderboard rows, trend points | TanStack Query cache |
| **URL state** | Selected model on `/trend` | `useSearchParams` |
| **UI state** | Filter selections, theme | `useState` / `useTheme` |

No Redux, no Zustand, no context for data. TanStack Query owns everything that comes from the API; the URL owns anything that should survive a refresh or be shareable.

### Query descriptors

Every endpoint is described by a `QueryDescriptor<T>`:

```typescript
interface QueryDescriptor<T> {
  key: readonly unknown[];
  path: string;
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number;
  readonly __response?: T;  // phantom field for type inference
}

export const queries = {
  leaderboard: (f: LeaderboardFilters): QueryDescriptor<LeaderboardResponse> => ({
    key: ['leaderboard', f.allowedBrands, f.days, f.groupByBrand],
    path: `/leaderboard?${buildLeaderboardParams(f)}`,
  }),
  // ...
};
```

Consumed by a single generic hook:

```typescript
export function useQueryWrapper<T>(d: QueryDescriptor<T>) {
  return useQuery({
    queryKey: d.key,
    queryFn: () => api.get<T>(d.path),
    enabled: d.enabled ?? true,
    refetchInterval: d.refetchInterval,
  });
}
```

The `__response` phantom field never exists at runtime - it exists so `useQueryWrapper(queries.leaderboard(f))` infers `LeaderboardResponse | undefined` for `data`. This eliminates per-endpoint hooks while keeping full type safety.

### Refresh

The `RefreshButton` calls `useRefresh().mutate(descriptor)`:

```typescript
mutationFn: async ({ key, path }) => {
  const separator = path.includes('?') ? '&' : '?';
  const data = await api.get(`${path}${separator}refresh=true`);
  qc.setQueryData(key, data);
  return data;
}
```

This bypasses Redis for one request and writes the result into the TanStack Query cache. Subsequent renders see the fresh data without a second fetch.

## Data fetching

```typescript
const leaderboard = queries.leaderboard(filters);
const { data, isLoading, error } = useQueryWrapper(leaderboard);
```

Three states, each rendered explicitly:

| State | Condition | UI |
| :--- | :--- | :--- |
| Loading | `isLoading` | `<Skeleton>` rows |
| Error | `error` | `<ErrorState error={error}>` |
| Empty | `data.ranking.length === 0` | `<EmptyState>` |
| Populated | otherwise | `<LeaderboardTable>` |

`ErrorState` handles `ApiError` (which carries `status` and `detail`) and generic `Error` differently, showing the status code when available.

## Color system

The share-of-voice page assigns colors deterministically so a family always has the same hue across sessions and reloads.

```typescript
// features/share-of-voice/colors.ts
function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
```

Two modes:

| `group_by_brand` | Color assignment |
| :--- | :--- |
| `true` | One hue per brand: `hsl(hue, 65%, 45%)` |
| `false` | Same hue per brand, lightness varies per version: `35% → 65%`, saturation `75% → 50%` |

The second mode makes `Qwen-3.5`, `Qwen-3.6`, and `Qwen-3.8` visually cluster as siblings while remaining distinguishable in a pie chart.

## Theming

`useTheme` toggles between `light` and `dark` classes on `<html>`. The CSS variables in `index.css` are redefined under `.dark`:

```css
:root {
  --background: 220 20% 98%;
  --foreground: 222 47% 11%;
  --surface: 220 20% 98%;
  --card: 0 0% 100%;
  --border: 220 13% 91%;
  /* ... */
}

.dark {
  --background: 222 47% 7%;
  --foreground: 220 20% 96%;
  --surface: 222 47% 7%;
  --card: 222 40% 11%;
  --border: 222 30% 20%;
  /* ... */
}
```

Tailwind maps these to named utilities (`bg-surface`, `text-foreground`, `border-border`) so components never reference raw CSS variables.

The initial theme reads `localStorage` first, then falls back to `prefers-color-scheme`. Persistence is to `localStorage` only - no server round trip, no flash of unstyled content.

## Charts

`SentimentTrendChart` is a Recharts `ComposedChart` with a dual Y-axis:

- **Left axis** (`sentiment`): domain `[-1, 1]`, ticks at `[-1, -0.5, 0, 0.5, 1]`
- **Right axis** (`volume`): hidden, but present to reserve space

The line (sentiment) and bars (post volume) share one plotting area, so a bar and a point at the same date are vertically aligned. This was originally two separate charts with a misalignment bug - the merge to `ComposedChart` eliminated the class of error.

A `ReferenceLine` at `y=0` marks neutral.

## URL state

`ModelPage` uses `useSearchParams`:

```typescript
const [searchParams, setSearchParams] = useSearchParams();
const model = searchParams.get('model') ?? '';

const resolveModel = (model: string) => {
  const next = new URLSearchParams(searchParams);
  if (model) next.set('model', model);
  else next.delete('model');
  setSearchParams(next, { replace: true });
};
```

`replace: true` avoids polluting browser history with every chip click. The result is that `/trend?model=Qwen` can be pasted into a new tab and renders the correct model.

## Health indicators

`Topbar` polls `/health` every 30 seconds via TanStack Query's `refetchInterval`. Three dots reflect the dependency states:

| Dot | Green | Red | Gray |
| :--- | :--- | :--- | :--- |
| BigQuery | `connected` | `error` | `disconnected` |
| Redis | `connected` | `error` | `disconnected` |
| Model | `ready` | `error` | `loading` |

The polling interval matches Cloud Run's own liveness probe cadence, so the dashboard reflects dependency state within the same window as the platform.

## Responsive design

The layout is desktop-first but functional on mobile:

| Breakpoint | Behavior |
| :--- | :--- |
| `< lg` (1024px) | Sidebar hidden; topbar full width |
| `≥ lg` | Sidebar visible at 224px |

Charts use `ResponsiveContainer` so they fill their parent's width. KPI grids collapse from 3 columns to 1 below `sm`.

## Build and deploy

```bash
npm run dev        # Vite dev server on :5173, proxies /api → :8000
npm run build      # tsc -b && vite build → dist/
npm run preview    # serve dist/ locally
npm run typecheck  # tsc --noEmit
npm run test       # vitest
```

Vercel runs `npm run build` on every push to `main` under `dashboard/`. `vercel.json` rewrites all paths to `index.html` so client-side routes survive a refresh.

## Environment

| Variable | Where set | Purpose |
| :--- | :--- | :--- |
| `VITE_API_URL` | `.env` (local), Vercel project settings (prod) | API base URL |

Vite bakes `VITE_*` variables into the bundle at build time. They are visible to anyone who opens DevTools. Never put secrets here - the dashboard has no secrets.

The dev server proxies `/api/*` to `http://localhost:8000`, so `VITE_API_URL` can be left unset during local development. The proxy config lives in `vite.config.ts`.

## Testing

Two test files cover the pure-logic surface:

| File | Covers |
| :--- | :--- |
| `lib/utils.test.ts` | `safeNumber`, `formatScore`, `formatNumber`, `scoreToLabel`, `formatRelativeDate` |
| `features/share-of-voice/colors.test.ts` | `buildColorMap` - determinism, hue sharing, lightness ordering |

Vitest runs in `jsdom`. No component render tests - the components are largely presentational, and the ones with logic (filters, refresh) depend on TanStack Query, which would require a mock layer. The cost/benefit did not favor it for a portfolio project.

## Known limitations

- **No pagination on `/search`.** The API caps at 50 results; the UI shows all of them.
- **No optimistic updates.** Refresh mutations show a spinner and wait for the response.
- **No error boundary.** An unhandled render error produces a blank page.

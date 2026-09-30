# Dashboard

React + Vite dashboard. Deployed to Vercel.

## Local run

```bash
cd dashboard
npm install
npm run dev
```

The dev server proxies `/api/*` to `http://localhost:8000`. Start the API first, or run both via `make run`.

## Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Vite dev server on `:5173` |
| `npm run build` | Type check + production bundle |
| `npm run typecheck` | `tsc --noEmit` only |
| `npm run test` | Vitest |

## Environment

| Variable | Local | Production |
| :--- | :--- | :--- |
| `VITE_API_URL` | Leave unset - dev proxy handles it | Set in Vercel project settings |

## Deploy

Connect the `dashboard/` directory as a Vercel project. Set `VITE_API_URL` to your Cloud Run URL. Vercel builds on every push to `main`.

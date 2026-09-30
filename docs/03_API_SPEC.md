# API specification

The FastAPI service that exposes sentiment data to the dashboard. Deployed on Cloud Run, backed by BigQuery and Upstash Redis.

## Base URL

| Environment | URL |
| :--- | :--- |
| Local | `http://localhost:8000` |
| Production | `https://local-llm-sentiment-api-<hash>-uc.a.run.app` |

Interactive documentation is served at `/docs` (Swagger UI) and `/redoc` (ReDoc). Both are generated from the Pydantic schemas and are always current.

## Caching

Most endpoints read from Upstash Redis before querying BigQuery.

| Endpoint | Cache key | TTL |
| :--- | :--- | :--- |
| `/leaderboard` | `leaderboard:{brands}:{days}:{group_by_brand}` | 6 hours |
| `/post-count` | `post_count:{brands}:{days}:{group_by_brand}` | 6 hours |
| `/trend` | `trend:{model}:{days}` | 6 hours |
| `/search` | `search:{keyword}:{limit}` | 6 hours |
| `/health` | not cached | - |

Every cached endpoint accepts a `refresh=true` query parameter that bypasses the cache for that request only. The response is still written back to Redis, so subsequent calls see the fresh value.

## Common parameters

| Name | Type | Applies to | Notes |
| :--- | :--- | :--- | :--- |
| `allowed_brands` | `string[]` | `/leaderboard`, `/post-count` | Repeat the parameter for multiple brands: `?allowed_brands=Alibaba&allowed_brands=Meta` |
| `days` | `int` | all data endpoints | `ge=1, le=30`. Default `7`. |
| `group_by_brand` | `bool` | `/leaderboard`, `/post-count` | Collapse versioned mentions into one row per brand. Default `false`. |
| `refresh` | `bool` | all cached endpoints | Bypass Redis for this request. Default `false`. |

## Endpoints

### `GET /leaderboard`

Ranked list of models or brands by Vibe Score.

**Parameters**

| Name | Type | Required | Default |
| :--- | :--- | :--- | :--- |
| `allowed_brands` | `string[]` | No | all |
| `days` | `int` | No | `7` |
| `group_by_brand` | `bool` | No | `false` |
| `refresh` | `bool` | No | `false` |

**Response `200`**

```json
{
  "allowed_brands": ["Qwen", "Gemma"],
  "days_analysed": 7,
  "group_by_brand": false,
  "ranking": [
    {
      "brand": "Qwen",
      "model": "Qwen 3.8",
      "post_count": 42,
      "sum_score": 18.6,
      "weighted_score": 0.72
    }
  ]
}
```

**Field semantics**

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `brand` | string | Brand from `config/models.yaml` (`Qwen`, `Gemma`, ...) |
| `model` | string | Specific family `group_by_brand=false`, brand when `true` |
| `post_count` | int | Number of mentions in the window |
| `sum_score` | float | Raw sum of `sentiment_score` |
| `weighted_score` | float | Bayesian Weighted Score (aka IMDb rating): `sum_score / (post_count + heuristic)` |

**Errors**

| Status | When |
| :--- | :--- |
| `422` | `days` outside `[1, 30]` |
| `500` | BigQuery unavailable and cache cold |

---

### `GET /post-count`

Mention distribution. Same parameters as `/leaderboard`, but returns percentages instead of scores.

**Response `200`**

```json
{
  "allowed_brands": null,
  "days_analysed": 7,
  "group_by_brand": true,
  "ranking": [
    { "brand": "Qwen",  "model": "Qwen 3.8", "post_count": 120, "percentage": 43.2 },
    { "brand": "Gemma", "model": "Gemma 4",  "post_count": 78,  "percentage": 28.1 }
  ]
}
```

`percentage` is computed server-side and sums to `100.0` across the response. The client should not recompute it - the divisor includes brands filtered out of the current view.

---

### `GET /trend`

Sentiment over time for a single model or brand.

**Parameters**

| Name | Type | Required | Default |
| :--- | :--- | :--- | :--- |
| `model` | `string` | Yes | - |
| `days` | `int` | No | `7` (max `30`) |
| `refresh` | `bool` | No | `false` |

A case-insensitive match runs `model` against `pattern` in `gold_post_enriched`.

**Response `200`**

```json
{
  "model": "Qwen 3.8",
  "days_analysed": 30,
  "trend": [
    { "date": "2026-09-01", "avg_sentiment": 0.42, "post_count": 8 },
    { "date": "2026-09-02", "avg_sentiment": 0.55, "post_count": 12 }
  ]
}
```

**Field semantics**

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `date` | string | ISO date (`YYYY-MM-DD`) |
| `avg_sentiment` | float | Mean `sentiment_score` for that date, in `[-1, 1]` |
| `post_count` | int | Mentions on that date |

Dates with no mentions are omitted, not zero-filled. The client renders a line chart and connects adjacent points; a gap in the series means no discussion that day.

**Empty response**

If `model` does not match any row, the response is `200` with `trend: []`. This is not an error - the client renders an empty state.

---

### `GET /search`

Full-text search over post titles and bodies. Returns one row per post, with all mention-sentiment pairs aggregated into an array.

**Parameters**

| Name | Type | Required | Default |
| :--- | :--- | :--- | :--- |
| `keyword` | `string` | Yes | - |
| `limit` | `int` | No | `20` (`ge=1, le=50`) |
| `refresh` | `bool` | No | `false` |

Empty or whitespace-only keywords return an empty result set with `200`, not `422`. This lets the dashboard render its initial state without special-casing.

**Response `200`**

```json
{
  "keyword": "quantization",
  "limit": 20,
  "number_of_posts": 2,
  "posts": [
    {
      "post_id": "1w6aec4",
      "title": "Q4_K_M vs Q5_K_M for Qwen 3.8",
      "url": "https://www.reddit.com/r/LocalLLaMA/comments/1w6aec4/",
      "published_at": "2026-09-25T14:30:00Z",
      "aspect_sentiment_pairs": [
        { "model": "Qwen-3.8", "sentiment_label": "Positive" },
        { "model": "Qwen-3.6", "sentiment_label": "Neutral" }
      ]
    }
  ]
}
```

**`aspect_sentiment_pairs`**

The array contains one entry per mention in the post. The SQL orders entries by `sentiment_score DESC`, so the most positively-scored model appears first.

An entry with `model: null` or `sentiment_label: null` is filtered out server-side. If every pair is null, `aspect_sentiment_pairs` is an empty array and the client renders the post without chips.

---

### `GET /health`

Liveness and dependency status. Used by Cloud Run's startup and liveness probes, and by the dashboard's status indicators.

**Response `200`**

```json
{
  "status": "healthy",
  "timestamp": "2026-09-29T10:00:00Z",
  "bigquery": "connected",
  "redis": "connected",
  "model": "ready"
}
```

**Field semantics**

| Field | Values | Meaning |
| :--- | :--- | :--- |
| `status` | `healthy` | Always `healthy` if the process is running |
| `bigquery` | `connected`, `disconnected`, `error` | Result of `check_bigquery_connection()` |
| `redis` | `connected`, `disconnected`, `error` | Result of a test `GET`/`SET` |
| `model` | `ready`, `loading`, `error` | Result of `inference_health_check()` |

A non-200 HTTP status is never returned. The endpoint reports dependency health in the body, not the status code, so the Cloud Run probe can distinguish "process alive but BigQuery down" from "process dead."

**Cache and rate limits**

Not cached. Each call performs three dependency checks. The dashboard polls this every 30 seconds; Cloud Run probes it every 30 seconds. Neither is enough traffic to matter.

## Error format

All error responses use FastAPI's default shape:

```json
{ "detail": "Human-readable message" }
```

For validation errors (`422`), `detail` is a list of Pydantic validation errors:

```json
{
  "detail": [
    {
      "loc": ["query", "days"],
      "msg": "Input should be less than or equal to 30",
      "type": "less_than_equal"
    }
  ]
}
```

The dashboard's `ApiError` class extracts `detail` and displays it in the `ErrorState` component. If `detail` is an array, the first entry's `msg` is used.

## CORS

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

`allow_origins=["*"]` is permissive because the API is public and read-only. The `ADMIN_TOKEN` header protects the only mutating endpoint. CORS does not restrict `curl` or server-to-server calls - it only affects browsers. A future tightening would restrict `allow_origins` to the Vercel domain and `allow_methods` to `GET`, but this is not a security requirement for a read-only API.

## Schemas

Defined in `api/schemas.py`, mirrored in `dashboard/src/types/index.ts`.

```python
class LeaderboardItem(BaseModel):
    brand: str
    model: str
    post_count: int
    sum_score: float
    weighted_score: float

class PostCountItem(BaseModel):
    brand: str
    model: str
    post_count: int
    percentage: float

class RankResponse(BaseModel):
    allowed_brands: list[str] | None
    days_analysed: int
    group_by_brand: bool
    ranking: list[LeaderboardItem] | list[PostCountItem]

class TrendPoint(BaseModel):
    date: str
    avg_sentiment: float
    post_count: int

class TrendResponse(BaseModel):
    model: str
    days_analysed: int
    trend: list[TrendPoint]

class AspectSentimentPair(BaseModel):
    model: str | None
    sentiment_label: str | None

class SearchResult(BaseModel):
    post_id: str
    title: str
    url: str
    published_at: datetime
    aspect_sentiment_pairs: list[AspectSentimentPair]

class SearchResponse(BaseModel):
    keyword: str
    limit: int
    number_of_posts: int
    posts: list[SearchResult]

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    bigquery: Literal["connected", "disconnected", "error"]
    redis: Literal["connected", "disconnected", "error"]
    model: Literal["ready", "loading", "error"]
```

`RankResponse.ranking` is typed as a union because `/leaderboard` and `/post-count` return the same envelope with different item shapes. The dashboard uses two concrete types (`LeaderboardResponse` and `PostCountResponse`) rather than the union, so TypeScript can narrow field access.

## BigQuery queries

The SQL behind each endpoint. All queries read from `gold_post_enriched`.

### `/leaderboard`

```sql
SELECT
    brand,
    @group_by_brand ? brand : model AS model,
    COUNT(*) AS post_count,
    SUM(sentiment_score) AS sum_score,
    ROUND(SUM(sentiment_score) / (COUNT(*) + @heuristic) * 2, 4) AS weighted_score
FROM `gold_post_enriched`
WHERE publish_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    AND (@brands IS NULL OR brand IN UNNEST(@brands))
    AND (is_specific_family OR @group_by_brand)
GROUP BY 1, 2
ORDER BY weighted_score DESC
```

### `/post-count`

```sql
SELECT
    brand,
    @group_by_brand ? brand : model AS model,
    COUNT(*) AS post_count,
    ROUND(COUNT(*) * 100 / SUM(COUNT(*)) OVER (), 4) AS percentage
FROM `gold_post_enriched`
WHERE publish_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    AND (@brands IS NULL OR brand IN UNNEST(@brands))
    AND (is_specific_family OR @group_by_brand)
GROUP BY 1, 2
ORDER BY percentage DESC
```

`SUM(COUNT(*)) OVER ()` computes the total across all groups without a second scan.

### `/trend`

```sql
SELECT
    CAST(publish_date AS STRING) AS date,
    ROUND(AVG(sentiment_score), 4) AS avg_sentiment,
    COUNT(*) AS post_count
FROM `gold_post_enriched`
WHERE publish_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    AND REGEXP_CONTAINS(@model, pattern)
GROUP BY publish_date, is_specific_family, model
QUALIFY RANK() OVER (
    ORDER BY is_specific_family DESC, LENGTH(model) DESC
) = 1
ORDER BY publish_date ASC
```

### `/search`

```sql
SELECT
    post_id,
    title,
    url,
    published_at,
    ARRAY_AGG(
        STRUCT(model, sentiment_label)
        ORDER BY sentiment_score DESC
    ) AS aspect_sentiment_pairs
FROM `gold_post_enriched`
WHERE REGEXP_CONTAINS(@keyword, pattern)
    OR LOWER(full_text) LIKE CONCAT('%', LOWER(@keyword), '%')
GROUP BY post_id, title, url, published_at
ORDER BY published_at DESC
LIMIT @limit
```

`GROUP BY` includes every projected column because BigQuery does not infer functional dependency.

## Performance

At the current data volume (~1,400 Gold rows), every query completes in under 500 ms on a cold cache. The bottleneck is the Cloud Run cold start (~4 s), not BigQuery. With a warm container and a warm Redis cache, response times are:

| Endpoint | Cache hit | Cache miss |
| :--- | :--- | :--- |
| `/leaderboard` | ~15 ms | ~250 ms |
| `/post-count` | ~15 ms | ~250 ms |
| `/trend` | ~15 ms | ~200 ms |
| `/search` | ~15 ms | ~300 ms |
| `/health` | - | ~100 ms |

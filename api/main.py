from datetime import UTC, datetime

from cache import RedisClient
from database import (
    check_bigquery_connection,
    query_leaderboard,
    query_post_count,
    query_trend,
    search_posts,
)
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from inference import (
    inference_health_check,
)
from jobs.backfill import backfill_sentiments
from schemas import (
    HealthResponse,
    RankResponse,
    SearchResponse,
    TrendResponse,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Local LLM Sentiment Tracker API",
        version="1.0.0",
        description="Real-time sentiment ranking for open-weight models.",
    )


    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )


    redis = RedisClient()


    @app.get(
        "/leaderboard",
        response_model=RankResponse,
        tags=["ranking"],
        summary="Get a ranked list of models by their current vibe score.",
    )
    def leaderboard(
        allowed_brands: list[str] | None = Query(None,
                description="A list of model brands to filter the items by"),
        days: int = Query(7, ge=1, le=30,
                description="Number of past days to analyse"),
        group_by_brand: bool = Query(False,
                description="Group results by model brand"),
        refresh: bool = Query(False,
                description="Bypass the Redis cache for this request"),
    ) -> RankResponse:

        allowed_brands_str = ','.join(allowed_brands) if allowed_brands else ''
        cache_key = f"leaderboard:{allowed_brands_str}:{days}:{group_by_brand}"
        if not refresh:
            cached = redis.get(cache_key)
            if cached:
                return RankResponse.model_validate_json(cached)

        backfill_sentiments(days=days)

        bq_result = query_leaderboard(allowed_brands, days, group_by_brand)
        response = RankResponse(
            allowed_brands=allowed_brands,
            days_analysed=days,
            group_by_brand=group_by_brand,
            ranking=bq_result,
        )
        redis.set(cache_key, response.model_dump_json(), ttl=21600)
        return response


    @app.get(
        "/post-count",
        response_model=RankResponse,
        tags=["ranking"],
        summary="Get the distribution of discussions across different models.",
    )
    def post_count(
        allowed_brands: list[str] | None = Query(None,
                description="A list of model brands to filter the items by"),
        days: int = Query(7, ge=1, le=30,
                description="Number of past days to analyse"),
        group_by_brand: bool = Query(False,
                description="Group results by model brand"),
        refresh: bool = Query(False,
                description="Bypass the Redis cache for this request"),
    ) -> RankResponse:

        allowed_brands_str = ','.join(allowed_brands) if allowed_brands else ''
        cache_key = f"post_count:{allowed_brands_str}:{days}:{group_by_brand}"
        if not refresh:
            cached = redis.get(cache_key)
            if cached:
                return RankResponse.model_validate_json(cached)

        bq_result = query_post_count(allowed_brands, days, group_by_brand)
        response = RankResponse(
            allowed_brands=allowed_brands,
            days_analysed=days,
            group_by_brand=group_by_brand,
            ranking=bq_result,
        )
        redis.set(cache_key, response.model_dump_json(), ttl=21600)
        return response


    @app.get(
        "/trend",
        response_model=TrendResponse,
        tags=["model_specific"],
        summary="Get the sentiment trend for a specific model over time.",
    )
    def trend(
        model: str = Query(
                description="The model brand or specific model family"),
        days: int = Query(7, ge=1, le=30,
                description="Number of past days to analyse"),
        refresh: bool = Query(False,
                description="Bypass the Redis cache for this request"),
    ) -> TrendResponse:
        cleaned_model = model.strip().replace(' ', '-').lower()
        if not cleaned_model:
            return TrendResponse()

        cache_key = f"trend:{cleaned_model}:{days}"
        if not refresh:
            cached = redis.get(cache_key)
            if cached:
                return TrendResponse.model_validate_json(cached)

        backfill_sentiments(cleaned_model, days)

        bq_result = query_trend(cleaned_model, days)
        response = TrendResponse(
            model=model,
            days_analysed=days,
            trend=bq_result,
        )
        redis.set(cache_key, response.model_dump_json(), ttl=21600)
        return response


    @app.get(
        "/search",
        response_model=SearchResponse,
        tags=["model_specific"],
        summary="Fetch posts mentioning a specific model or keyword.",
    )
    def search(
        keyword: str = Query(
                description="The search keyword"),
        limit: int = Query(20, ge=1, le=50,
                description="Number of results to return"),
        refresh: bool = Query(False,
                description="Bypass the Redis cache for this request"),
    ) -> SearchResponse:
        keyword = keyword.strip()
        if not keyword:
            return SearchResponse()

        cache_key = f"search:{keyword.lower()}:{limit}"
        if not refresh:
            cached = redis.get(cache_key)
            if cached:
                return SearchResponse.model_validate_json(cached)

        bq_result = search_posts(keyword, limit)
        response = SearchResponse(
            keyword=keyword,
            limit=limit,
            number_of_posts=len(bq_result),
            posts=bq_result,
        )
        redis.set(cache_key, response.model_dump_json(), ttl=21600)
        return response


    @app.get(
        "/health",
        response_model=HealthResponse,
        tags=["system"],
        summary="Health check",
    )
    def health() -> HealthResponse:
        try:
            bq_connect = check_bigquery_connection()
            bq_status = "connected" if bq_connect else "disconnected"
        except Exception:
            bq_status = "error"

        try:
            redis_connect = redis.health()
            redis_status = "connected" if redis_connect else "disconnected"
        except Exception:
            redis_status = "error"

        try:
            model_ready = inference_health_check()
            model_status = "ready" if model_ready else "loading"
        except Exception:
            model_status = "error"

        return HealthResponse(
            status="healthy",
            timestamp=datetime.now(UTC).isoformat(),
            bigquery=bq_status,
            redis=redis_status,
            model=model_status,
        )

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)

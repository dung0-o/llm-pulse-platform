from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


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


class TrendPoint(BaseModel):
    date: str
    avg_sentiment: float
    post_count: int


class AspectSentimentPair(BaseModel):
    model: str | None
    sentiment_label: str | None


class SearchResult(BaseModel):
    post_id: str
    title: str
    url: str
    published_at: datetime
    aspect_sentiment_pairs: list[AspectSentimentPair]


class CacheModel(BaseModel):
    cache_hit:  bool = False

    @classmethod
    def model_validate_json(cls, json: str) -> CacheModel:
        newModel = super().model_validate_json(json)
        newModel.cache_hit = True
        return newModel


class RankResponse(CacheModel):
    allowed_brands: list[str] | None = None
    days_analysed:  int = 7
    group_by_brand: bool = False
    ranking:        list[LeaderboardItem] | list[PostCountItem] = []


class TrendResponse(CacheModel):
    model:          str | None = None
    days_analysed:  int = 7
    trend:          list[TrendPoint] = []


class SearchResponse(CacheModel):
    keyword:            str | None = None
    limit:              int = 7
    number_of_posts:    int = 0
    posts:              list[SearchResult] = []


class HealthResponse(BaseModel):
    status:         str = "healthy"
    timestamp:      str = ""
    bigquery:       Literal["connected", "disconnected", "error"] = "disconnected"
    redis:          Literal["connected", "disconnected", "error"] = "disconnected"
    model:          Literal["ready", "loading", "error"] = "loading"

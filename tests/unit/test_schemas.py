from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from schemas import (
    HealthResponse,
    PostCountItem,
    RankResponse,
    TrendPoint,
)


@pytest.mark.unit
def test_rank_response_accepts_empty_ranking() -> None:
    r = RankResponse(
        allowed_brands=None,
        days_analysed=7,
        group_by_brand=False,
        ranking=[],
    )
    assert r.ranking == []


@pytest.mark.unit
def test_rank_response_roundtrips_json() -> None:
    r = RankResponse(
        cache_hit=True,
        allowed_brands=["Qwen"],
        days_analysed=7,
        group_by_brand=True,
        ranking=[
            PostCountItem(
                brand="Qwen",
                model="Qwen 3.8",
                post_count=42,
                percentage=0.65,
            )
        ],
    )
    restored = RankResponse.model_validate_json(r.model_dump_json())
    assert restored == r


@pytest.mark.unit
def test_health_response_rejects_invalid_status() -> None:
    with pytest.raises(ValidationError):
        HealthResponse(
            status="healthy",
            timestamp=datetime.now(UTC).isoformat(),
            bigquery="maybe",   # not a valid literal
            redis="connected",
            model="ready",
        )


@pytest.mark.unit
def test_trend_point_requires_date() -> None:
    with pytest.raises(ValidationError):
        TrendPoint(date=None, avg_sentiment=0.5, post_count=3)

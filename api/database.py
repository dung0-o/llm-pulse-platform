import structlog
from google.api_core import exceptions as gcp_exceptions
from google.cloud.bigquery import (
    ArrayQueryParameter,
    Client,
    QueryJobConfig,
    ScalarQueryParameter,
    ScalarQueryParameterType,
    StructQueryParameter,
    StructQueryParameterType,
)
from schemas import AspectSentimentPair, LeaderboardItem, PostCountItem, SearchResult, TrendPoint

from config import settings

logger = structlog.get_logger(__name__)

BAYESIAN_HEURISTIC = 3

TABLE_ID = \
    f"{settings.GCP_PROJECT_ID}.{settings.BQ_DATASET_NAME}.gold_post_enriched"
FEATURES_TABLE_ID = \
    f"{settings.GCP_PROJECT_ID}.{settings.BQ_DATASET_NAME}.gold_post_features"
BACKFILL_TABLE_ID = \
    f"{settings.GCP_PROJECT_ID}.{settings.BQ_DATASET_NAME}.gold_sentiment_predictions"

BACKFILL_CHUNK_SIZE = 5_000
BACKFILL_STRUCT_TYPE = StructQueryParameterType(
    ScalarQueryParameterType("STRING",  name="mention_id"),
    ScalarQueryParameterType("FLOAT64", name="score"),
    ScalarQueryParameterType("STRING",  name="label"),
)


def backfill_struct_params(rows: list[dict]) -> list[StructQueryParameter]:
    return [
        StructQueryParameter(
            "row",
            ScalarQueryParameter("mention_id", "STRING", r["mention_id"]),
            ScalarQueryParameter("score", "FLOAT64", r["score"]),
            ScalarQueryParameter("label", "STRING", r["label"]),
        )
        for r in rows
    ]


def get_bigquery_client() -> Client:
    try:
        client = Client(project=settings.GCP_PROJECT_ID)
        return client
    except Exception as exc:
        logger.error("Failed to initialize BigQuery client", error=str(exc))
        raise

def query_leaderboard(
    allowed_brands: list[str] | None = None,
    days: int = 7,
    group_by_brand: bool = False
) -> list[LeaderboardItem]:
    client = get_bigquery_client()

    query = f"""
        SELECT
            brand,
            {"model" if not group_by_brand else "brand AS model"},
            COUNT(*) AS post_count,
            ROUND(SUM(sentiment_score), 4) AS sum_score,
            ROUND(SUM(sentiment_score) / (COUNT(*) + {BAYESIAN_HEURISTIC}) * 2, 4) AS weighted_score
        FROM `{TABLE_ID}`
        WHERE publish_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            {"AND brand IN UNNEST(@allowed_brands)" if allowed_brands else ""}
            {"AND is_specific_family" if not group_by_brand else ""}
        GROUP BY {"brand, model" if not group_by_brand else "brand"}
        ORDER BY weighted_score DESC
    """

    job_config = QueryJobConfig(
        query_parameters=[
            ArrayQueryParameter("allowed_brands", "STRING", allowed_brands or ['']),
            ScalarQueryParameter("days", "INT64", days),
        ]
    )

    return [
        LeaderboardItem.model_validate(dict(row))
        for row in client.query(query, job_config=job_config).result()
    ]


def query_post_count(
    allowed_brands: list[str] | None = None,
    days: int = 7,
    group_by_brand: bool = False
) -> list[PostCountItem]:
    client = get_bigquery_client()

    query = f"""
        SELECT
            brand,
            {"model" if not group_by_brand else "brand AS model"},
            COUNT(*) AS post_count,
            ROUND(COUNT(*) * 100 / SUM(COUNT(*)) OVER (), 4) AS percentage
        FROM `{TABLE_ID}`
        WHERE publish_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            {"AND brand IN UNNEST(@allowed_brands)" if allowed_brands else ""}
            {"AND is_specific_family" if not group_by_brand else ""}
        GROUP BY {"brand, model" if not group_by_brand else "brand"}
        ORDER BY percentage DESC
    """

    job_config = QueryJobConfig(
        query_parameters=[
            ArrayQueryParameter("allowed_brands", "STRING", allowed_brands or ['']),
            ScalarQueryParameter("days", "INT64", days),
        ]
    )

    return [
        PostCountItem.model_validate(dict(row))
        for row in client.query(query, job_config=job_config).result()
    ]


def query_trend(model: str, days: int = 7) -> list[TrendPoint]:
    client = get_bigquery_client()

    query = f"""
        SELECT
            CAST(publish_date AS STRING) AS date,
            ROUND(AVG(sentiment_score), 4) AS avg_sentiment,
            COUNT(*) AS post_count
        FROM `{TABLE_ID}`
        WHERE publish_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            AND REGEXP_CONTAINS(@model, pattern)
        GROUP BY publish_date, is_specific_family, model
        QUALIFY RANK() OVER (
            ORDER BY is_specific_family DESC, LENGTH(model) DESC
        ) = 1
        ORDER BY publish_date ASC
    """

    job_config = QueryJobConfig(
        query_parameters=[
            ScalarQueryParameter("model", "STRING", model),
            ScalarQueryParameter("days", "INT64", days),
        ]
    )

    return [
        TrendPoint.model_validate(dict(row))
        for row in client.query(query, job_config=job_config).result()
    ]


def query_null_sentiment_posts(model: str = '', days: int = 7) -> list[dict]:
    client = get_bigquery_client()
    query = f"""
        SELECT
            mention_id,
            mention,
            full_text
        FROM `{TABLE_ID}`
        WHERE publish_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            AND sentiment_score IS NULL
            {"AND (LOWER(model) = LOWER(@model) OR LOWER(brand) = LOWER(@model))" if model else ""}
    """
    job_config = QueryJobConfig(
        query_parameters=[
            ScalarQueryParameter("model", "STRING", model),
            ScalarQueryParameter("days", "INT64", days),
        ]
    )
    results = list(client.query(query, job_config=job_config).result())
    return [dict(row) for row in results]


def update_sentiments_bulk(payload: list[dict]) -> None:
    client = get_bigquery_client()
    query = f"""
        CREATE TEMP TABLE staging_backfill AS
        SELECT * FROM UNNEST(@rows);

        MERGE `{BACKFILL_TABLE_ID}` AS t
        USING staging_backfill AS s
        ON t.mention_id = s.mention_id
        WHEN MATCHED THEN UPDATE SET
            sentiment_score = s.score,
            sentiment_label = s.label,
            scored_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT
            (mention_id, sentiment_score, sentiment_label, scored_at)
            VALUES
            (s.mention_id, s.score, s.label, CURRENT_TIMESTAMP());
    """

    for start in range(0, len(payload), BACKFILL_CHUNK_SIZE):
        chunk = payload[start : start + BACKFILL_CHUNK_SIZE]
        job_config = QueryJobConfig(
            query_parameters=[
                ArrayQueryParameter("rows", BACKFILL_STRUCT_TYPE, backfill_struct_params(chunk)),
            ]
        )
        client.query(query, job_config=job_config).result()


def purge_orphan_predictions() -> None:
    client = get_bigquery_client()
    query = f"""
        DELETE FROM `{BACKFILL_TABLE_ID}` AS t
        WHERE NOT EXISTS (
            SELECT 1
            FROM `{FEATURES_TABLE_ID}` AS f
            WHERE f.mention_id = t.mention_id
        )
    """
    job = client.query(query)
    job.result()
    deleted = job.num_dml_affected_rows or 0
    logger.info("Purged orphan predictions", deleted=deleted)


def search_posts(keyword: str, limit: int = 20) -> list[dict]:
    client = get_bigquery_client()
    query = f"""
        SELECT
            post_id,
            title,
            url,
            published_at,
            ARRAY_AGG(
                STRUCT(model, sentiment_label)
                ORDER BY sentiment_score DESC
            ) AS aspect_sentiment_pairs
        FROM `{TABLE_ID}`
        WHERE REGEXP_CONTAINS(@keyword, pattern)
            OR LOWER(full_text) LIKE CONCAT('%', LOWER(@keyword), '%')
        GROUP BY post_id, title, url, published_at
        ORDER BY published_at DESC
        LIMIT @limit
    """
    job_config = QueryJobConfig(
        query_parameters=[
            ScalarQueryParameter("keyword", "STRING", keyword),
            ScalarQueryParameter("limit", "INT64", limit),
        ]
    )

    results = []
    for row in client.query(query, job_config=job_config).result():
        row_dict = dict(row)
        row_dict["aspect_sentiment_pairs"] = [
            AspectSentimentPair.model_validate(p)
            for p in row_dict["aspect_sentiment_pairs"]
        ]
        results.append(SearchResult.model_validate(row_dict))
    return results


def check_bigquery_connection() -> bool:
    try:
        client = get_bigquery_client()
        query = f"SELECT 1 as test FROM `{TABLE_ID}` LIMIT 1"
        results = list(client.query(query).result())
        return len(results) > 0
    except gcp_exceptions.NotFound:
        logger.warning("Gold table not found (empty dataset?)", dataset=settings.BQ_DATASET_NAME)
        return True
    except Exception as exc:
        logger.error("BigQuery health check failed", error=str(exc))
        return False

import time

import structlog
from database import (
    check_bigquery_connection,
    purge_orphan_predictions,
    query_null_sentiment_posts,
    update_sentiments_bulk,
)
from inference import (
    inference_health_check,
    query_sentiment,
)

from config import InferenceBackend, settings

logger = structlog.get_logger(__name__)

HF_THROTTLE_SECONDS = 0.5
PROGRESS_EVERY = 25


def backfill_sentiments(model: str = '', days: int = 7, limit: int | None = None) -> None:
    if not check_bigquery_connection():
        logger.error("BigQuery connection failed.")
        return
    if not inference_health_check():
        logger.error("Inference backend connection failed.")
        return

    posts = query_null_sentiment_posts(model, days)
    if limit:
        posts = posts[:limit]

    if not posts:
        logger.debug("No posts with NULL sentiment to backfill.")
        return

    purge_orphan_predictions()
    logger.info("Starting backfill", total=len(posts))

    succeeded = 0
    failed = 0
    start = time.perf_counter()
    payload = []
    for idx, post in enumerate(posts, start=1):
        text = post["full_text"]
        aspect = post["mention"]
        score = query_sentiment(text, aspect=aspect)

        if score is None:
            failed += 1
            continue

        label = "Positive" if score >  0.15 \
           else "Negative" if score < -0.15 \
           else "Neutral"
        payload.append({
            "mention_id": post["mention_id"],
            "score": score,
            "label": label,
        })
        succeeded += 1

        if idx % PROGRESS_EVERY == 0:
            elapsed = time.perf_counter() - start
            logger.debug(
                "Progress",
                count=idx,
                average_time=f"{elapsed / idx:.2f}s",
            )

        if settings.INFERENCE_BACKEND == InferenceBackend.HUGGINGFACE:
            time.sleep(HF_THROTTLE_SECONDS)

    update_sentiments_bulk(payload)

    elapsed = time.perf_counter() - start
    logger.info(
        "Backfill complete",
        total=len(posts),
        succeeded=succeeded,
        failed=failed,
        elapsed=f"{elapsed:.2f}s",
    )


if __name__ == "__main__":
    backfill_sentiments()

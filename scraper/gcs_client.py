import json
from typing import Any

import structlog
from google.cloud import storage

from config import settings

logger = structlog.get_logger(__name__)


def get_gcs_client() -> storage.Client:
    try:
        client = storage.Client(project=settings.GCP_PROJECT_ID)
        return client
    except Exception as exc:
        logger.error("Failed to initialize Google Cloud Storage client", error=str(exc))
        raise


def upload_jsonl(records: list[dict[str, Any]], date: str, hour: str) -> None:
    client = get_gcs_client()
    bucket = client.bucket(settings.GCS_BUCKET_NAME)
    blob = bucket.blob(f"ingest_date={date}/{hour}.jsonl")
    blob.upload_from_string(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n",
        content_type="application/jsonl",
    )

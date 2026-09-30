from functools import lru_cache
from pathlib import Path

import structlog
from httpx2 import Client, HTTPStatusError, RequestError

from config import InferenceBackend, settings

logger = structlog.get_logger(__name__)


LOCAL_MODEL_DIR = Path(__file__).resolve().parent / "model_artifacts"
HF_BASE_URL = "https://router.huggingface.co/hf-inference/models"
HF_HEADERS = {
    "Authorization": f"Bearer {settings.HUGGINGFACE_API_KEY.get_secret_value()}",
    "Content-Type": "application/json",
}


def _parse_sentiment_result(result) -> float | None:
    second_res = None
    while isinstance(result, list) and result:
        if len(result) > 1:
            second_res = result[1]
        result = result[0]

    if isinstance(result, dict):
        label = result.get("label", "").lower()
        confidence = float(result.get("score", 0.0))
        if "neu" in label:
            if not second_res:
                return 0.0
            label = second_res.get("label", "").lower()
            confidence = confidence * 0.15

        if "neg" in label:
            return -confidence
        if "pos" in label:
            return confidence
        logger.warning("Unexpected sentiment response", response=result)

    if isinstance(result, (int, float)):
        return float(result)

    logger.warning("Unexpected sentiment response", response=result)
    return None


@lru_cache(maxsize=1)
def _local_sentiment_pipeline():
    try:
        from transformers import pipeline
    except ImportError:
        logger.error("Could not import 'transformers'. Try: pip install transformers[torch]")
        raise

    model_path = str(LOCAL_MODEL_DIR / settings.SENTIMENT_MODEL_ID)
    logger.info("Loading local sentiment model", path=model_path)

    return pipeline(
        task="text-classification",
        model=model_path,
        tokenizer=model_path,
    )


def _query_sentiment_local(text: str, aspect: str) -> float | None:
    pipeline = _local_sentiment_pipeline()
    result = pipeline(text, text_pair=aspect)
    if not result:
        return None
    return _parse_sentiment_result(result)


def _query_sentiment_hf(text: str, aspect: str) -> float | None:
    with Client(timeout=30.0) as client:
        resp = client.post(
            f"{HF_BASE_URL}/{settings.SENTIMENT_MODEL_ID}",
            json={"inputs": text, "parameters": {"text_pair": aspect}},
            headers=HF_HEADERS,
        )
        resp.raise_for_status()
        return _parse_sentiment_result(resp.json())


def query_sentiment(text: str, aspect: str) -> float | None:
    try:
        if settings.INFERENCE_BACKEND == InferenceBackend.LOCAL:
            try:
                return _query_sentiment_local(text, aspect)
            except Exception as exc:
                logger.warning(
                    "Local inference failed; falling back to Hugging Face",
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
        return _query_sentiment_hf(text, aspect)

    except HTTPStatusError as exc:
        logger.error("Sentiment HTTP error", status=exc.response.status_code)
        raise
    except RequestError as exc:
        logger.error("Sentiment request error", error=str(exc))
        raise
    except Exception as exc:
        logger.error("Sentiment error", error=str(exc))
        raise


def inference_health_check() -> bool:
    try:
        if settings.INFERENCE_BACKEND == InferenceBackend.LOCAL:
            model_path = LOCAL_MODEL_DIR / settings.SENTIMENT_MODEL_ID
            return model_path.exists()

        with Client(timeout=10.0) as client:
            resp = client.get(
                f"{HF_BASE_URL}/{settings.SENTIMENT_MODEL_ID}",
                headers=HF_HEADERS,
            )
        return resp.status_code in (200, 400, 405)
    except Exception:
        return False

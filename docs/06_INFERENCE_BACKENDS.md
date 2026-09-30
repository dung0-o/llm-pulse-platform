# Inference backends

The API can classify sentiment through two different backends. The choice is made at runtime by a single environment variable, so the same code runs against a remote API or a locally-hosted model without modification.

## Configuration

```dotenv
INFERENCE_BACKEND=huggingface   # or "local"
```

Both values are accepted by the `InferenceBackend` enum in `api/inference.py`:

```python
class InferenceBackend(str, Enum):
    HUGGINGFACE = "huggingface"
    LOCAL = "local"
```

The backend is read once per request, not cached at import, so a container restart with a changed variable takes effect immediately.

## The two backends

| | `huggingface` | `local` |
| :--- | :--- | :--- |
| **Runs on** | Hugging Face's infrastructure | The same container as the API |
| **Auth** | `HUGGINGFACE_API_KEY` | None |
| **Model source** | A Hub model ID | A directory on disk |
| **Latency** | 1–3 s | 100–500 ms on CPU |
| **Cost** | Free tier: ~30k requests/month | Cloud Run vCPU seconds |
| **Cold start** | None | Model load (~5–30 s, once per instance) |
| **Image size** | ~250 MB | ~2.5 GB with the model baked in |
| **Offline capable** | No | Yes |
| **Rate limited** | Yes | No |

## Hugging Face backend

### How it works

```python
def _query_sentiment_hf(text: str, aspect: str) -> float | None:
    with Client(timeout=30.0) as client:
        resp = client.post(
            f"{HF_BASE_URL}/{settings.SENTIMENT_MODEL_ID}",
            json={"inputs": text, "parameters": {"text_pair": aspect}},
            headers=HF_HEADERS,
        )
        resp.raise_for_status()
        return _parse_sentiment_result(resp.json())
```

A single HTTPS POST to the Serverless Inference API. The payload uses `text_pair` because the model is an aspect-based classifier: `inputs` is the post text, `text_pair` is the aspect (the model name).

### Response parsing

The Inference API returns different shapes depending on the model family. The parser handles all three:

| Shape | Example | Source |
| :--- | :--- | :--- |
| Nested list | `[[{"label": "Positive", "score": 0.92}]]` | Batch endpoint |
| Flat list | `[{"label": "Positive", "score": 0.92}]` | Single-input endpoint |
| Dict | `{"label": "Positive", "score": 0.92}` | Older responses |

```python
def _parse_sentiment_result(result) -> float | None:
    if isinstance(result, list) and result:
        result = result[0]

    if isinstance(result, dict):
        label = result.get("label", "").lower()
        confidence = float(result.get("score", 0.0))
        if "neg" in label:
            return -confidence
        if "pos" in label:
            return confidence
        if "neu" in label:
            return 0.0
        logger.warning("Unexpected sentiment response", response=result)

    if isinstance(result, (int, float)):
        return float(result)

    logger.warning("Unexpected sentiment response", response=result)
    return None
```

The `"neg" in label` check handles `Negative`, `NEGATIVE`, and `LABEL_0`. The `"pos" in label` check handles `Positive`, `POSITIVE`, and `LABEL_1`. Anything else maps to neutral.

### Rate limits

The free tier allows roughly 30,000 requests per month. The backfill job runs a request per unscored mention, so at 1,400 Gold rows and a weekly backfill, monthly usage is well under the limit.

Even at a generous schedule of running every 6 hours, the scraper produces ~100 posts per run, of which ~1/3 mention a tracked family. That is ~33 backfill requests per run, or ~4,000 per month.

### Failure modes

| Failure | Response | Handling |
| :--- | :--- | :--- |
| Model loading (cold) | `503` with `{"estimated_time": 20}` | Retry after the estimated time |
| Rate limited | `429` | Backfill sleeps and retries |
| Invalid model ID | `404` | Fails loudly; check `SENTIMENT_MODEL_ID` |
| Auth failure | `401` | Fails loudly; check `HUGGINGFACE_API_KEY` |
| Timeout | `httpx.TimeoutException` | Falls through to the outer handler, re-raises |

## Local backend

### How it works

```python
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
```

The `transformers` pipeline is loaded lazily on the first request and cached in-process via `lru_cache`. On Cloud Run, each container instance loads the model once, then serves subsequent requests from memory.

### Why `lru_cache` matters

Without it, every request would reload a ~1.7 GB model. With it, the load happens once per process, and the first request after a cold start absorbs the ~5–30 second penalty. Subsequent requests are dominated by inference (~100–500 ms on CPU).

The cache is keyed on no arguments, so `maxsize=1` is correct - there is exactly one pipeline per process.

### Model location

```
api/model_artifacts/
└── yangheng/
    └── deberta-v3-base-absa-v1.1/
        ├── config.json
        ├── pytorch_model.bin
        ├── tokenizer.json
        └── ...
```

This path is gitignored. The model is downloaded at image build time by the Dockerfile, or mounted as a volume in local development.

### Memory requirements

| Model | Disk | RAM (FP32) | RAM (FP16) |
| :--- | :--- | :--- | :--- |
| `deberta-v3-base-absa-v1.1` | 1.7 GB | ~2.5 GB | ~1.5 GB |

For Cloud Run, this requires at least `memory: 2Gi`. The current service YAML uses `512Mi` because it runs the Hugging Face backend. Switching to `local` requires bumping memory and rebuild time.

## The fallback path

When `INFERENCE_BACKEND=local`, a failure in the local pipeline falls through to the Hugging Face backend:

```python
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
    ...
```

The inner `except Exception` is deliberate. It catches every failure that indicates the local pipeline is broken - missing model files, out-of-memory errors, corrupted weights, invalid inputs - while letting `KeyboardInterrupt` and `SystemExit` propagate. Those two inherit from `BaseException`, not `Exception`, so a Ctrl+C stops the process instead of triggering a spurious fallback.

The fallback is only useful when the Hugging Face API is configured. If `HUGGINGFACE_API_KEY` is unset, the fallback will fail too, and the original local error is logged but not re-raised. This is intentional: the caller gets a `None` (unscored), the backfill skips the row, and the next run retries.

## Choosing a backend

### Use `huggingface` when

- Deploying to Cloud Run with the free tier (512 MiB memory, no GPU)
- Iterating on the pipeline and not wanting to rebuild the image for every model change
- Running the backfill from a machine where you do not want to store the model weights

### Use `local` when

- Offline inference is required
- Comparing two fine-tuned models and want to avoid uploading both to the Hub
- Running the backfill on a machine with a GPU (the local backend uses it automatically if available)
- Deterministic latency is important, independent of Hugging Face's queue

### Use both

The setting is per-process, not per-request. You cannot mix within a single backfill run. To compare, run twice:

```bash
INFERENCE_BACKEND=huggingface python -m jobs.backfill --days 7 --dry-run
INFERENCE_BACKEND=local       python -m jobs.backfill --days 7 --dry-run
```

The `--dry-run` flag logs the score without writing to BigQuery.

## Local development

### Download the model

```bash
pip install huggingface_hub
hf download yangheng/deberta-v3-base-absa-v1.1 \
  --local-dir api/model_artifacts/yangheng/deberta-v3-base-absa-v1.1
```

`LOCAL_MODEL_DIR` defaults to `api/model_artifacts/`, and the pipeline path is `LOCAL_MODEL_DIR / SENTIMENT_MODEL_ID`. The `yangheng/` prefix in the download destination matches the model ID's namespace.

### Verify the backend loads

```bash
cd api
INFERENCE_BACKEND=local python -c "
from inference import query_sentiment
print(query_sentiment('Qwen 3.8 is incredibly fast', aspect='Qwen-3.8'))
"
```

Expected: a float between `0.7` and `1.0`. If the output is `None`, check the model directory exists.

The first run downloads nothing (the CLI already did) but loads the model into RAM, which takes 5–15 seconds. Subsequent runs within the same process return instantly.

## Docker considerations

### Image size

| Backend | Dockerfile | Image size |
| :--- | :--- | :--- |
| `huggingface` | Current | ~250 MB |
| `local` (ONNX, int8) | Custom | ~600 MB |
| `local` (PyTorch FP32) | Custom | ~2.5 GB |

The `huggingface` backend keeps the API image small. It excludes `transformers`, `torch`, and the model weights, none of which are needed when inference happens remotely.

### Enabling the local backend

Two changes are required:

1. Add the model download step to the Dockerfile:

```dockerfile
RUN python -c "
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='yangheng/deberta-v3-base-absa-v1.1',
    local_dir='model_artifacts/yangheng/deberta-v3-base-absa-v1.1',
)
"
```

2. Update the Cloud Run service YAML:

```yaml
- name: INFERENCE_BACKEND
  value: "local"
```

And bump memory:

```yaml
resources:
  limits:
    memory: 2Gi   # was 512Mi
```

### Cold start impact

| Backend | Cold start | Warm request |
| :--- | :--- | :--- |
| `huggingface` | ~3 s | ~250 ms |
| `local` (ONNX) | ~8 s | ~150 ms |
| `local` (PyTorch) | ~30 s | ~400 ms |

The ONNX path is worth pursuing once the model is fine-tuned and stable. It avoids the PyTorch dependency entirely and produces faster inference on CPU.

## Environment variables

| Variable | Used by | Notes |
| :--- | :--- | :--- |
| `INFERENCE_BACKEND` | Both | `huggingface` or `local` |
| `SENTIMENT_MODEL_ID` | Both | Hub model ID for HF; subdirectory name for local |
| `HUGGINGFACE_API_KEY` | Hugging Face | Required for the HF backend |

The health check reports the backend state at `/health`:

```json
{ "model": "ready" }
```

`ready` means the HF endpoint responded or the local model directory exists. It does not load the local model - that would make the health check slow and expensive.

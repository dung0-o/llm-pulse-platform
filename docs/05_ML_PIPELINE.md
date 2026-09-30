# ML pipeline

> **Status: planned, not implemented.** The current production pipeline uses the public `yangheng/deberta-v3-base-absa-v1.1` model via the Hugging Face Inference API. This document describes the fine-tuning plan that will replace it.

## Motivation

The public DeBERTa model was trained on restaurant and laptop reviews. It handles general English sentiment well, but it has never seen the vocabulary of the local-LLM community:

- **Model names as aspects.** "Qwen 3.8 is great" needs the model to associate sentiment with the aspect `Qwen 3.8`, not to classify the sentence as a whole.
- **Technical jargon.** `Q4_K_M`, `GGUF`, `llama.cpp`, `RoPE scaling`, `context window` - none of these appear in restaurant reviews.
- **Comparison structure.** "Qwen is fast but Gemma is slow" is a single sentence with two opposing sentiments. A generic classifier returns one label.

The fine-tuned model will be evaluated against the current public model on a held-out test set. The target is a measurable improvement in F1 on community posts.

## Planned architecture

```
config/models.yaml
        │
        ▼
scripts/generate_training_set.py       ← Sample posts from gold_post_features
        │
        ▼
data/labeled/train.csv                 ← Manually annotated (aspect, text, label)
        │
        ├──► data/splits/train.csv
        ├──► data/splits/val.csv
        └──► data/splits/test.csv
                │
                ▼
        training/train_qlora.py        ← QLoRA on Qwen3-4B-Instruct
                │
                ▼
        training/evaluate.py           ← F1, confusion matrix, error analysis
                │
                ▼
        export/merge_lora.py           ← Merge adapter into base
                │
                ├──► ONNX export for local inference
                └──► GGUF export for llama.cpp / Ollama
```

## Dataset

### Collection

Sample from `gold_post_features` where `sentiment_score IS NOT NULL`:

```sql
SELECT
  mention_id,
  mention AS aspect,
  model_input_text AS text
FROM `gold_post_features`
WHERE sentiment_score IS NOT NULL
  AND LENGTH(model_input_text) BETWEEN 100 AND 2000
ORDER BY RAND()
LIMIT 500;
```

500 rows is the initial target. The current public model's predictions become the seed labels, which are then manually corrected.

### Annotation

Each row receives a label in `{Positive, Negative, Neutral}` **relative to the aspect**, not the post.

Guidelines:

| Label | Criteria |
| :--- | :--- |
| Positive | The post expresses clear approval, praise, or a recommendation of the aspect |
| Negative | Clear criticism, a bug report, a performance complaint, or a warning |
| Neutral | Factual discussion, a question, a benchmark table without a verdict, or a post that mentions the aspect in passing |

Ambiguous rows are dropped, not forced into a label. A dataset of 300 clean rows outperforms 500 noisy ones.

### Augmentation

Two techniques are planned for the initial 250-row phase:

1. **Easy Data Augmentation (EDA)** - synonym replacement, random insertion, random swap, random deletion. Applied only to the text, never to the aspect. Target: 3× the seed set.
2. **LLM-generated synthetic examples** - Qwen3-4B-Instruct prompted to generate Reddit-style posts for a given (aspect, sentiment) pair. Each generated example is manually reviewed before inclusion.

Augmented and synthetic rows are kept in a separate split and mixed into training at a lower weight, so the model does not over-index on synthetic patterns.

### Splits

| Split | Fraction | Purpose |
| :--- | :--- | :--- |
| Train | 70% | Weight updates |
| Validation | 15% | Early stopping, hyperparameter tuning |
| Test | 15% | Final evaluation only |

Stratified by label. The test set is locked before training and never inspected until the final evaluation.

## Training

### Base model

**Qwen3-4B-Instruct.** Chosen over Llama-3.2-3B after a head-to-head benchmark on sentiment classification:

| Model | Fine-tuned F1 (benchmark) | Notes |
| :--- | :--- | :--- |
| Qwen3-4B-Instruct | 86.4 | Top-ranked in the tested set |
| Llama-3.2-3B-Instruct | 84.7 | Strong but consistently behind |

Both fit within the Hugging Face free tier (under 10 GB) and both fine-tune on a free Colab T4 via QLoRA.

### Method

**QLoRA.** The base model is quantized to 4-bit, and LoRA adapters are trained on top. This reduces the trainable parameter count to under 1% of the full model and fits in 16 GB of VRAM.

Planned configuration:

| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Quantization | 4-bit NF4 | Standard for QLoRA; near-full-precision accuracy |
| LoRA rank (`r`) | 16 | Sufficient for a classification task with ~1,000 examples |
| LoRA alpha | 32 | `2 × r`, the common default |
| LoRA dropout | 0.05 | Light regularization for a small dataset |
| Target modules | `q_proj`, `k_proj`, `v_proj`, `o_proj` | Attention projections; standard for QLoRA |
| Learning rate | 2e-4 | Typical for LoRA adapters |
| Batch size | 4 (effective 16 with gradient accumulation) | Fits T4 memory |
| Epochs | 3 | Early stopping on validation loss |
| Max sequence length | 512 tokens | Matches the context window from `gold_post_features` |

### Environment

Google Colab free tier (T4, 16 GB VRAM). The full training run for 1,000 examples at the above configuration is estimated at 30–45 minutes per epoch.

An alternative environment is `Lightning.ai`'s free tier (L4, 24 GB VRAM), which allows a larger effective batch size and faster iteration.

## Evaluation

### Metrics

| Metric | Why |
| :--- | :--- |
| Macro F1 | Treats all three classes equally; the dataset is likely imbalanced |
| Per-class precision and recall | Detects a model that predicts Neutral for everything |
| Confusion matrix | Shows which classes are confused with which |
| Accuracy | Comparable to the benchmark numbers |

### Baseline

The current public model (`yangheng/deberta-v3-base-absa-v1.1`) is evaluated on the same test set. The fine-tuned model must beat this baseline on macro F1 by a meaningful margin, or the fine-tuning effort was not worth the complexity.

### Error analysis

After evaluation, 20 misclassified examples are read manually. The categories that emerge are documented in `ml/evaluation/error_analysis.md`. Common categories anticipated:

- **Mixed sentiment** - one sentence with positive and negative clauses toward the same aspect.
- **Sarcasm** - "Oh great, another model that can't count tokens."
- **Technical neutrality** - benchmark tables with no verdict.
- **Aspect ambiguity** - "it" referring to a model mentioned three sentences earlier.

Each category suggests a specific next step: more training data, a different prompt format, or a different model altogether.

## Export

Three artifacts are produced after training:

| Artifact | Format | Purpose |
| :--- | :--- | :--- |
| `adapters/` | PEFT adapter weights | Source of truth; can be applied to any compatible base |
| `onnx/` | ONNX graph | CPU inference in the API container |
| `gguf/` | GGUF quantized | Local inference via llama.cpp or Ollama |

### ONNX export

For the Cloud Run deployment path. The model is exported with `optimum`:

```python
from optimum.onnxruntime import ORTModelForSequenceClassification
model = ORTModelForSequenceClassification.from_pretrained(merged_path, export=True)
model.save_pretrained("onnx/")
```

The exported model is ~250 MB at int8 quantization. It is baked into the API Docker image and loaded at container start.

### GGUF export

For local development and the `INFERENCE_BACKEND=local` path. Exported with `llama.cpp`'s conversion scripts, quantized to Q4_K_M for a balance of size and accuracy.

## Integration

Once trained, the model replaces the public one in two places:

| Backend | Configuration | Notes |
| :--- | :--- | :--- |
| `huggingface` | Update `SENTIMENT_MODEL_ID` to the uploaded model repo | Push the merged model to the Hugging Face Hub |
| `local` | Point `LOCAL_SENTIMENT_MODEL_PATH` to the ONNX directory | Requires rebuilding the API image with the model baked in |

The `INFERENCE_BACKEND` toggle means the two paths can coexist. The backfill job reads the setting and dispatches accordingly.

## Reproducibility

Every training run is logged:

| Item | Where |
| :--- | :--- |
| Hyperparameters | `ml/training/config.yaml` (committed) |
| Seed | Fixed at 42 in `train_qlora.py` |
| Dataset hash | SHA256 of `data/splits/train.csv`, logged at run start |
| Metrics | Written to `ml/evaluation/metrics.json` |
| Adapter weights | Saved to a run-specific directory, not overwritten |

Two runs with the same config and dataset hash produce the same adapter weights, subject to nondeterminism in CUDA kernels. The dataset hash is the important one - it makes "which data trained this model?" answerable months later.

## Open questions

- **Data volume.** 250 labeled examples is a proof of concept, not a production model. The target is 1,000+. The constraint is annotation time, not compute.
- **Label granularity.** Should Neutral be a separate class, or should the classifier predict only Positive/Negative and let a confidence threshold emit Neutral? This is testable and undecided.
- **Aspect formatting.** `Qwen-3.8` vs `Qwen 3.8` vs `qwen3.8` - the training data uses one form; the inference path must normalize to the same form. Not yet decided.
- **Model size.** 4B parameters is the current target. A 1–2B model may perform nearly as well for classification, run faster, and fit in a smaller Cloud Run instance. Worth testing once the 4B baseline exists.

## Timeline

| Phase | Deliverable | Status |
| :--- | :--- | :--- |
| 1. Dataset collection | 500 sampled rows | Not started |
| 2. Annotation | 300 labeled rows | Not started |
| 3. Baseline evaluation | Public model metrics on test set | Not started |
| 4. QLoRA training | Adapter weights | Not started |
| 5. Evaluation | Metrics + error analysis | Not started |
| 6. Export | ONNX + GGUF artifacts | Not started |
| 7. Integration | API serving the fine-tuned model | Not started |

This document will be rewritten with actual results - metrics, configuration, and lessons learned - once phases 1 through 7 are complete.

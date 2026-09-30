# ADR-002: Separate feature and prediction tables

**Status:** Accepted
**Date:** 2026-09-20

## Context

The Gold layer contains two kinds of data:

1. **Features** - the post text, the extracted mention, the context window, the comparison flag. These are deterministic functions of Bronze and Silver. Running the same dbt model twice produces the same rows.
2. **Predictions** - the sentiment score and label for each mention. These come from an external model, cost money to compute, and are not reproducible from the source data without re-running inference.

An early prototype stored both in a single table, `gold_model_features`, with `sentiment_score` and `sentiment_label` columns initialized as `NULL` and updated by the backfill job.

This failed in a specific way: `dbt run --full-refresh` on `gold_model_features` rewrote every partition from Silver. Silver contains no sentiment data, so every score was set back to `NULL`. The expensive ML output was destroyed by a routine transformation run.

## Decision

We split the data into two tables:

- **`gold_post_features`** - owned by dbt. Rebuilt from Silver on every run. Contains no sentiment columns.
- **`gold_sentiment_predictions`** - owned by the backfill job. Written via `MERGE`. Never touched by dbt.

The two are joined by a **view**, `gold_post_enriched`, which the API reads. The view contains no storage of its own.

## Consequences

### Positive

- **dbt rebuilds cannot destroy predictions.** A `--full-refresh` resets features, and the predictions table is untouched. The next API request sees features and predictions joined correctly.
- **Clear ownership.** dbt owns one table; the ML pipeline owns the other. No shared writes, no coordination.
- **Model swap without dbt changes.** Replacing the sentiment model changes only the backfill job. The dbt project has no knowledge of which model is in use.
- **Independent retention.** Predictions can be kept forever (they are tiny) while feature partitions expire after 90 days.
- **Standard pattern.** This is the feature-store / prediction-store split used in production ML systems. A reviewer recognises it immediately.

### Negative

- **One more table.** Two tables and a view instead of one table. The API queries the view, which adds a join to every read.
- **Orphan risk.** If a `mention_id` is removed from features (because a regex changed), the prediction becomes an orphan. It sits in the predictions table indefinitely until purged.
- **View performance.** The `gold_post_enriched` view joins 1,400 feature rows with 1,400 prediction rows on every query. At this scale the join is negligible; at 10M rows it would need materializing.

### Neutral

- The orphan risk is handled by `purge_orphan_predictions()` in the backfill job, which runs before every batch. A dbt test (`assert_no_orphan_predictions`) catches the drift when it occurs, and `make backfill` repairs it.

## Alternatives considered

| Alternative | Why rejected |
| :--- | :--- |
| Single table with sentiment columns, updated by backfill | dbt `--full-refresh` wipes the columns; requires COALESCE against a shadow copy of the old table |
| Single incremental table with merge on `mention_id` | dbt model reads its own previous output - non-idempotent, breaks on deletion |
| Materialize predictions in GCS and reload | Adds a round trip; the predictions table is small enough to live in BigQuery |
| Write sentiment to a partitioned copy of the feature table | Duplicates feature data; two tables hold the same columns |

## References

- [docs/01_DATA_MODEL.md](../01_DATA_MODEL.md)
- [docs/02_DBT_TRANSFORMATIONS.md](../02_DBT_TRANSFORMATIONS.md)
- [docs/05_ML_PIPELINE.md](../05_ML_PIPELINE.md)

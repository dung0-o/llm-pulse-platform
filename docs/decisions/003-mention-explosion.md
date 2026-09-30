# ADR-003: Mention explosion

**Status:** Accepted
**Date:** 2026-09-25

## Context

A single Reddit post often mentions multiple model families. "Qwen 3.8 is impressive but Gemma 4 is not" is one post with two opinions. A post titled "Comparing Qwen, Llama, and DeepSeek" mentions three.

The sentiment classifier is aspect-based: it returns sentiment toward a specific target. To classify Qwen and Gemma in the same post, the model must be called twice, once per aspect.

Storing one row per post would require storing an array of sentiments. Querying "what is the average sentiment for Qwen?" would then require unnesting arrays in every query.

## Decision

**One row per mention.** A post that mentions two families produces two rows in `gold_post_features`, each with a distinct `mention_id`.

`mention_id` is derived as `CONCAT(post_id, '-', mention)`, where `mention` is the family and version concatenated (`Qwen-3.8`). The ID is deterministic - same post, same extraction, same ID - and it is the primary key for the MERGE in the backfill.

A column `total_families_mentioned` records how many families appeared in the post, and a derived `is_comparison_post` boolean marks posts with more than one.

## Consequences

### Positive

- **Clean querying.** `/leaderboard` groups by `mention` and averages `sentiment_score`. No array unnesting.
- **Independent sentiment.** Each mention has its own score, based on its own context window. A post that praises one model and criticizes another produces two distinct data points.
- **Derived key.** No sequence, no UUID, no coordination. The key is a pure function of the post and the extracted mention.
- **Comparison detection is free.** The window function that counts rows per post also computes `is_comparison_post`.

### Negative

- **Orphan risk.** A `mention_id` is `post_id || '-' || mention`. If `mention` changes - a regex fix, a version normalization change - every affected ID changes, and predictions for the old IDs become orphans. This is handled by `purge_orphan_predictions()` in the backfill, and by the `assert_no_orphan_predictions` dbt test.
- **Row count.** A 1,400-post Gold table becomes ~1,900 mention rows. The multiplication factor is small at this scale but grows with post length and family coverage.
- **Sentiment is diluted in comparison posts.** A post that says "Qwen is great, Gemma is not" produces a positive score for Qwen and a negative one for Gemma, but a naive average across mentions would see them cancel. The Vibe Score applies a comparison penalty to correct for this (see ADR-009).

### Neutral

- The Gold model explodes mentions with a `CROSS JOIN` against the family pattern list, filtered by `REGEXP_CONTAINS`. This is a standard pattern and scales to hundreds of families.

## Alternatives considered

| Alternative | Why rejected |
| :--- | :--- |
| **One row per post, with an array of sentiments** | Every query that filters by mention would need `UNNEST`; array functions are awkward in BigQuery |
| **One row per post, sentiment for the most-mentioned family only** | Loses information; a post mentioning two models equally would arbitrarily favour one |
| **One row per post per mention, with a synthetic sequence** | Requires row numbering in the Gold model, which is non-deterministic across runs |
| **Sentiment stored in a separate key-value table** | Adds a join to every query; loses the mention as a first-class column |

## References

- [docs/01_DATA_MODEL.md](../01_DATA_MODEL.md)
- [docs/02_DBT_TRANSFORMATIONS.md](../02_DBT_TRANSFORMATIONS.md)

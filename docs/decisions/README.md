# Decision records

Architecture Decision Records (ADRs) for the Local LLM Sentiment Tracker.

## What this folder is

Each file documents one decision: the context that made it necessary, the decision itself, and the consequences that followed.

## Format

Every ADR follows the [Michael Nygard format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):

| Section | Answers |
| :--- | :--- |
| **Status** | Is this proposed, accepted, deprecated, or superseded? |
| **Context** | What situation forced a decision? What were the constraints? |
| **Decision** | What was chosen? State it in the active voice. |
| **Consequences** | What follows? Include the negative ones. An ADR without downsides is marketing. |

## When to write one

Write an ADR when:

- The choice was **non-obvious** - a reasonable engineer could have chosen differently.
- The choice **constrains future work** - reversing it would require real effort.
- The choice has **negative consequences** worth recording.

## Index

| ADR | Decision | Status |
| :--- | :--- | :--- |
| [001](001-elt-over-etl.md) | ELT over ETL: transform in the warehouse, not before | Accepted |
| [002](002-separate-feature-and-prediction-tables.md) | Separate dbt-owned features from ML-owned predictions | Accepted |
| [003](003-mention-explosion.md) | One row per mention, not per post | Accepted |

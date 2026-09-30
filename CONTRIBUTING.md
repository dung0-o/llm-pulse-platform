# Contributing

## Setup

See the Quick start section in [README.md](README.md).

## Before opening a PR

```bash
make install      # once
make test         # must pass
ruff check .      # must be clean
```

CI runs the same commands. If `make test` passes locally and CI fails, check the logs - the failure is usually an environment difference (Python patch version, Node minor version) rather than a code issue.

## Style

- Python: `ruff` with the rules in `pyproject.toml`. Line length 100.
- TypeScript: `prettier` via the pre-commit hook. Run `npx prettier --write .` if needed.
- Commit messages: imperative mood, present tense (`Add backfill dedup`, not `Added` or `Adds`).

## Adding a model family

1. Add the family to `config/models.yaml`
2. Run `make generate`
3. Commit the updated `config/models.yaml`, `dbt/seeds/models.csv`, and `dashboard/src/lib/models.ts` together
4. The next `dbt build` will pick up the new family

.PHONY: help bootstrap run scraper seed backfill test clean

help:		## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

doctor:  	## Check that all prerequisites are installed
	@missing=0; \
	for cmd in python3 node npm gcloud bq dbt docker envsubst; do \
	  if command -v $$cmd >/dev/null 2>&1; then \
	    printf "  \033[32m✓\033[0m %-10s %s\n" "$$cmd" "$$(command -v $$cmd)"; \
	  else \
	    printf "  \033[31m✗\033[0m %-10s not found\n" "$$cmd"; \
	    missing=1; \
	  fi; \
	done; \
	echo ""; \
	if [ $$missing -eq 1 ]; then \
	  echo "Install missing tools:"; \
	  echo "  gcloud, bq      → https://cloud.google.com/sdk/docs/install"; \
	  echo "  docker          → https://docs.docker.com/get-docker/"; \
	  echo "  python3         → https://www.python.org/downloads/"; \
	  echo "  node, npm       → https://nodejs.org/"; \
	  echo "  dbt             → pip install -r dbt/requirements.txt"; \
	  echo "  envsubst        → sudo apt install gettext"; \
	  exit 1; \
	fi; \
	echo "All prerequisites present."

install:	## Install dev dependencies
	pip install -r requirements-dev.txt
	pip install -r api/requirements.txt
	pip install -r scraper/requirements.txt
	cd dashboard && npm install

bootstrap:  ## Create GCS bucket, datasets, external table
	./scripts/bootstrap_gcp.sh

seed:  		## Regenerate and load the models seed
	./scripts/seed_models.sh

scrape:  	## Run one scrape + dbt + backfill cycle
	./scripts/run_scraper.sh

run:  		## Start FastAPI + Vite
	./scripts/run_local.sh

backfill:  	## Backfill NULL sentiment (local model)
	cd api && python -m jobs.sentiment_backfill --days 30

test:  		## Run all tests
	pytest tests/
	cd dbt && dbt test --profiles-dir .
	cd dashboard && npm run typecheck

clean:  	## Remove generated artifacts
	rm -rf infra/bigquery/.rendered dbt/target dbt/dbt_packages

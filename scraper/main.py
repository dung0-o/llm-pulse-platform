import json
from datetime import datetime
from pathlib import Path

from gcs_client import upload_jsonl
from reddit_scraper import scrape_reddit_posts


def main() -> None:
    current_datetime = datetime.utcnow()
    ingest_date = current_datetime.strftime("%Y-%m-%d")
    ingest_hour = current_datetime.strftime("%H-%M")

    output = scrape_reddit_posts()

    local_path = Path(f"raw_data/ingest_date={ingest_date}/{ingest_hour}.jsonl")
    local_path.parent.mkdir(parents=True, exist_ok=True)

    with open(local_path, "w", encoding="utf-8") as f:
        for item in output:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    upload_jsonl(output, ingest_date, ingest_hour)


if __name__ == "__main__":
    main()

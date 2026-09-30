from datetime import UTC, datetime
from typing import Any

import feedparser
import structlog

from config import settings

logger = structlog.get_logger(__name__)

def scrape_reddit_posts() -> list[dict[str, Any]]:
    feed = feedparser.parse(settings.REDDIT_RSS_URL)
    for entry in feed.entries:
        entry["scraped_at"] = datetime.now(UTC).isoformat()
    logger.info("Finished scraping reddit posts", count=len(feed.entries))
    return feed.entries

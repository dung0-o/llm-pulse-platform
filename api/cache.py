import httpx2
import structlog

from config import settings

logger = structlog.get_logger(__name__)


class RedisClient:
    def __init__(self) -> None:
        self._client: httpx2.Client | None = None


    def _get_client(self) -> httpx2.Client:
        if self._client is None:
            self._client = httpx2.Client(
                base_url=settings.REDIS_URL.get_secret_value(),
                timeout=30.0,
                headers={
                    "Authorization": f"Bearer {settings.REDIS_TOKEN.get_secret_value()}",
                },
            )
        return self._client


    def get(self, key: str) -> str | None:
        try:
            resp = self._get_client().get(f"/get/{key}")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("result"):
                    logger.info("Cache hit", cache_key=key)
                else:
                    logger.info("Cache miss", cache_key=key)
                return data.get("result")

            elif resp.status_code == 404:
                logger.info("Cache miss", cache_key=key)
                return None

            else:
                logger.warning(
                    "Redis GET failed",
                    key=key,
                    status=resp.status_code,
                    response=resp.text,
                )
        except Exception as exc:
            logger.error("Redis GET error", key=key, error=str(exc))
        return None


    def set(self, key: str, value: str, ttl: int) -> None:
        try:
            resp = self._get_client().post(
                f"/set/{key}",
                content=value,
                params={"EX": ttl},
            )
            if resp.status_code != 200:
                logger.warning(
                    "Redis SET failed",
                    key=key,
                    status=resp.status_code,
                    response=resp.text,
                )
        except Exception as exc:
            logger.error("Redis SET error", key=key, error=str(exc))


    def health(self) -> bool:
        resp = self._get_client().get("/get/health")
        return resp.status_code in (200, 404)

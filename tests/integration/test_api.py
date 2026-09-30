
import pytest
from fastapi.testclient import TestClient


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        self.store[key] = value

    def health(self) -> bool:
        return True


@pytest.fixture
def app_client(monkeypatch):
    import main as main_module

    fake_redis = FakeRedis()

    monkeypatch.setattr(main_module, "RedisClient", lambda: fake_redis)
    monkeypatch.setattr(main_module, "query_leaderboard", lambda *a, **k: [])
    monkeypatch.setattr(main_module, "query_post_count", lambda *a, **k: [])
    monkeypatch.setattr(main_module, "query_trend", lambda *a, **k: [])
    monkeypatch.setattr(main_module, "search_posts", lambda *a, **k: [])
    monkeypatch.setattr(main_module, "check_bigquery_connection", lambda: True)
    monkeypatch.setattr(main_module, "inference_health_check", lambda: True)

    app = main_module.create_app()
    return TestClient(app), fake_redis


@pytest.mark.integration
def test_health_reports_all_subsystems(app_client) -> None:
    client, _ = app_client
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "healthy"
    assert body["bigquery"] == "connected"
    assert body["redis"] == "connected"
    assert body["model"] == "ready"


@pytest.mark.integration
def test_leaderboard_returns_empty_ranking(app_client) -> None:
    client, _ = app_client
    r = client.get("/leaderboard?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["ranking"] == []
    assert body["days_analysed"] == 7


@pytest.mark.integration
def test_leaderboard_rejects_days_out_of_range(app_client) -> None:
    client, _ = app_client
    assert client.get("/leaderboard?days=0").status_code == 422
    assert client.get("/leaderboard?days=31").status_code == 422
    assert client.get("/leaderboard?days=200").status_code == 422


@pytest.mark.integration
def test_leaderboard_caches_response(app_client) -> None:
    client, redis = app_client
    client.get("/leaderboard?days=7")
    assert any(k.startswith("leaderboard:") for k in redis.store)


@pytest.mark.integration
def test_refresh_bypasses_cache(app_client, monkeypatch) -> None:
    client, redis = app_client

    calls = {"n": 0}

    def counting_query(*a, **k):
        calls["n"] += 1
        return []

    import main as main_module
    monkeypatch.setattr(main_module, "query_leaderboard", counting_query)

    client.get("/leaderboard?days=7")               # miss → 1 call
    client.get("/leaderboard?days=7")               # hit  → still 1
    client.get("/leaderboard?days=7&refresh=true")  # bypass → 2

    assert calls["n"] == 2


@pytest.mark.integration
def test_search_requires_keyword(app_client) -> None:
    client, _ = app_client
    assert client.get("/search").status_code == 422
    r = client.get("/search?keyword=")
    assert r.status_code == 200

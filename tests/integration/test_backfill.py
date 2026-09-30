
import pytest
from database import update_sentiments_bulk


@pytest.fixture
def fake_bq(monkeypatch):
    import database

    jobs: list = []

    class FakeJob:
        def __init__(self, params):
            self.params = params

        def result(self):
            return iter(())

    class FakeClient:
        def query(self, query, job_config=None):
            jobs.append({"sql": query, "config": job_config})
            return FakeJob(job_config)

    monkeypatch.setattr(database, "get_bigquery_client", lambda: FakeClient())
    return jobs


@pytest.mark.integration
def test_empty_payload_is_a_noop(fake_bq) -> None:
    update_sentiments_bulk([])
    assert fake_bq == []


@pytest.mark.integration
def test_single_batch_issues_one_merge(fake_bq) -> None:
    rows = [
        {"mention_id": "qwen-38", "score": 0.8, "label": "Positive"},
    ]
    update_sentiments_bulk(rows)
    assert len(fake_bq) == 1
    assert "MERGE" in fake_bq[0]["sql"]
    assert "CREATE TEMP TABLE" in fake_bq[0]["sql"]


@pytest.mark.integration
def test_deduplicates_by_mention_id(fake_bq) -> None:
    rows = [
        {"mention_id": "qwen-38", "score": 0.8, "label": "Positive"},
        {"mention_id": "qwen-38", "score": 0.5, "label": "Positive"},
    ]
    update_sentiments_bulk(rows)
    assert len(fake_bq) == 1


@pytest.mark.integration
def test_chunks_large_batches(fake_bq, monkeypatch) -> None:
    import database
    monkeypatch.setattr(database, "BACKFILL_CHUNK_SIZE", 2)

    rows = [
        {"mention_id": f"m-{i}", "score": 0.1, "label": "Positive"}
        for i in range(5)
    ]
    update_sentiments_bulk(rows)
    # 5 rows / chunk size 2 = 3 jobs
    assert len(fake_bq) == 3

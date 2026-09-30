import re
from pathlib import Path

import pytest
import yaml
from generate_model_list import (
    load_models,
    make_regex_pattern,
    write_dbt_seed,
    write_ts,
)


@pytest.mark.unit
@pytest.mark.parametrize(
    ("model", "text", "should_match"),
    [
        # Straightforward hits
        ("Qwen 3.8", "Qwen3.8 is great", True),
        ("Qwen 3.8", "Qwen 3.8 is great", True),
        ("Qwen 3.8", "Qwen-3.8 is great", True),
        ("Qwen 3.8", "qwen3.8", True),
        # Case-insensitivity
        ("Phi 4", "PHI-4 rocks", True),
        ("Llama", "LLAMA is fast", True),
        # Known false positive: "Phi" prefix of "philosophy"
        ("Phi", "philosophy is hard", False),
        ("Phi", "philodendron", False),
        # Model name with a space
        ("Mistral Large", "Mistral Large is strong", True),
        ("Mistral Large", "Mistral-Large is strong", True),
        # Full brand match
        ("Llama", "llama is fun", True),
        # Not present at all
        ("Gemma", "Qwen is fast", False),
    ],
)
def test_make_regex_pattern(model: str, text: str, should_match: bool) -> None:
    pattern = make_regex_pattern(model)
    matched = re.search(pattern, text) is not None
    assert matched is should_match, (
        f"pattern {pattern!r} on {text!r}: expected {should_match}, got {matched}"
    )


@pytest.mark.unit
def test_make_regex_pattern_handles_dotted_versions() -> None:
    pattern = make_regex_pattern("Qwen 3.8")
    for variant in ("Qwen 3.8", "Qwen3.8", "Qwen-3.8", "Qwen3 8"):
        assert re.search(pattern, variant), f"{variant!r} did not match {pattern!r}"


@pytest.mark.unit
def test_make_regex_pattern_anchors_to_word_boundary() -> None:
    pattern = make_regex_pattern("Olmo")
    assert re.search(pattern, "olmo is here") is not None
    assert re.search(pattern, "kolmogorov") is None


@pytest.mark.unit
def test_load_models_exits_on_missing_file(monkeypatch, tmp_path: Path, capsys) -> None:
    import generate_model_list as gen

    monkeypatch.setattr(gen, "SOURCE", tmp_path / "nope.yaml")
    monkeypatch.setattr(gen, "ROOT", tmp_path.parent)
    with pytest.raises(SystemExit) as exc:
        load_models()
    assert exc.value.code == 1
    assert "not found" in capsys.readouterr().err


@pytest.mark.unit
def test_load_models_exits_on_empty_models_list(monkeypatch, tmp_path: Path) -> None:
    import generate_model_list as gen

    source = tmp_path / "models.yaml"
    source.write_text("models: []\n")
    monkeypatch.setattr(gen, "SOURCE", source)
    monkeypatch.setattr(gen, "ROOT", tmp_path.parent)

    with pytest.raises(SystemExit) as exc:
        load_models()
    assert exc.value.code == 1


@pytest.mark.unit
def test_load_models_returns_list(monkeypatch, tmp_path: Path) -> None:
    import generate_model_list as gen

    source = tmp_path / "models.yaml"
    source.write_text(
        yaml.safe_dump({"models": [{"brand": "Qwen", "families": ["Qwen 3.8"]}]})
    )
    monkeypatch.setattr(gen, "SOURCE", source)
    monkeypatch.setattr(gen, "ROOT", tmp_path.parent)

    models = load_models()
    assert isinstance(models, list)
    assert models[0]["brand"] == "Qwen"


@pytest.mark.unit
def test_write_dbt_seed_deduplicates_brand_row(monkeypatch, tmp_path: Path) -> None:
    import generate_model_list as gen

    seed = tmp_path / "models.csv"
    monkeypatch.setattr(gen, "DBT_SEED", seed)
    monkeypatch.setattr(gen, "ROOT", tmp_path.parent)

    write_dbt_seed([{"brand": "Qwen", "families": ["Qwen", "Qwen 3.8"]}])

    import csv

    with seed.open() as f:
        rows = list(csv.DictReader(f))

    assert len(rows) == 2
    assert all(r["brand"] == "Qwen" for r in rows)
    assert {r["model"] for r in rows} == {"Qwen", "Qwen 3.8"}


@pytest.mark.unit
def test_write_dbt_seed_emits_brand_when_no_family_named_brand(
    monkeypatch, tmp_path: Path
) -> None:
    import generate_model_list as gen

    seed = tmp_path / "models.csv"
    monkeypatch.setattr(gen, "DBT_SEED", seed)
    monkeypatch.setattr(gen, "ROOT", tmp_path.parent)

    write_dbt_seed([{"brand": "Mistral", "families": ["Mistral Large"]}])

    import csv

    with seed.open() as f:
        rows = list(csv.DictReader(f))

    assert {r["model"] for r in rows} == {"Mistral", "Mistral Large"}
    brand_row = next(r for r in rows if r["model"] == "Mistral")
    assert brand_row["is_specific_family"] == "False"


@pytest.mark.unit
def test_write_dbt_seed_header(monkeypatch, tmp_path: Path) -> None:
    import generate_model_list as gen

    seed = tmp_path / "models.csv"
    monkeypatch.setattr(gen, "DBT_SEED", seed)
    monkeypatch.setattr(gen, "ROOT", tmp_path.parent)

    write_dbt_seed([])

    with seed.open() as f:
        header = f.readline().strip()
    assert header == "brand,model,is_specific_family,pattern"


@pytest.mark.unit
def test_write_ts_emits_valid_module(monkeypatch, tmp_path: Path) -> None:
    import generate_model_list as gen

    ts_out = tmp_path / "models.ts"
    monkeypatch.setattr(gen, "TS_OUT", ts_out)
    monkeypatch.setattr(gen, "ROOT", tmp_path.parent)

    write_ts(
        [
            {"brand": "Qwen", "families": ["Qwen 3.8", "Qwen 3.6"]},
            {"brand": "Gemma", "families": []},
        ]
    )

    content = ts_out.read_text()
    assert "AUTO-GENERATED" in content
    assert "brand: 'Qwen'" in content
    assert "{ name: 'Qwen 3.8' }" in content
    assert "families: []" in content
    assert "MODEL_BRANDS" in content

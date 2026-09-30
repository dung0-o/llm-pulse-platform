import pytest
from inference import _parse_sentiment_result


@pytest.mark.unit
@pytest.mark.parametrize(
    ("inference_resp", "expected"),
    [
        ({'label': 'Positive', 'score': 0.92}, 0.92),
        ({'label': 'Negative', 'score': 0.92}, -0.92),
        ({'label': 'POSITIVE', 'score': 0.5}, 0.5),
        ({'label': 'NEGATIVE', 'score': 0.5}, -0.5),
        ({'label': 'Neutral', 'score': 0.8}, 0.0),
        ({'label': 'unknown', 'score': 0.8}, None),
        ({'label': '', 'score': 0.8}, None),
        ({'score': 0.8}, None),
        ([0.92, 'Positive'], 0.92),
        (0.92, 0.92),
    ],
)
def test_response_parser(inference_resp, expected) -> None:
    assert _parse_sentiment_result(inference_resp) == pytest.approx(expected)

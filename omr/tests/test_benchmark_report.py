"""Report rendering: denominators visible, aggregate honest."""

from test_benchmark_metrics import GT

from omr.benchmark.metrics import evaluate_chart
from omr.benchmark.report import render_json, render_markdown
from omr.models import BackendInfo


def _results():
    metrics = evaluate_chart(GT, GT, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))
    return [{"slug": "test-chart", "reviewed": True, "metrics": metrics, "notes": []}]


def _backend_info() -> BackendInfo:
    return BackendInfo(
        name="fake", model_id="fake/model", revision="r1", version="0", device="cpu"
    )


def test_markdown_shows_ratios_with_denominators() -> None:
    md = render_markdown(_results(), _backend_info())

    assert "test-chart" in md
    assert "3/3" in md  # pitch ratios shown as num/den
    assert "fake/model" in md
    assert "Aggregate" in md


def test_json_report_is_machine_readable() -> None:
    data = render_json(_results(), _backend_info())

    assert data["backend"]["name"] == "fake"
    chart = data["charts"]["test-chart"]
    assert chart["pitch_strict"]["num"] == 3
    assert chart["pitch_strict"]["den"] == 3
    assert data["aggregate"]["pitch_strict"] == 1.0


def test_unreviewed_ground_truth_flagged_in_markdown() -> None:
    results = _results()
    results[0]["reviewed"] = False
    md = render_markdown(results, _backend_info())

    assert "NOT been human-reviewed" in md


def test_chart_without_chords_renders_na_and_stays_out_of_the_aggregate() -> None:
    # "No chords to score" (den 0 → None → "n/a") must stay distinct from
    # "scored zero" — the point of the Ratio design.
    chordless = [
        type(m)(
            number=m.number,
            notes=list(m.notes),
            chords=[],
            start_repeat=m.start_repeat,
            end_repeat=m.end_repeat,
            rehearsal_mark=m.rehearsal_mark,
        )
        for m in GT
    ]
    metrics = evaluate_chart(
        chordless, chordless, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4)
    )
    results = [{"slug": "no-chords", "reviewed": True, "metrics": metrics, "notes": []}]

    md = render_markdown(results, _backend_info())
    assert "n/a" in md

    data = render_json(results, _backend_info())
    assert data["aggregate"]["chord_exact"] is None

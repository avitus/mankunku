"""Report rendering: denominators visible, aggregate honest."""

from fractions import Fraction

from test_benchmark_metrics import GT

from omr.backends.legato2 import Legato2Backend
from omr.backends.legato_v1 import LegatoV1Backend
from omr.benchmark.metrics import evaluate_chart
from omr.benchmark.report import render_json, render_markdown
from omr.models import BackendInfo, Measure, NoteEvent


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


def test_backend_note_and_missing_model_render_honestly() -> None:
    # LEGATO v1's "NOT LEGATO 2" note must head every report it produces;
    # the unreleased stub has no model to name.
    md = render_markdown(_results(), LegatoV1Backend().model_info())
    assert "> LEGATO v1 experimentation backend — NOT LEGATO 2" in md
    assert "guangyangmusic/legato@" in md

    md = render_markdown(_results(), Legato2Backend().model_info())
    assert "(no model)" in md
    header = md.split("## ", 1)[0]
    assert not any(line.startswith("> ") for line in header.splitlines())


def test_chart_notes_render_as_bullets() -> None:
    results = _results()
    results[0]["notes"] = ["chord metrics reflect a model limitation"]

    md = render_markdown(results, _backend_info())

    assert "- chord metrics reflect a model limitation" in md


def test_bool_scalars_render_yes_no_and_average_as_ratios() -> None:
    hit = evaluate_chart(GT, GT, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))
    miss = evaluate_chart(GT, GT, gt_key="C", pred_key="Bb", gt_ts=(4, 4), pred_ts=(4, 4))
    results = [
        {"slug": "hit", "reviewed": True, "metrics": hit, "notes": []},
        {"slug": "miss", "reviewed": True, "metrics": miss, "notes": []},
    ]

    md = render_markdown(results, _backend_info())
    assert "| Key signature match | yes |" in md
    assert "| Key signature match | NO |" in md
    assert render_json(results, _backend_info())["aggregate"]["key_signature_match"] == 0.5


def test_aggregate_is_an_unweighted_macro_average() -> None:
    # Chart A: 3 of 3 notes right. Chart B: 0 of 1. Macro = 0.5; a pooled
    # (micro) average would report 0.75.
    perfect = evaluate_chart(GT, GT, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))
    wrong_note = Measure(
        number=1,
        notes=[NoteEvent(spelled_pitch="F4", midi=65, onset=Fraction(0), duration=Fraction(1, 2))],
        chords=list(GT[1].chords),
        end_repeat=True,
    )
    wrong = evaluate_chart(
        [GT[1]], [wrong_note], gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4)
    )
    results = [
        {"slug": "a", "reviewed": True, "metrics": perfect, "notes": []},
        {"slug": "b", "reviewed": True, "metrics": wrong, "notes": []},
    ]

    assert render_json(results, _backend_info())["aggregate"]["pitch_strict"] == 0.5

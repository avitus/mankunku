"""Resilient ABC parser tests.

Two families: well-formed lead-sheet ABC must parse exactly; malformed
model output must degrade to warnings + verbatim preservation without
aborting the rest of the score.
"""

from fractions import Fraction

from omr.abc_parser import parse_abc

WELL_FORMED = """X:1
T:Test Tune
T:A Subtitle
C:Tadd Dameron
M:4/4
L:1/8
Q:1/4=160
K:F
"F" F2 A2 c2 A2 | "Bb7" B4 =B4 | B2 z2 (3cde c2- | c8 |]
"""


def test_headers_parse() -> None:
    score, _ = parse_abc(WELL_FORMED)
    h = score.header
    assert h.title == "Test Tune"
    assert h.subtitles == ["A Subtitle"]
    assert h.composer == "Tadd Dameron"
    assert h.meter == (4, 4)
    assert h.unit_length == Fraction(1, 8)
    assert h.tempo == "1/4=160"
    assert h.key_raw == "F"


def test_key_signature_spelling_applied() -> None:
    score, _ = parse_abc(WELL_FORMED)
    # In F major the printed B is Bb unless a natural intervenes.
    bar2 = score.bars[1]
    assert bar2.events[0].spelled_pitch == "Bb4"
    assert bar2.events[1].spelled_pitch == "B4"  # explicit natural


def test_accidental_propagates_within_measure_then_reverts() -> None:
    score, _ = parse_abc(WELL_FORMED)
    # bar 3 starts a NEW measure: the natural from bar 2 no longer applies
    bar3 = score.bars[2]
    assert bar3.events[0].spelled_pitch == "Bb4"


def test_durations_in_whole_note_units() -> None:
    score, _ = parse_abc(WELL_FORMED)
    bar1 = score.bars[0]
    assert bar1.events[0].duration == Fraction(1, 4)  # F2 with L:1/8
    assert score.bars[1].events[0].duration == Fraction(1, 2)  # B4


def test_rest_parsed() -> None:
    score, _ = parse_abc(WELL_FORMED)
    bar3 = score.bars[2]
    rest = bar3.events[1]
    assert rest.kind == "rest"
    assert rest.spelled_pitch is None
    assert rest.duration == Fraction(1, 4)


def test_triplet_scales_durations() -> None:
    score, _ = parse_abc(WELL_FORMED)
    bar3 = score.bars[2]
    triplet_notes = [e for e in bar3.events if e.tuplet == (3, 2)]
    assert len(triplet_notes) == 3
    assert all(e.duration == Fraction(1, 12) for e in triplet_notes)


def test_tie_recorded() -> None:
    score, _ = parse_abc(WELL_FORMED)
    assert score.bars[2].events[-1].tied_to_next is True


def test_chord_strings_attach_to_following_note() -> None:
    score, _ = parse_abc(WELL_FORMED)
    assert score.bars[0].events[0].strings == ["F"]
    assert score.bars[1].events[0].strings == ["Bb7"]


def test_octave_marks() -> None:
    score, _ = parse_abc("X:1\nK:C\nC, C c c' |]\n")
    pitches = [e.spelled_pitch for e in score.bars[0].events]
    assert pitches == ["C3", "C4", "C5", "C6"]
    assert [e.midi for e in score.bars[0].events] == [48, 60, 72, 84]


def test_broken_rhythm() -> None:
    score, _ = parse_abc("X:1\nM:4/4\nL:1/8\nK:C\nC>D E<F C4 |]\n")
    e = score.bars[0].events
    assert e[0].duration == Fraction(3, 16)
    assert e[1].duration == Fraction(1, 16)
    assert e[2].duration == Fraction(1, 16)
    assert e[3].duration == Fraction(3, 16)


def test_repeats_and_endings() -> None:
    score, _ = parse_abc("X:1\nM:4/4\nL:1/4\nK:C\n|: CDEF |[1 GABc :|[2 cBAG |]\n")
    assert score.bars[0].start_repeat is True
    assert score.bars[1].ending == 1
    assert score.bars[1].end_repeat is True
    assert score.bars[2].ending == 2


def test_inline_meter_change_applies() -> None:
    score, _ = parse_abc("X:1\nM:4/4\nL:1/4\nK:C\nCDEF | [M:3/4] CDE |]\n")
    assert score.bars[1].meter == (3, 4)


def test_chord_cluster_takes_top_note_with_warning() -> None:
    score, warnings = parse_abc("X:1\nL:1/4\nK:C\n[CEG] D E F |]\n")
    top = score.bars[0].events[0]
    assert top.spelled_pitch == "G4"
    assert any(w.code == "CHORD_CLUSTER_TOP_NOTE" for w in warnings)


def test_legato_text_token_removed_and_warned() -> None:
    score, warnings = parse_abc("X:1\nL:1/4\nK:C\n<|text|> C D E F |]\n")
    assert len(score.bars[0].events) == 4
    assert any(w.code == "TEXT_ELIDED_BY_MODEL" for w in warnings)


def test_second_voice_skipped_with_warning() -> None:
    abc = "X:1\nL:1/4\nK:C\nV:1\nC D E F |]\nV:2\nG, A, B, C |]\n"
    score, warnings = parse_abc(abc)
    assert len(score.bars) == 1
    assert any(w.code == "MULTI_VOICE_COLLAPSED" for w in warnings)


def test_comments_and_directives_ignored() -> None:
    score, _ = parse_abc("X:1\nL:1/4\n%%score 1\nK:C\nC D E F |] % trailing comment\n")
    assert len(score.bars[0].events) == 4


def test_malformed_span_recovers_at_next_barline() -> None:
    abc = "X:1\nM:4/4\nL:1/4\nK:C\nCDEF | ?!?junk@@ | GABc |]\n"
    score, warnings = parse_abc(abc)

    assert len(score.bars) == 3
    assert [e.spelled_pitch for e in score.bars[2].events] == ["G4", "A4", "B4", "C5"]
    bad = score.bars[1]
    assert bad.raw_unparsed and "?!?junk@@" in bad.raw_unparsed[0]
    assert any(w.code == "UNPARSEABLE_REGION" for w in warnings)


def test_text_token_in_header_field_becomes_none_not_literal() -> None:
    score, warnings = parse_abc("X:1\nT:<|text|>\nC:<|text|>\nK:C\nC D E F |]\n")
    assert score.header.title is None
    assert score.header.composer is None
    assert any(w.code == "TEXT_ELIDED_BY_MODEL" for w in warnings)


def test_empty_input_yields_no_bars_and_warning() -> None:
    score, warnings = parse_abc("")
    assert score.bars == []
    assert any(w.code == "UNPARSEABLE_OUTPUT" for w in warnings)


def test_raw_text_never_mutated_by_parsing() -> None:
    raw = WELL_FORMED
    parse_abc(raw)
    assert raw == WELL_FORMED


def test_chord_cluster_consumes_one_tuplet_slot() -> None:
    # (3[CEG]DE — the cluster is ONE tuplet member; D and E share the factor.
    score, _ = parse_abc("X:1\nL:1/4\nK:C\n(3[CEG]DE F2 |]\n")
    events = score.bars[0].events
    assert [e.spelled_pitch for e in events] == ["G4", "D4", "E4", "F4"]
    assert [e.duration for e in events[:3]] == [Fraction(1, 6)] * 3
    assert all(e.tuplet == (3, 2) for e in events[:3])
    assert events[3].tuplet is None


def test_broken_rhythm_applies_once_across_a_cluster() -> None:
    # C>[DF] — the > must scale the RETAINED top note, exactly once.
    score, _ = parse_abc("X:1\nL:1/4\nK:C\nC>[DF] E2 |]\n")
    events = score.bars[0].events
    assert [e.spelled_pitch for e in events] == ["C4", "F4", "E4"]
    assert events[0].duration == Fraction(3, 8)
    assert events[1].duration == Fraction(1, 8)


def test_quoted_text_tokens_stripped_and_total_count_reported() -> None:
    # LEGATO emits the placeholder bare, inside quoted strings, and on lyric
    # lines. None of them may surface as content, and the warning must count
    # every occurrence (1 title + 1 quoted + 2 lyric-line = 4).
    abc = 'X:1\nT:<|text|>\nK:C\n"<|text|>" C D E F |]\nw: <|text|> <|text|>\n'
    score, warnings = parse_abc(abc)
    strings = [s for b in score.bars for e in b.events for s in e.strings]
    assert strings == []
    elided = [w for w in warnings if w.code == "TEXT_ELIDED_BY_MODEL"]
    assert len(elided) == 1
    assert elided[0].message.startswith("4 ")


def test_quoted_string_with_partial_text_token_keeps_remainder() -> None:
    score, _ = parse_abc('X:1\nL:1/4\nK:C\n"A7<|text|>" C D E F |]\n')
    strings = [s for b in score.bars for e in b.events for s in e.strings]
    assert strings == ["A7"]

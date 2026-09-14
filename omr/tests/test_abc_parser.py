"""Resilient ABC parser tests.

Two families: well-formed lead-sheet ABC must parse exactly; malformed
model output must degrade to warnings + verbatim preservation without
aborting the rest of the score.
"""

from fractions import Fraction

import pytest

from omr.abc_parser import key_accidentals, parse_abc

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


def test_trailing_quoted_string_is_not_silently_dropped() -> None:
    # An annotation over the final barline ("^Fine", "D.C. al Coda") is valid
    # ABC with no note after it. Nothing may attach it, but the contract is
    # that nothing is dropped silently: it must surface verbatim in a warning.
    score, warnings = parse_abc('X:1\nL:1/4\nK:C\nC D E F "^Fine" |]\n')
    assert [e.spelled_pitch for e in score.bars[0].events] == ["C4", "D4", "E4", "F4"]
    unanchored = [w for w in warnings if w.code == "UNANCHORED_STRING"]
    assert len(unanchored) == 1
    assert unanchored[0].raw == '"^Fine"'
    assert unanchored[0].measure == 1
    # With no bar at all there is no measure to name — None, never a measure 0.
    score, warnings = parse_abc('X:1\nK:C\n"G7" |]\n')
    assert score.bars == []
    assert [(w.code, w.measure, w.raw) for w in warnings] == [("UNANCHORED_STRING", None, '"G7"')]


# ---------------------------------------------------------------------------
# Header fields and key handling


@pytest.mark.parametrize(
    "key_value,expected",
    [
        ("D", {"F": "#", "C": "#"}),
        ("Am", {}),  # relative minor of C: nothing implied
        ("Dm", {"B": "b"}),
        ("Ebm", {"B": "b", "E": "b", "A": "b", "D": "b", "G": "b", "C": "b"}),
        ("Ddor", {}),
        ("D Dorian", {}),
        ("Gmix", {}),
        ("Elyd", {"F": "#", "C": "#", "G": "#", "D": "#", "A": "#"}),
        ("B♭", {"B": "b", "E": "b"}),
        ("Bbmajor", {"B": "b", "E": "b"}),
        ("C clef=treble", {}),  # a clef spec is not a mode word
        ("none", {}),
        ("HP", {}),  # bagpipe key: no tonic letter, nothing implied
    ],
)
def test_key_signature_accidentals(key_value: str, expected: dict[str, str]) -> None:
    assert key_accidentals(key_value) == expected


def test_key_field_extras_are_stripped_from_the_recognized_key() -> None:
    # The recognized key is what the benchmark compares against the printed
    # one; a clef or transpose spec riding on K: is not part of it.
    score, _ = parse_abc("X:1\nK:C clef=treble\nC |]\n")
    assert score.header.key_raw == "C"
    score, _ = parse_abc("X:1\nK:Bb major transpose=-2\nC |]\n")
    assert score.header.key_raw == "Bb major"


def test_missing_key_field_leaves_key_none_and_still_parses_notes() -> None:
    # Absent = None: no guessed key, and the body still parses without one.
    score, warnings = parse_abc("X:1\nT:Foo\nL:1/4\nC D E F |]\n")
    assert score.header.key_raw is None
    assert score.header.title == "Foo"
    assert [e.spelled_pitch for e in score.bars[0].events] == ["C4", "D4", "E4", "F4"]
    assert warnings == []


def test_header_only_input_yields_no_bars() -> None:
    score, warnings = parse_abc("X:1\nT:Only\nM:4/4\n")
    assert score.header.title == "Only"
    assert score.header.meter == (4, 4)
    assert score.bars == []
    assert warnings == []


@pytest.mark.parametrize(
    "meter_value,expected",
    [("C", (4, 4)), ("C|", (2, 2)), ("3/4", (3, 4)), ("free", None)],
)
def test_meter_aliases_and_unreadable_meter_stays_none(meter_value, expected) -> None:
    score, _ = parse_abc(f"X:1\nM:{meter_value}\nK:C\nC4 |]\n")
    assert score.header.meter == expected


def test_default_unit_length_follows_the_abc_rule() -> None:
    # No L: field — the ABC standard derives the unit from the meter: 1/16
    # under 3/4, 1/8 at or above it, and 1/8 when there is no meter either.
    def unit(abc: str) -> Fraction:
        return parse_abc(abc)[0].bars[0].events[0].duration

    assert unit("X:1\nM:2/4\nK:C\nC |]\n") == Fraction(1, 16)
    assert unit("X:1\nM:4/4\nK:C\nC |]\n") == Fraction(1, 8)
    assert unit("X:1\nK:C\nC |]\n") == Fraction(1, 8)


def test_inline_meter_change_rederives_the_unit_only_without_an_explicit_l_field() -> None:
    score, _ = parse_abc("X:1\nM:4/4\nK:C\nC | [M:2/4] C |]\n")
    assert [b.events[0].duration for b in score.bars] == [Fraction(1, 8), Fraction(1, 16)]
    score, _ = parse_abc("X:1\nM:4/4\nL:1/4\nK:C\nC | [M:2/4] C |]\n")
    assert [b.events[0].duration for b in score.bars] == [Fraction(1, 4), Fraction(1, 4)]


def test_body_key_change_respells_what_follows_but_the_recognized_key_stays_the_first() -> None:
    # A K: line or inline [K:] mid-tune changes the implied accidentals from
    # that point on; header.key_raw is the key the chart OPENS in.
    for abc in ("X:1\nL:1/4\nK:C\nF |\nK:G\nF |]\n", "X:1\nL:1/4\nK:C\nF | [K:G] F |]\n"):
        score, _ = parse_abc(abc)
        assert [b.events[0].spelled_pitch for b in score.bars] == ["F4", "F#4"]
        assert score.header.key_raw == "C"
    # No K: in the header: the first key the body prints is the recognized one.
    score, _ = parse_abc("X:1\nL:1/4\nF |\nK:G\nF |]\n")
    assert score.header.key_raw == "G"
    assert [b.events[0].spelled_pitch for b in score.bars] == ["F4", "F#4"]


def test_body_unit_length_change_applies_to_later_notes() -> None:
    for abc in ("X:1\nL:1/4\nK:C\nC |\nL:1/8\nC |]\n", "X:1\nL:1/4\nK:C\nC | [L:1/8] C |]\n"):
        score, _ = parse_abc(abc)
        assert [b.events[0].duration for b in score.bars] == [Fraction(1, 4), Fraction(1, 8)]


def test_body_tempo_fills_only_an_absent_header_tempo() -> None:
    score, _ = parse_abc("X:1\nL:1/4\nK:C\nC |\nQ:1/4=120\nC |]\n")
    assert score.header.tempo == "1/4=120"
    score, _ = parse_abc("X:1\nQ:1/4=90\nL:1/4\nK:C\nC |\nQ:1/4=120\nC |]\n")
    assert score.header.tempo == "1/4=90"


def test_elided_title_mid_stream_is_counted_not_kept_as_a_subtitle() -> None:
    # A page-2 header whose title the model elided: the placeholder is never
    # presented as a recognized subtitle, but it still counts as elided text.
    score, warnings = parse_abc("X:1\nL:1/4\nK:C\nC D E F |\nT:<|text|>\nG A B c |]\n")
    assert score.header.subtitles == []
    assert len(score.bars) == 2
    [elided] = [w for w in warnings if w.code == "TEXT_ELIDED_BY_MODEL"]
    assert elided.message.startswith("1 <|text|> token(s)")


def test_mid_stream_tune_header_is_skipped_and_its_title_becomes_a_subtitle() -> None:
    # A page boundary can restart the tune header (X:/T:/K:). The bars on
    # both sides belong to one score; the second title is a subtitle.
    abc = "X:1\nL:1/4\nK:C\nC D E F |\nX:2\nT:Page 2\nK:C\nG A B c |]\n"
    score, warnings = parse_abc(abc)
    assert len(score.bars) == 2
    assert [e.spelled_pitch for e in score.bars[1].events] == ["G4", "A4", "B4", "C5"]
    assert score.header.subtitles == ["Page 2"]
    assert warnings == []


# ---------------------------------------------------------------------------
# Pitch spelling


def test_accidental_persists_per_letter_and_octave_within_the_measure() -> None:
    # ABC: an explicit accidental holds for the SAME letter in the SAME octave
    # until the barline — C5 and C3 are untouched by ^C, and the next bar resets.
    score, _ = parse_abc("X:1\nL:1/4\nK:C\n^C C c C, | C |]\n")
    assert [e.spelled_pitch for e in score.bars[0].events] == ["C#4", "C#4", "C5", "C3"]
    assert score.bars[1].events[0].spelled_pitch == "C4"


def test_double_accidentals_are_spelled_as_printed() -> None:
    score, _ = parse_abc("X:1\nL:1/4\nK:C\n^^C __D |]\n")
    events = score.bars[0].events
    assert [(e.spelled_pitch, e.midi) for e in events] == [("C##4", 62), ("Dbb4", 60)]


# ---------------------------------------------------------------------------
# Rhythm


@pytest.mark.parametrize(
    "suffix,expected",
    [
        ("/", Fraction(1, 8)),
        ("//", Fraction(1, 16)),
        ("3/", Fraction(3, 8)),
        ("/4", Fraction(1, 16)),
        ("3/2", Fraction(3, 8)),
        ("2", Fraction(1, 2)),
    ],
)
def test_duration_suffix_forms(suffix: str, expected: Fraction) -> None:
    score, _ = parse_abc(f"X:1\nL:1/4\nK:C\nC{suffix} |]\n")
    assert score.bars[0].events[0].duration == expected


def test_tuplet_explicit_note_count_limits_the_factor() -> None:
    # (p:q:r — r notes take the factor; the rest of the bar is untouched.
    score, _ = parse_abc("X:1\nL:1/4\nK:C\n(3:2:2CD E F |]\n")
    events = score.bars[0].events
    assert [e.duration for e in events] == [Fraction(1, 6)] * 2 + [Fraction(1, 4)] * 2
    assert [e.tuplet for e in events] == [(3, 2), (3, 2), None, None]


_SIMPLE_TIME_Q = {2: 3, 3: 2, 4: 3, 5: 2, 6: 2, 7: 2, 8: 3, 9: 2}
_COMPOUND_TIME_Q = {**_SIMPLE_TIME_Q, 5: 3, 7: 3, 9: 3}


@pytest.mark.parametrize("meter,default_q", [("4/4", _SIMPLE_TIME_Q), ("6/8", _COMPOUND_TIME_Q)])
@pytest.mark.parametrize("p", range(2, 10))
def test_tuplet_default_ratios(meter, default_q, p) -> None:
    # ABC 2.1 §4.13: (2 (4 (8 are in the time of three and (3 (6 in the time
    # of two under any meter; (5 (7 (9 are in the time of n — three when the
    # time signature is compound, two otherwise.
    q = default_q[p]
    score, _ = parse_abc(f"X:1\nM:{meter}\nL:1/8\nK:C\n({p}{'CDEFGABcd'[:p]} z |]\n")
    events = score.bars[0].events
    assert [(e.duration, e.tuplet) for e in events] == [(Fraction(q, 8 * p), (p, q))] * p + [
        (Fraction(1, 8), None)
    ]


@pytest.mark.parametrize(
    "meter,q",
    [
        ("6/8", 3),
        ("9/8", 3),
        ("12/8", 3),
        # ABC 1.6 read compound as "(3/8, 6/8, 9/8, 3/4, etc.)" — the rule
        # abcm2ps and abc2midi still apply as numerator % 3 == 0. ABC 2.0
        # narrowed it to the three meters above with no "etc.", and 2.1 keeps
        # that list, so every other meter takes two — even musically compound
        # ones the list leaves out.
        ("3/4", 2),
        ("3/8", 2),
        ("6/4", 2),
        ("15/8", 2),
        ("4/4", 2),
        ("C", 2),
        (None, 2),
    ],
)
def test_compound_time_is_exactly_the_standards_list(meter, q) -> None:
    header = f"M:{meter}\n" if meter else ""
    score, _ = parse_abc(f"X:1\n{header}L:1/8\nK:C\n(5CDEFG |]\n")
    assert {e.tuplet for e in score.bars[0].events} == {(5, q)}


@pytest.mark.parametrize(
    "opening,change,expected",
    [("4/4", "6/8", [(5, 2), (5, 3)]), ("6/8", "4/4", [(5, 3), (5, 2)])],
)
def test_tuplet_default_follows_the_meter_in_force(opening, change, expected) -> None:
    # The meter AT the tuplet decides, not the header's: an inline [M:] field
    # and a body M: line both switch it from that point on.
    for body in (f"(5CDEFG | [M:{change}] (5CDEFG |]", f"(5CDEFG |\nM:{change}\n(5CDEFG |]"):
        score, _ = parse_abc(f"X:1\nM:{opening}\nL:1/8\nK:C\n{body}\n")
        assert [b.events[0].tuplet for b in score.bars] == expected
        assert [b.events[0].duration for b in score.bars] == [
            Fraction(q, 8 * p) for p, q in expected
        ]


@pytest.mark.parametrize("meter,n", [("4/4", 2), ("6/8", 3)])
def test_explicit_tuplet_ratio_overrides_the_meter_default(meter, n) -> None:
    # (p:q:r — a printed q wins under any meter. Only an omitted q defaults,
    # and (p::r omits it: r notes take the factor, the ratio from the meter.
    abc = f"X:1\nM:{meter}\nL:1/8\nK:C\n(5:4CDEFG | (5:4:3CDE F | (5::3CDE F |]\n"
    score, warnings = parse_abc(abc)
    assert len(score.bars) == 3
    bar1, bar2, bar3 = score.bars
    assert [(e.duration, e.tuplet) for e in bar1.events] == [(Fraction(4, 40), (5, 4))] * 5
    assert [e.tuplet for e in bar2.events] == [(5, 4)] * 3 + [None]
    assert [(e.duration, e.tuplet) for e in bar3.events] == [(Fraction(n, 40), (5, n))] * 3 + [
        (Fraction(1, 8), None)
    ]
    assert warnings == []


@pytest.mark.parametrize(
    "spec,r",
    [("(3", 3), ("(3::", 3), ("(3:2", 3), ("(3:2:3", 3), ("(3::2", 2), ("(3:2:2", 2)],
)
def test_tuplet_colon_forms_are_one_spec_not_a_barline(spec, r) -> None:
    # ABC 2.1 §4.13: (3 = (3:: = (3:2 = (3:2:3, and (3::2 = (3:2:2. The `::`
    # belongs to the tuplet spec; read as a double-repeat barline it invented
    # an end repeat, a start repeat and an ending the page never printed.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\nA | {spec}CDE F |]\n")
    assert len(score.bars) == 2
    first, second = score.bars
    assert (first.end_repeat, second.start_repeat, second.ending) == (False, False, None)
    assert [e.tuplet for e in second.events] == [(3, 2)] * r + [None] * (4 - r)
    assert warnings == []


@pytest.mark.parametrize("spec", ["(0", "(1", "(3:0", "(3::0", "(3:2:0"])
def test_degenerate_tuplet_spec_costs_its_measure_not_the_score(spec) -> None:
    # ABC defines (2 through (9, and a ratio or count of zero means nothing:
    # (0 raised ZeroDivisionError and aborted the whole parse, (3:0 made
    # zero-length notes. The span is kept verbatim like any unreadable one,
    # and no tuplet state leaks into the next bar.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\nA B | {spec}CDE F | G A |]\n")
    assert [[e.spelled_pitch for e in b.events] for b in score.bars] == [
        ["A4", "B4"],
        [],
        ["G4", "A4"],
    ]
    assert score.bars[1].raw_unparsed == [f"{spec}CDE F"]
    assert [(e.duration, e.tuplet) for e in score.bars[2].events] == [(Fraction(1, 4), None)] * 2
    assert [(w.code, w.measure) for w in warnings] == [("UNPARSEABLE_REGION", 2)]


_BROKEN_DEPTHS = [
    (">", Fraction(3, 2), Fraction(1, 2)),
    (">>", Fraction(7, 4), Fraction(1, 4)),
    (">>>", Fraction(15, 8), Fraction(1, 8)),
    ("<", Fraction(1, 2), Fraction(3, 2)),
    ("<<", Fraction(1, 4), Fraction(7, 4)),
    ("<<<", Fraction(1, 8), Fraction(15, 8)),
]


@pytest.mark.parametrize("marker,first,second", _BROKEN_DEPTHS)
@pytest.mark.parametrize("pair,kinds", [("CD", "nn"), ("zD", "rn"), ("Cz", "nr")])
def test_broken_rhythm_depth_follows_the_marker_count(marker, first, second, pair, kinds) -> None:
    # ABC 2.1 §4.4: > dots the previous note and halves the next, >> double-
    # dots it and quarters the next, >>> triple-dots it and divides the next
    # by eight; < is the mirror image. A rest on either side takes the same
    # factor, and the event after the pair is untouched.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\n{pair[0]}{marker}{pair[1]} E |]\n")
    events = score.bars[0].events
    assert [e.kind[0] for e in events] == [*kinds, "n"]
    assert [e.duration for e in events] == [first / 4, second / 4, Fraction(1, 4)]
    assert warnings == []


@pytest.mark.parametrize("pair", ["C>>>>D", "C >>>> D"])
def test_broken_rhythm_deeper_than_the_standard_is_flagged_not_guessed(pair) -> None:
    # ABC 2.1 stops at three markers and abc2midi rejects a fourth. Both notes
    # keep their written lengths — the pair's total is the same at every depth,
    # so the bar still adds up — and the run surfaces verbatim in a warning.
    # Spacing the run out does not change how deep it is.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\n{pair} E F |]\n")
    assert [e.duration for e in score.bars[0].events] == [Fraction(1, 4)] * 4
    assert [(w.code, w.measure, w.raw) for w in warnings] == [
        ("BROKEN_RHYTHM_UNDEFINED", 1, ">>>>")
    ]


@pytest.mark.parametrize("marker,first,second", _BROKEN_DEPTHS)
@pytest.mark.parametrize("before", ["", " ", "\t", "  "])
@pytest.mark.parametrize("after", ["", " "])
def test_whitespace_around_a_broken_rhythm_marker_is_insignificant(
    marker, first, second, before, after
) -> None:
    # ABC 2.1 §4.17 writes its own example with a space either side of the
    # marker (`[CEG]- > [CEG]`), so `C > D` is `C>D` — the same pair at the
    # same depth. A space BEFORE the marker used to cost the rest of the
    # measure as an unparseable span.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\nC{before}{marker}{after}D E |]\n")
    events = score.bars[0].events
    assert [(e.spelled_pitch, e.duration) for e in events] == [
        ("C4", first / 4),
        ("D4", second / 4),
        ("E4", Fraction(1, 4)),
    ]
    assert warnings == []


def test_the_standards_spaced_chord_example_pairs_through_the_tie() -> None:
    # ABC 2.1 §4.17, verbatim: a tied chord, a spaced marker, a chord. Both
    # chords collapse to their top note; the marker dots the first and halves
    # the second, and the tie still binds the two.
    score, warnings = parse_abc("X:1\nL:1/4\nK:C\n[CEG]- > [CEG] E |]\n")
    assert [(e.spelled_pitch, e.duration, e.tied_to_next) for e in score.bars[0].events] == [
        ("G4", Fraction(3, 8), True),
        ("G4", Fraction(1, 8), False),
        ("E4", Fraction(1, 4), False),
    ]
    assert [(w.code, w.raw) for w in warnings] == [("CHORD_CLUSTER_TOP_NOTE", "[CEG]")] * 2


@pytest.mark.parametrize(
    "body,next_bar",
    [
        ("C D > | E F |]", True),
        ("C D>| E F |]", True),  # used to dot D and halve E across the barline
        ("C D >\n| E F |]", True),  # the barline closing the bar opens the next line
        ("C D>\n| E F |]", True),
        ("C D >|]", False),
        ("C D>|]", False),  # used to dot D with nothing after it, silently
        ("C D >", False),  # no final barline: the tune's end closes the bar
        ("C D>", False),
    ],
)
def test_broken_rhythm_marker_its_bar_closes_on_pairs_nothing(body, next_bar) -> None:
    # A broken rhythm pairs two events of ONE bar. A run with no event after
    # it before its bar closes has nothing to pair: both notes keep their
    # written lengths and the run is kept verbatim like any span the parser
    # cannot read. Whether a space precedes it no longer decides that.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\n{body}\n")
    quarter = Fraction(1, 4)
    expected = [[("C4", quarter), ("D4", quarter)]]
    if next_bar:
        expected.append([("E4", quarter), ("F4", quarter)])
    assert [[(e.spelled_pitch, e.duration) for e in b.events] for b in score.bars] == expected
    assert [b.raw_unparsed for b in score.bars] == [[">"]] + [[]] * (len(expected) - 1)
    assert [(w.code, w.measure, w.raw) for w in warnings] == [("UNPARSEABLE_REGION", 1, ">")]


def test_broken_rhythm_marker_before_an_unreadable_span_pairs_nothing() -> None:
    # The span after the marker costs the rest of its measure, so the run has
    # no readable next event. It used to dot D and then halve F, the first
    # note of the NEXT bar. Both spans are kept, in the order they were printed.
    score, warnings = parse_abc("X:1\nL:1/4\nK:C\nC D>?? E | F G |]\n")
    quarter = Fraction(1, 4)
    assert [[(e.spelled_pitch, e.duration) for e in b.events] for b in score.bars] == [
        [("C4", quarter), ("D4", quarter)],
        [("F4", quarter), ("G4", quarter)],
    ]
    assert score.bars[0].raw_unparsed == [">", "?? E"]
    assert [(w.code, w.measure, w.raw) for w in warnings] == [
        ("UNPARSEABLE_REGION", 1, ">"),
        ("UNPARSEABLE_REGION", 1, "?? E"),
    ]


@pytest.mark.parametrize("opening", ["> E F", ">E F"])
def test_broken_rhythm_marker_opening_a_bar_still_costs_its_measure(opening) -> None:
    # Nothing precedes it in its bar, so there is no first note to dot: the
    # marker and the rest of its measure are kept verbatim, spaced or not.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\nC D | {opening} | G A |]\n")
    assert [[e.spelled_pitch for e in b.events] for b in score.bars] == [
        ["C4", "D4"],
        [],
        ["G4", "A4"],
    ]
    assert [e.duration for e in score.bars[0].events] == [Fraction(1, 4)] * 2
    assert score.bars[1].raw_unparsed == [opening]
    assert [(w.code, w.measure, w.raw) for w in warnings] == [("UNPARSEABLE_REGION", 2, opening)]


@pytest.mark.parametrize("body", ["C <|text|> D E F |]", "C<|text|>D E F |]"])
def test_elided_text_after_a_note_is_not_a_broken_rhythm_marker(body) -> None:
    # LEGATO's placeholder opens with `<`. Read as a marker it halved C, then
    # `|text|>` lexed as two barlines and shredded one bar into three.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\n{body}\n")
    assert [[(e.spelled_pitch, e.duration) for e in b.events] for b in score.bars] == [
        [(pitch, Fraction(1, 4)) for pitch in ("C4", "D4", "E4", "F4")]
    ]
    assert [w.code for w in warnings] == ["TEXT_ELIDED_BY_MODEL"]


@pytest.mark.parametrize(
    "body,expected",
    [
        ("[CE]>D", [("E4", Fraction(3, 8)), ("D4", Fraction(1, 8))]),
        ("[CE]<<D", [("E4", Fraction(1, 16)), ("D4", Fraction(7, 16))]),
        ("C>>>[DF]", [("C4", Fraction(15, 32)), ("F4", Fraction(1, 32))]),
    ],
)
def test_broken_rhythm_depth_applies_through_a_chord_cluster(body, expected) -> None:
    # A chord takes the same postfixes as a note (ABC 2.1 §4.17): a marker
    # after [CE] scales the retained top note — it used to cost the rest of
    # the measure as an unparseable span — and one before [DF] scales it too.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\n{body} G |]\n")
    events = score.bars[0].events
    assert [(e.spelled_pitch, e.duration) for e in events] == [*expected, ("G4", Fraction(1, 4))]
    assert [w.code for w in warnings] == ["CHORD_CLUSTER_TOP_NOTE"]


def test_broken_rhythm_applies_to_rests() -> None:
    score, _ = parse_abc("X:1\nL:1/4\nK:C\nC>z z<D |]\n")
    events = score.bars[0].events
    assert [e.kind for e in events] == ["note", "rest", "rest", "note"]
    durations = [e.duration for e in events]
    assert durations == [Fraction(3, 8), Fraction(1, 8), Fraction(1, 8), Fraction(3, 8)]


def test_cluster_outer_duration_and_tie() -> None:
    # [CE]2- : the multiplier after the bracket scales the retained top note
    # and the tie binds it, exactly like a plain note.
    score, _ = parse_abc("X:1\nL:1/4\nK:C\n[CE]2- [CE]2 |]\n")
    first, second = score.bars[0].events
    assert (first.spelled_pitch, first.duration, first.tied_to_next) == ("E4", Fraction(1, 2), True)
    assert (second.spelled_pitch, second.duration, second.tied_to_next) == (
        "E4",
        Fraction(1, 2),
        False,
    )


@pytest.mark.parametrize(
    "cluster,pitch,units",
    [
        ("[C2E]", "E4", 2),
        ("[CE2]", "E4", 1),
        ("[EC2]", "E4", 1),
        ("[CE]2", "E4", 2),
        ("[C2E]3/2", "E4", 3),
        ("[CE2]3/2", "E4", Fraction(3, 2)),
        ("[C2E2G2]3", "G4", 6),  # the standard's own: the same as [CEG]6
    ],
)
def test_chord_length_is_its_first_notes_and_the_kept_pitch_its_top(cluster, pitch, units) -> None:
    # ABC 2.1 §4.17: a chord whose notes differ in length lasts as long as its
    # FIRST note, and a length after the bracket multiplies that. Collapsing
    # it keeps the top note's PITCH (the lead-sheet melody) — not the top
    # note's length, and not the longest member's, which is what used to win.
    score, warnings = parse_abc(f"X:1\nL:1/4\nK:C\n{cluster} D |]\n")
    assert [(e.spelled_pitch, e.duration) for e in score.bars[0].events] == [
        (pitch, Fraction(units) / 4),
        ("D4", Fraction(1, 4)),
    ]
    assert [(w.code, w.raw) for w in warnings] == [
        ("CHORD_CLUSTER_TOP_NOTE", cluster[: cluster.index("]") + 1])
    ]


def test_multi_measure_rest_expands_to_full_bars() -> None:
    score, _ = parse_abc("X:1\nM:4/4\nL:1/4\nK:C\nZ2 | CDEF |]\n")
    assert len(score.bars) == 3
    for bar in score.bars[:2]:
        assert [(e.kind, e.duration) for e in bar.events] == [("rest", Fraction(1))]
    # Without a meter the whole-bar rest can only be a whole note.
    score, _ = parse_abc("X:1\nL:1/4\nK:C\nZ | CDEF |]\n")
    assert score.bars[0].events[0].duration == Fraction(1)


def test_invisible_rest_is_a_rest() -> None:
    score, _ = parse_abc("X:1\nL:1/4\nK:C\nx2 C D |]\n")
    rest = score.bars[0].events[0]
    assert (rest.kind, rest.duration) == ("rest", Fraction(1, 2))


# ---------------------------------------------------------------------------
# Structure


def test_endings_attached_to_barlines() -> None:
    # `|1 ... :|2` — the ending number rides the barline itself.
    score, _ = parse_abc("X:1\nM:4/4\nL:1/4\nK:C\n|: CDEF |1 GABc :|2 cBAG |]\n")
    assert score.bars[0].start_repeat is True
    assert (score.bars[1].ending, score.bars[1].end_repeat) == (1, True)
    assert (score.bars[2].ending, score.bars[2].end_repeat) == (2, False)


def test_double_repeat_barline_closes_and_opens() -> None:
    score, _ = parse_abc("X:1\nM:4/4\nL:1/4\nK:C\nCDEF :: GABc |]\n")
    assert score.bars[0].end_repeat is True
    assert score.bars[1].start_repeat is True


def test_empty_bars_are_dropped_and_a_dangling_repeat_lands_on_the_previous_bar() -> None:
    score, _ = parse_abc("X:1\nM:4/4\nL:1/4\nK:C\nCDEF | | GABc | :|\n")
    assert len(score.bars) == 2
    assert score.bars[1].end_repeat is True


def test_primary_voice_resumes_after_a_secondary_voice() -> None:
    # V:1 ... V:2 ... V:1 — the second V:1 segment is melody again, whether
    # the voice switches are field lines or inline fields.
    for abc in (
        "X:1\nL:1/4\nK:C\nV:1\nC D E F |\nV:2\nG, A, B, C |\nV:1\nG A B c |]\n",
        "X:1\nL:1/4\nK:C\n[V:1] C D E F | [V:2] G, A, B, C | [V:1] G A B c |]\n",
    ):
        score, warnings = parse_abc(abc)
        assert [[e.spelled_pitch for e in b.events] for b in score.bars] == [
            ["C4", "D4", "E4", "F4"],
            ["G4", "A4", "B4", "C5"],
        ]
        assert sum(w.code == "MULTI_VOICE_COLLAPSED" for w in warnings) == 1


def test_slurs_decorations_and_grace_notes_carry_nothing() -> None:
    score, warnings = parse_abc("X:1\nL:1/4\nK:C\n(C D E) .F ~G !fermata!A {b}B c |]\n")
    pitches = [e.spelled_pitch for e in score.bars[0].events]
    assert pitches == ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]
    assert warnings == []

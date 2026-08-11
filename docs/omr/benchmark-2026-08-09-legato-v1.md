# First recorded benchmark: LEGATO v1 baseline (2026-08-09)

> The comparison baseline for future backends (LEGATO 2, etc.) — same fixtures,
> same metrics, one `--backend` flag. Reproduce: `uv run python -m omr benchmark`.
> Ground truth: 3 charts converted from corpus fixtures + visually spot-reviewed;
> full human review pending ("reviewed": false).


Backend: **legato_v1** · model `guangyangmusic/legato@2d07c5d0e73186f2c0b12e35ea187bbc30dec18c` · device `cpu` · omr 0.1.0

> LEGATO v1 experimentation backend — NOT LEGATO 2

## all-of-me

> ⚠️ Ground truth has **NOT been human-reviewed** against the printed page — treat these numbers as provisional.

| Metric | Score | Count |
|---|---|---|
| Measure alignment | 1.000 | 32/32 |
| Pitch (strict spelling) | 0.976 | 81/83 |
| Pitch (MIDI) | 1.000 | 83/83 |
| Accidental spelling (of MIDI-matched) | 0.976 | 81/83 |
| Rhythm (onset+duration exact) | 1.000 | 83/83 |
| Onset only | 1.000 | 83/83 |
| Duration only | 1.000 | 83/83 |
| Chord exact symbol | 0.000 | 0/24 |
| Chord root (enharmonic-strict) | 0.000 | 0/24 |
| Chord quality class | 0.000 | 0/24 |
| Chord alterations (of root+quality matches) | n/a | 0/0 |
| Measure count error | 0 | |
| Inserted chords | 0 | |
| Key signature match | yes | |
| Time signature match | yes | |
| Repeat events F1 | n/a | |
| Rehearsal marks F1 | n/a | |

- 1 backend warning(s), 1 parse warning(s), 0 validation warning(s)
- chord metrics reflect a model limitation: this backend does not transcribe text, so chord symbols cannot appear in its output

## lady-bird

> ⚠️ Ground truth has **NOT been human-reviewed** against the printed page — treat these numbers as provisional.

| Metric | Score | Count |
|---|---|---|
| Measure alignment | 1.000 | 16/16 |
| Pitch (strict spelling) | 0.811 | 43/53 |
| Pitch (MIDI) | 0.887 | 47/53 |
| Accidental spelling (of MIDI-matched) | 0.915 | 43/47 |
| Rhythm (onset+duration exact) | 0.936 | 44/47 |
| Onset only | 0.936 | 44/47 |
| Duration only | 0.936 | 44/47 |
| Chord exact symbol | 0.000 | 0/15 |
| Chord root (enharmonic-strict) | 0.000 | 0/15 |
| Chord quality class | 0.000 | 0/15 |
| Chord alterations (of root+quality matches) | n/a | 0/0 |
| Measure count error | 0 | |
| Inserted chords | 0 | |
| Key signature match | yes | |
| Time signature match | yes | |
| Repeat events F1 | n/a | |
| Rehearsal marks F1 | n/a | |

- 1 backend warning(s), 1 parse warning(s), 0 validation warning(s)
- chord metrics reflect a model limitation: this backend does not transcribe text, so chord symbols cannot appear in its output

## take-the-a-train

> ⚠️ Ground truth has **NOT been human-reviewed** against the printed page — treat these numbers as provisional.

| Metric | Score | Count |
|---|---|---|
| Measure alignment | 1.000 | 25/25 |
| Pitch (strict spelling) | 0.824 | 56/68 |
| Pitch (MIDI) | 0.956 | 65/68 |
| Accidental spelling (of MIDI-matched) | 0.862 | 56/65 |
| Rhythm (onset+duration exact) | 0.969 | 63/65 |
| Onset only | 1.000 | 65/65 |
| Duration only | 0.969 | 63/65 |
| Chord exact symbol | 0.000 | 0/21 |
| Chord root (enharmonic-strict) | 0.000 | 0/21 |
| Chord quality class | 0.000 | 0/21 |
| Chord alterations (of root+quality matches) | n/a | 0/0 |
| Measure count error | 0 | |
| Inserted chords | 0 | |
| Key signature match | yes | |
| Time signature match | yes | |
| Repeat events F1 | 1.000 | |
| Rehearsal marks F1 | 0.000 | |

- 1 backend warning(s), 1 parse warning(s), 0 validation warning(s)
- chord metrics reflect a model limitation: this backend does not transcribe text, so chord symbols cannot appear in its output

## Aggregate

Unweighted macro-average across charts; `n/a` values excluded.

| Metric | Mean |
|---|---|
| Measure alignment | 1.000 |
| Pitch (strict spelling) | 0.870 |
| Pitch (MIDI) | 0.948 |
| Accidental spelling (of MIDI-matched) | 0.917 |
| Rhythm (onset+duration exact) | 0.968 |
| Onset only | 0.979 |
| Duration only | 0.968 |
| Chord exact symbol | 0.000 |
| Chord root (enharmonic-strict) | 0.000 |
| Chord quality class | 0.000 |
| Chord alterations (of root+quality matches) | n/a |
| Measure count error | 0.000 |
| Inserted chords | 0.000 |
| Key signature match | 1.000 |
| Time signature match | 1.000 |
| Repeat events F1 | 1.000 |
| Rehearsal marks F1 | 0.000 |

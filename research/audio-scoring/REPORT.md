# Audio-domain lick comparison — assessment (2026-10-07)

**Question.** Would comparing the user's recording with a rendering of the
expected lick, entirely in the audio domain, track "sounds correct" better
than, or usefully beside, the note-based score? Andy named cross-correlation
as the first idea; this probe measures it and four alternatives on the
recorded-take corpus.

**Answer in one paragraph.** Raw cross-correlation of waveforms is useless
here (it cannot tell a lick from its own transposition on a third of the
takes). Cross-correlation of onset envelopes is worse: the blob carries the
app's own metronome, so the envelope locks onto any beat-multiple lag. Two
measures work and are additive to the note score in exactly the places it is
blind: **chroma similarity against the expected line at the best lag** (M3)
and **frame-level pitch coverage**, precision and recall of the pitch track
against the expected piano roll (M5). Both rank the two inflated Wail takes
below every clean take in the corpus, keep the five takes the old detector
butchered inside the clean range, pick the right lick over every
transposition on 98–100 % of takes, and drop for a wrong note or an extra
four to thirty times more than for a 5 % tempo change. Their rank agreement
with what was actually played is 0.58–0.59 against 0.23 for the saved scores.
Neither needs the lick rendered as audio: a timbre-free synthetic reference
performed the same as the app's own samples, so a chroma *template* is
enough. Recommendation: build M5 from the detector's existing readings first
(no new DSP, it is the missing "precision" half of the score), then M3 as an
independent audio-side check that flags detector/scorer disagreement. Do not
build raw or envelope cross-correlation. Two policy questions are Andy's:
whether a held note released early should cost (it does under M3; the note
scorer never scores durations), and how the signal enters the grade.

Everything below is reproducible: `uv run python -m harness.evaluate`
regenerates `results/`; `results/tables.md` holds every table.

## Data

- **Corpus**: 38 WAV + 36 JSON in `tests/fixtures/recordings/`. Expected
  notes from `savedScore.noteResults[].expected`; four takes without a saved
  score use the test's phrase literal (`takes/expected-overrides.yaml`). Three
  April takes have no recorded rhythm (`timing_assumed`) and are excluded from
  the truth and case statistics.
- **Downloads**: nine of Andy's diagnostic exports that never became fixtures
  (`takes/downloads/`), including both Wail takes. The six without a test were
  audited from the spectrogram and f0 overlay (`takes/truth.yaml`, `audit:
  audio`): four were played correctly, two of those under-scored by the saved
  detector (pent-upper-neighbor-dotted-quart: the final C read as C#;
  pent-1-3-2-5-dotted-quarter-eigh: the final C marked missed), one clean at
  0.99, and 09-12 four-to-five holds the C through the second C's slot (the
  saved "missed" stands, a re-tonguing cannot be settled by eye).
- **Production `/diagnostics`**: not collected. Claude in Chrome reported
  "not connected" on three attempts; the takes' metadata lives only in that
  browser profile's IndexedDB (cloud copies carry `metadata: null`). New
  exports dropped into `takes/prod/` are picked up by the harness as they are.
- **Truth**: `hits / (total + real_extras)` per take, from the fixture test's
  own assertions (what was actually played), the 2026-10-06 Wail analysis, or
  the audio audit. 44 verified, timing-known takes enter E2/E3.

## Method

The take is band-passed 90–5000 Hz. "Sounding" is judged on 250–5000 Hz at
−30 dB relative to the take, the segmenter's own click-immune band and the
app's performance floor. The expected line is rendered two ways (the app's
tenor samples with their tuning corrections; a six-partial synthetic tone),
and compared over its notated span plus one silent beat after it, so a
trailing extra costs. The lag (where phrase offset 0 sits in the take) is
searched: ±0.6 s around the bar line for lick practice, the whole take for
ear training (and one beat before it for takes recorded before the capture
was pre-armed, whose recordings start inside the first note).

| Metric | What it measures | Octave |
|---|---|---|
| M1 raw-xcorr | normalised cross-correlation of the waveforms | strict |
| M2 env-xcorr | the same on onset-strength envelopes; `_at` = at the chroma lag | blind |
| M3 chroma | mean per-frame cosine of 12-bin chroma at the best lag, silence must agree; `_dtw` = banded subsequence DTW (±max(0.25 s, half a beat)) | blind |
| M4 cqt | the same on a harmonic-salience semitone map (E2–C6) | strict |
| M5 cover | pyin f0 vs the expected piano roll at the chroma lag: precision (sounded frames that match), recall (expected frames covered), F1; 120 ms release tolerance | policy |

Self-test (`harness/selftest.py`, 28 checks): a rendering against itself
scores ≥ 0.95 on every metric and recovers an embedded lag within one frame;
a semitone transposition drops every pitch metric by > 0.3; an octave moves
M4/M5-strict but not M3; a trailing extra costs. Three harness bugs were
found and fixed by it and by the first overlay: the lag search could not
reach past the reference's release tail (tonic-turn locked 0.23 s early and
every boundary mismatched), the click's broadband stripe passed the
90–5000 Hz energy gate (the 250–5000 Hz gate fixed it), and DTW normalised by
path length bought cheap steps by stacking frames.

## Results

### E1 — does the measure know which lick was played? (label-free)

Own lick vs its transpositions ±1…±5 st, and vs every other lick in the set
rendered at the take's tempo (sampled renderer; synthetic in brackets).

| metric | top-1 vs transposed | MRR | margin | top-1 vs other licks | top-1 vs same-length licks |
|---|---|---|---|---|---|
| M1 raw | 0.65 (0.63) | 0.80 | 0.02 | 0.35 | 0.39 |
| M2 env | 0.17 (0.00) | 0.36 | −0.06 | 0.02 | 0.04 |
| M3 chroma | 0.98 (1.00) | 0.99 | 0.38 | 0.85 | 0.85 |
| M3 chroma-dtw | 1.00 (1.00) | 1.00 | 0.32 | 0.79 | 0.80 |
| M4 cqt | 0.98 (1.00) | 0.99 | 0.29 | 0.85 | 0.87 |
| M5 cover | 1.00 (1.00) | 1.00 | 0.53 | 0.85 | 0.89 |

Every M3 loss against another lick is to a lick with the **same pitch
sequence** and a different rhythm (upper-neighbor-on-root C D C vs
pent-upper-neighbor C D C; fifth-sixth-step F G vs blue-note-step-up F F G;
blue-note-climb C C D vs flat-seven-octave C D; 09-12 four-to-five C C D D vs
flat-five-chromatic-up C C D), or the 07-08 take whose recording holds two of
its four notes. The one M3 loss against a transposition is that same broken
take. The margins are small for those pairs (0.005–0.06): chroma sees pitch
content, not articulation.

### E2 — rank agreement with what was played

Spearman against the truth over the 44 verified, timing-known takes.

| signal | ρ vs truth | p |
|---|---|---|
| saved score (n = 43) | 0.23 | 0.14 |
| M1 raw | −0.05 | 0.77 |
| M2 env | 0.36 | 0.02 |
| M3 chroma | 0.58 | < 0.001 |
| M3 chroma-dtw | 0.51 | < 0.001 |
| M4 cqt | 0.50 | 0.001 |
| M5 cover | 0.59 | < 0.001 |
| min(M3, M5) | 0.60 | < 0.001 |

The saved scores correlate with nothing — expected, since the corpus is by
construction the takes the old pipeline got wrong. The audio metrics have
zero rank correlation with the saved scores (−0.09 to 0.10): they are an
independent reading.

### E3 — the named cases

Value of M3 chroma and M5 cover for each case, and its percentile among the
clean verified takes (clean M3: min 0.79, p10 0.87, median 0.93; clean M5:
p10 0.85, median 0.92).

| take | case | truth | saved | M3 | pct | M5 | pct | verdict |
|---|---|---|---|---|---|---|---|---|
| wail-a | inflated | 0.61 | 0.88 | 0.61 | 0 | 0.51 | 0.03 | below every clean take ✓ |
| wail-b | inflated | 0.79 | 0.93 | 0.75 | 0 | 0.69 | 0.03 | below every clean take ✓ |
| locrian-descent | flawed (C dropped, F added) | 0.78 | 0.49 | 0.72 | 0 | 0.58 | 0.03 | ✓ |
| 07-08 four-to-five | flawed (2 of 4 recorded) | 0.50 | 0.33 | 0.41 | 0 | 0.32 | 0.03 | ✓ |
| sharp-9-flat-9-dom | flawed (two Cs +62/+70 ¢) | 0.78 | 0.74 | 0.85 | 0.07 | 0.73 | 0.03 | ✓ |
| honeysuckle-rose-b | 3 of 5 played | 0.60 | 0.49 | 0.86 | 0.07 | 0.73 | 0.03 | ✓ |
| 10-03 four-to-five | flawed (final A stopped early) | 0.75 | 0.49 | 0.85 | 0.07 | 0.89 | 0.23 | mild |
| 08-10 pent run | flawed (first C never recorded) | 0.75 | 0.52 | 0.88 | 0.20 | 0.86 | 0.13 | uncharged: the C precedes the recording |
| tonic-turn | correct, saved 1/4 | 1.00 | 0.42 | 0.89 | 0.20 | 0.87 | 0.20 | in range ✓ |
| blue-note-drop | correct, saved 2/3 | 1.00 | 0.71 | 0.96 | 0.87 | 0.94 | 0.73 | ✓ |
| honeysuckle-rose | 4 of 5, saved 2/5 | 0.80 | 0.59 | 0.88 | 0.20 | 0.78 | 0.03 | ✓ (M5 sees the cracked attack) |
| pent-upper-neighbor (audit) | correct, saved 0.62 | 1.00 | 0.62 | 0.84 | 0.07 | 0.88 | 0.23 | ✓ |
| pent-1-3-2-5-dotted (audit) | correct, saved 0.74 | 1.00 | 0.74 | 0.91 | 0.33 | 0.88 | 0.20 | ✓ |
| root-frame | correct, saved 0.45 | 1.00 | 0.45 | 0.78 | 0 | 0.79 | 0.03 | **final G released 1.2 s early** (see below) |

Wail-a's overlay (`results/figures/`) shows why it falls: pyin follows the
written line for the first seven notes, reading Ab3 where the app's detector
read Ab4, then the player drifts behind the grid and the final third is a
different contour.

### E4 — controlled perturbations of the ten cleanest takes

Mean drop (worst-take drop) per perturbation.

| metric | one note +1 st | extra inside | extra after | note dropped | note 150 ms late | stretch +5 % | stretch −5 % |
|---|---|---|---|---|---|---|---|
| M1 raw | 0.05 (−0.03) | 0.02 | 0.01 | 0.03 | −0.01 | 0.01 | 0.00 |
| M2 env | 0.01 (−0.02) | 0.03 | 0.06 | −0.01 | 0.01 | 0.06 | 0.14 |
| M3 chroma | 0.16 (0.04) | 0.16 (0.11) | 0.17 (0.15) | 0.19 (0.05) | 0.04 (0.01) | 0.01 (−0.02) | 0.03 (0.00) |
| M3 chroma-dtw | 0.14 (0.03) | 0.15 (0.10) | 0.07 (0.00) | 0.14 (0.01) | 0.01 | 0.01 | 0.00 |
| M4 cqt | 0.11 (0.03) | 0.15 (0.10) | 0.17 (0.14) | 0.17 (0.06) | 0.04 | 0.01 | 0.03 |
| M5 cover | 0.25 (0.09) | 0.19 (0.11) | 0.11 (0.09) | 0.14 (0.03) | 0.02 (0.01) | 0.00 | 0.02 |

M3 and M5 pass the rule fixed before the run (wrong-note and extra drops
larger than the stretch drops, on every take). The DTW variants forgive a
trailing extra entirely on some takes (warping absorbs it); M1 and M2 do not
respond to anything.

### Renderer

Synthetic ≈ sampled on every metric (E1 M3 1.00 vs 0.98, E2 0.58 vs 0.58).
The reference does not need to be audio: a chroma template built from the
expected notes (fundamental plus harmonic weights) would do, which removes
the need to render anything in the browser.

## What the audio measure sees that the note score does not, and the reverse

- **Extras cost.** The note score is recall-only; M3/M5 charge every sounded
  frame that is not the line. This is the whole Wail effect (M5 precision
  0.52 / 0.74 against ≥ 0.86 on clean takes).
- **No pairing, no blast radius.** A 50 ms sliver costs 50 ms of frames, not
  three re-paired notes. The five takes the detector once butchered
  (tonic-turn, blue-note-drop, honeysuckle, and the two audited Downloads
  takes) all read ≥ 0.84 on M3.
- **Durations are scored.** root-frame's final G, released 1.2 s early,
  leaves M3 at 0.78, the floor of the clean range; the note scorer gave the
  note full credit. Whether a
  held note's length should count is Andy's call (a tolerance such as "≥ 50 %
  of the notated length" is a one-line rule in the roll).
- **Articulation is invisible.** A repeated pitch that was not re-tongued
  (09-12 four-to-five holds the C through the second C's slot) reads 0.86 /
  0.97 (DTW): chroma and f0 cannot see a tongue. Every E1 loss to another lick
  is this blindness. An articulation term needs onsets, which brings back
  the live onset-worklet question.
- **Octave.** Chroma is octave-blind by construction; the salience map (M4)
  inherits the tenor's octave ambiguity (sixth-octave-lift's E3/G3 read an
  octave up, M5-strict 0.17), the same family as the detector's Ab3→Ab4.
  pyin got the Wail Ab3 right where Pitchy did not — a hint for the detector
  bug, not a fix.
- **Metronome in the blob.** The recorder taps the master bus, so the click
  is in every take. The 250–5000 Hz gate and the band-pass make the pitch
  measures immune; the envelope measure is not (it locks onto the grid).

## Recommendation

1. **Build frame coverage (M5) from the existing readings first.** The live
   detector already produces one pitch reading per frame with clarity and
   RMS; a precision/recall of those readings against the expected piano roll
   at the scorer's own lag, with the scorer's octave policy and a 120 ms
   release tolerance, needs no synthesis, no FFT, no new DSP, and never pairs
   notes. Report it beside the score and gate `great`/`perfect` on precision
   (clean takes ≥ 0.86; Wail 0.52 / 0.74). This is the "extras count as
   zero" the docs already promise, delivered without touching the aligner.
2. **Then chroma similarity (M3) against a template** as the independent
   audio-side check: 12-bin chroma per frame from the analyser spectrum (or
   the blob on rescore), a ±1 s lag search, mean cosine with silence
   agreement over the notated span plus one beat. Threshold ≈ 0.85 (clean p10
   0.87). Its value is disagreement: chroma high with score low means a
   detector bug (the five butchered takes), chroma low with score high means
   an inflated score (Wail). Both are worth a diagnostics badge before they
   are worth a grade.
3. **Do not build raw or envelope cross-correlation.**
4. **Candidate fixtures**: pent-upper-neighbor-dotted-quart (final C read as
   C#) and pent-1-3-2-5-dotted-quarter-eigh (final C missed) are two more
   correct takes the saved detector under-scored, both audited from the audio
   and sitting in `takes/downloads/`. They belong in the regression corpus
   with a test each, as a follow-up.

**Open for Andy.** (a) Should a held note released early cost? (b) Gate the
grade, blend into `overall`, or badge only? (c) The articulation blind spot:
accept it, or revisit the onset worklet. (d) Production takes: the harness
reads any export dropped into `takes/prod/`; Chrome was not connected this
session.

## Portability notes

| piece | cost | in the app today |
|---|---|---|
| M5 from readings | O(frames), no FFT | readings, clarity, RMS exist; the roll is `expected` × tempo × swing; lag = the scorer's median offset |
| chroma per frame | one 4096 FFT per frame (the analyser already computes it), 12 bins | `AnalyserNode.getFloatFrequencyData` at 60 fps; or from the decoded blob on rescore |
| chroma template | none | expected MIDI per frame → unit vector over pitch classes with 1/h harmonic weights |
| lag search | 43 fps × ±1 s × 12 bins | trivial |
| rendering audio | not needed | (`backing-bounce.ts` shows smplr `renderOffline` works if ever wanted) |

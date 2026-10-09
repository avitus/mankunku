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
transposition on 97–98 % of takes, and drop for a wrong note or an extra
three to eight times more than for a 5 % tempo change. Their rank agreement
with what was actually played is 0.58 (0.66 / 0.64 with the hold rule) against 0.23 for the saved scores.
On the **378 takes decoded from the Firefox profile** (356 lick-practice
windows the cloud never sees, 48 licks, 50–170 BPM) the audio measures rank
with the saved score at 0.64–0.80 and step cleanly through the five grades;
the disagreements that remain are the informative ones (a 16/16 take the
pairing cascade saved as 3/9, the ghosted-C lick, and fast licks at the
frame rate's limit). Neither measure needs the lick rendered as audio: a
timbre-free synthetic reference performed the same as the app's own samples,
so a chroma *template* is enough. Recommendation: build M5 from the detector's existing readings first
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
- **Production** (`takes/prod/`, pulled 2026-10-07 with `harness/prod_import.py`
  from the `recordings` bucket and `session_results` through the linked
  Supabase CLI): the bucket holds the newest 300 blobs of Andy's account;
  **15** are ear-training takes with a `session_results` row (expected notes,
  score, tempo, key; swing from `user_settings` = 0.6) and were converted.
  The other **285 are lick-practice windows**, whose lick, key and tempo exist
  only in the browser's local session log (the cloud syncs a daily count), so
  they cannot be scored from production. All 1943 scored sessions since July
  are in the rows; only the newest 300 blobs survive the cap.
- **Firefox** (`takes/firefox/`, `harness/firefox_import.py`): the browser
  Andy practises in keeps every recording WITH its `RecordingMetadata`
  (phrase, source, key, tempo, swing, the full saved score, detected notes,
  transport stamp, capture timing) in IndexedDB. Decoded from a copy of the
  profile's store: 400 records in two databases (the namespaced one holds the
  newest 300, all from October 2026; the pre-namespacing one 93 from July),
  **378 scorable: 356 lick-practice windows and 37 ear-training takes**, 48
  distinct licks, 50–170 BPM, no backing band in any of them. This is the set
  production could not give. WAVs are not committed (285 MB).
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
| M5 cover | pyin f0 vs the expected piano roll at the chroma lag: precision (sounded frames that match), recall (expected frames covered), F1; 120 ms release tolerance into the rest after a note | policy |

Self-test (`harness/selftest.py`, 37 checks): a rendering against itself
scores ≥ 0.95 on every metric and recovers an embedded lag within one frame;
a semitone transposition drops every pitch metric by > 0.3; an octave moves
M4/M5-strict but not M3; a trailing extra costs; a release tail never hides
the next note's onset. Four harness bugs were found and fixed by it and by
the overlays (the fourth on 2026-10-08, see the correction at the end): the lag search could not
reach past the reference's release tail (tonic-turn locked 0.23 s early and
every boundary mismatched), the click's broadband stripe passed the
90–5000 Hz energy gate (the 250–5000 Hz gate fixed it), DTW normalised by
path length bought cheap steps by stacking frames, and M5's release tail
overwrote the first 0.12 s of every note that followed another.

## Results

### E1 — does the measure know which lick was played? (label-free)

Own lick vs its transpositions ±1…±5 st, and vs every other lick in the set
rendered at the take's tempo (63 takes incl. production; sampled renderer;
synthetic in brackets).

| metric | top-1 vs transposed | MRR | margin | top-1 vs other licks | top-1 vs same-length licks |
|---|---|---|---|---|---|
| M1 raw | 0.57 (0.56) | 0.76 | 0.01 | 0.21 | 0.28 |
| M2 env | 0.17 (0.02) | 0.36 | -0.06 | 0.02 | 0.03 |
| M3 chroma | 0.97 (0.98) | 0.98 | 0.35 | 0.84 | 0.85 |
| M3 chroma hold | 0.97 (0.98) | 0.98 | 0.33 | 0.89 | 0.89 |
| M3 chroma-dtw | 0.98 (0.98) | 0.99 | 0.31 | 0.73 | 0.77 |
| M3 dtw precision | 0.89 (0.94) | 0.94 | 0.34 | 0.59 | 0.67 |
| M3 dtw F1 | 0.95 (0.98) | 0.97 | 0.45 | 0.70 | 0.74 |
| M4 cqt | 0.97 (0.98) | 0.98 | 0.26 | 0.81 | 0.89 |
| M5 cover | 0.97 (0.97) | 0.98 | 0.51 | 0.84 | 0.89 |
| M5 cover hold | 0.97 (0.97) | 0.98 | 0.50 | 0.89 | 0.92 |

Every M3 loss against another lick is to a lick with the **same pitch
sequence** and a different rhythm (upper-neighbor-on-root C D C vs
pent-upper-neighbor C D C; fifth-sixth-step F G vs blue-note-step-up F F G;
blue-note-climb C C D vs flat-seven-octave C D; 09-12 four-to-five C C D D vs
flat-five-chromatic-up C C D), or the 07-08 take whose recording holds two of
its four notes. The M3 losses against a transposition are that broken take and one
production take whose own margin is 0.01. The margins are small for those pairs (0.005–0.06): chroma sees pitch
content, not articulation. M5's two losses against a transposition are the
flat Blue Shake (E5) and 04-14 a4-c5, an April take whose rhythm was never
recorded, so its roll is a guess.

### E2 — rank agreement with what was played

Spearman against the truth over the 44 verified, timing-known takes.

| signal | ρ vs truth | p |
|---|---|---|
| saved score (n = 43) | 0.23 | 0.14 |
| M1 raw | -0.05 | 0.74 |
| M2 env | 0.32 | 0.03 |
| M3 chroma | 0.58 | < 0.001 |
| M3 chroma hold | 0.66 | < 0.001 |
| M3 chroma-dtw | 0.51 | < 0.001 |
| M3 dtw precision | 0.49 | < 0.001 |
| M3 dtw F1 | 0.53 | < 0.001 |
| M4 cqt | 0.50 | < 0.001 |
| M5 cover | 0.58 | < 0.001 |
| M5 cover hold | 0.64 | < 0.001 |
| min(M3 hold, M5 hold) | 0.65 | < 0.001 |

The saved scores correlate with nothing — expected, since the corpus is by
construction the takes the old pipeline got wrong. The audio metrics have
zero rank correlation with the saved scores (−0.02 to 0.10): they are an
independent reading.

### E3 — the named cases

Value of M3 chroma and M5 cover for each case, and its percentile among the
clean verified takes (clean M3: min 0.79, p10 0.87, median 0.93; M3 hold: min 0.87, p10 0.90; DTW precision p10 0.90; clean M5: p10 0.84, median 0.92; M5 hold p10 0.86).

| take | case | truth | saved | M3 | pct | M5 | pct | verdict |
|---|---|---|---|---|---|---|---|---|
| wail-a | inflated | 0.61 | 0.88 | 0.61 | 0 | 0.52 | 0.03 | below every clean take ✓ |
| wail-b | inflated | 0.79 | 0.93 | 0.75 | 0 | 0.71 | 0.03 | below every clean take ✓ |
| locrian-descent | flawed (C dropped, F added) | 0.78 | 0.49 | 0.72 | 0 | 0.61 | 0.03 | ✓ |
| 07-08 four-to-five | flawed (2 of 4 recorded) | 0.50 | 0.33 | 0.41 | 0 | 0.35 | 0.03 | ✓ |
| sharp-9-flat-9-dom | flawed (two Cs +62/+70 ¢) | 0.78 | 0.74 | 0.85 | 0.07 | 0.75 | 0.03 | ✓ |
| honeysuckle-rose-b | 3 of 5 played | 0.60 | 0.49 | 0.86 | 0.07 | 0.74 | 0.03 | ✓ |
| 10-03 four-to-five | flawed (final A stopped early) | 0.75 | 0.49 | 0.85 | 0.07 | 0.88 | 0.20 | mild |
| 08-10 pent run | flawed (first C never recorded) | 0.75 | 0.52 | 0.88 | 0.20 | 0.85 | 0.17 | uncharged: the C precedes the recording |
| tonic-turn | correct, saved 1/4 | 1.00 | 0.42 | 0.89 | 0.20 | 0.86 | 0.20 | in range ✓ |
| blue-note-drop | correct, saved 2/3 | 1.00 | 0.71 | 0.96 | 0.87 | 0.94 | 0.70 | ✓ |
| honeysuckle-rose | 4 of 5, saved 2/5 | 0.80 | 0.59 | 0.88 | 0.20 | 0.85 | 0.17 | in range ✓ (read 0.78 before the 2026-10-08 tail fix, which this report took for the cracked attack) |
| pent-upper-neighbor (audit) | correct, saved 0.62 | 1.00 | 0.62 | 0.84 | 0.07 | 0.87 | 0.20 | ✓ |
| pent-1-3-2-5-dotted (audit) | correct, saved 0.74 | 1.00 | 0.74 | 0.91 | 0.33 | 0.90 | 0.27 | ✓ |
| root-frame | correct, saved 0.45 | 1.00 | 0.45 | 0.78 | 0 | 0.79 | 0.03 | **final G released 1.2 s early**; hold-tolerant 0.93 / 0.93, in range |

Wail-a's overlay (`results/figures/`) shows why it falls: pyin follows the
written line for the first seven notes, reading Ab3 where the app's detector
read Ab4, then the player drifts behind the grid and the final third is a
different contour.

### E4 — controlled perturbations of the ten cleanest takes

Mean drop (worst-take drop) per perturbation.

| metric | one note +1 st | extra inside | extra after | note dropped | note 150 ms late | stretch +5 % | stretch −5 % |
|---|---|---|---|---|---|---|---|
| M1 raw | 0.05 (-0.03) | 0.02 (-0.03) | 0.01 (-0.00) | 0.03 (-0.05) | -0.01 (-0.08) | 0.01 (-0.03) | 0.00 (-0.04) |
| M2 env | 0.01 (-0.02) | 0.03 (-0.07) | 0.06 (0.01) | -0.01 (-0.08) | 0.01 (-0.17) | 0.06 (0.01) | 0.14 (-0.05) |
| M3 chroma | 0.16 (0.04) | 0.16 (0.11) | 0.17 (0.14) | 0.19 (0.05) | 0.04 (0.01) | 0.00 (-0.02) | 0.03 (0.00) |
| M3 chroma hold | 0.16 (0.04) | 0.16 (0.11) | 0.17 (0.14) | 0.17 (0.05) | 0.03 (0.01) | 0.01 (-0.02) | 0.03 (0.00) |
| M3 chroma-dtw | 0.14 (0.03) | 0.15 (0.10) | 0.07 (-0.00) | 0.14 (0.01) | 0.01 (-0.01) | 0.00 (-0.01) | -0.00 (-0.01) |
| M3 dtw precision | 0.30 (0.12) | 0.24 (0.12) | 0.10 (0.00) | 0.06 (0.00) | 0.01 (-0.05) | 0.01 (-0.04) | -0.01 (-0.09) |
| M3 dtw F1 | 0.26 (0.07) | 0.16 (0.07) | 0.06 (0.00) | 0.13 (0.06) | 0.00 (-0.02) | 0.01 (-0.03) | -0.00 (-0.07) |
| M4 cqt | 0.11 (0.03) | 0.15 (0.10) | 0.17 (0.14) | 0.17 (0.05) | 0.04 (0.01) | 0.01 (-0.02) | 0.03 (-0.03) |
| M5 cover | 0.26 (0.09) | 0.19 (0.10) | 0.10 (0.06) | 0.15 (0.03) | 0.04 (0.01) | -0.01 (-0.05) | 0.03 (0.01) |
| M5 cover hold | 0.30 (0.10) | 0.21 (0.13) | 0.08 (0.04) | 0.20 (0.04) | 0.05 (0.01) | -0.01 (-0.06) | 0.04 (-0.00) |

M3 and M5 pass the rule fixed before the run (wrong-note and extra drops
larger than the stretch drops, on every take; M5 hold misses it on one,
third-fifth-rise, before and after the 2026-10-08 fix). Against the worse
of the two stretches, a wrong note or an extra costs M3 5–6× and M5 3–8×.
The DTW variants forgive a trailing extra entirely on some takes (warping
absorbs it); M1 and M2 do not respond to anything.

### E5 — production spread (15 ear-training takes, own lick only)

`results/prod_summary.md`. Saved grades: 11 perfect, 3 great, 1 fair. The
first pass flagged three perfect takes at chroma 0.66–0.73 with precision
0.90–0.94 and recall 0.56–0.66: correct notes, **held shorter than notated**
(one lick notates a final note of five whole notes, which outruns the
recording). That is the duration question of E3's root-frame, now in
production, so the harness gained **hold-tolerant variants** (`_hold`: a note
counts once half its length or one beat is held; reference frames past the
recording's end are unknown, since the window closes on schedule):

| grade | n | chroma | chroma hold | coverage | coverage hold | precision |
|---|---|---|---|---|---|---|
| perfect | 11 | 0.82 (0.68–0.94) | **0.91 (0.86–0.95)** | 0.82 (0.70–0.92) | **0.89 (0.81–0.93)** | 0.92 (0.80–0.96) |
| great | 3 | 0.90 | 0.90 | 0.86 | 0.88 | 0.84 |
| fair | 1 | 0.42 | 0.50 | 0.06 | 0.07 | 0.07 |

Under hold tolerance every great/perfect take reads ≥ 0.85 on chroma (no
disagreement in 14), matching the corpus's clean p10. The one fair take
(blue-shake-d19422, saved 0.62) is the inverse case: the three A's were
played ~60 ¢ flat (pyin reads them between G♯ and A), the final note was held
flat for 2.5 s, and the note scorer still awarded rhythm 0.94 on the wrong
pitches; the audio reads 0.42–0.50 and precision 0.07. Its held final Ab3
was also saved as a 2.2 s "extra" Ab4 — the tenor Ab3→Ab4 detector misread,
now seen on three takes (Wail a, Wail b, this one), with the WAV in
`takes/prod/` for a fixture.

### E5b — the Firefox set (378 takes, own lick only)

`results/firefox_summary.md`, `results/firefox_own.csv`. Lick practice is
scored octave-insensitively, as the app does. Two harness lessons came out
of this set before any number could be read: Deep Practice blobs can start
up to ~3 s before the player's entry (a 16/16 take read 0.24 against
silence under the ±0.6 s bar-line prior; the lag is now searched over the
whole take and locks at 3.11 s), and long licks at 50–62 BPM (Wail, Blue
Monk, Dexter Gordon, Eric Alexander) drift off the grid in a way the app's
slow-tempo rhythm curve forgives and the no-warp chroma does not. So the
set gained a **DTW-aligned precision / F1**: along the warped chroma path,
the share of sounding take frames whose aligned reference frame agrees, and
of required reference frames the take covers. Timing drift is absorbed by
the path; extras and wrong pitches are not.

Lick practice, 356 windows, by saved grade (median, p10–p90):

| grade | n | no-warp chroma (hold) | DTW chroma | DTW precision | DTW F1 | frame precision |
|---|---|---|---|---|---|---|
| try-again | 11 | 0.48 (0.34–0.76) | 0.57 (0.49–0.81) | 0.42 (0.32–0.69) | 0.40 (0.27–0.72) | 0.27 (0.21–0.61) |
| fair | 16 | 0.55 (0.41–0.82) | 0.69 (0.56–0.93) | 0.56 (0.47–0.90) | 0.54 (0.46–0.87) | 0.34 (0.27–0.68) |
| good | 30 | 0.71 (0.54–0.87) | 0.83 (0.68–0.92) | 0.80 (0.57–0.91) | 0.80 (0.59–0.92) | 0.57 (0.40–0.82) |
| great | 66 | 0.82 (0.64–0.91) | 0.91 (0.82–0.96) | 0.88 (0.73–0.98) | 0.90 (0.72–0.98) | 0.74 (0.52–0.86) |
| perfect | 233 | 0.90 (0.82–0.93) | 0.94 (0.89–0.97) | 0.95 (0.86–0.99) | 0.96 (0.89–0.99) | 0.86 (0.77–0.93) |

Spearman against the saved score (lick practice): frame coverage hold 0.80,
frame precision 0.80, DTW F1 0.64, no-warp chroma hold 0.64, DTW chroma 0.57.
Ear training (22 takes): 0.59–0.64. The two measures agree with the note
scorer on the bulk of takes and disagree where one of them is wrong:

- **Saved ≥ 0.90 with DTW precision < 0.70: 4 of 264.** Three are fast
  licks (Basis of Everything at 169–170 BPM, Wouldn't It Be Loverly at 150):
  an eighth is 7–8 frames at the 23 ms hop and attack transients eat a third
  of each note, so frame measures lose resolution above ~140 BPM — a
  hop-size question, not a scoring one. The fourth is a July Honeysuckle
  take whose f0 track is ambiguous at this zoom.
- **Saved < 0.75 with DTW F1 ≥ 0.85: 4 of 32.** Three are the ghosted-C
  lick (Sharp 9 Flat 9 Dom: Cs 60–70 ¢ sharp, chroma splits them between
  bins — the strictness policy Andy set on 2026-09-16, which the note scorer
  honours and chroma does not). The fourth, **apple-jump-78e1fd (saved 0.47,
  3 of 9)**, is a mostly correct take: the f0 track follows the written line
  through eight of nine notes while the saved pairing, thrown by a cracked
  head (52, 63 before the first D), marked six notes wrong — the one-false-
  note amplifier, in production, caught by the audio side (DTW F1 0.93).
- **The Wail session** (56 windows at 50–63 BPM): DTW precision ranks with
  the saved score at 0.87; every take saved ≥ 0.95 reads ≥ 0.90, the two
  takes analysed on 2026-10-06 read 0.64 (saved 0.878) and 0.80 (0.934), and
  the failed windows 0.28–0.55.

### Renderer

Synthetic ≈ sampled on every metric (E1 M3 1.00 vs 0.98, E2 0.58 vs 0.58).
The reference does not need to be audio: a chroma template built from the
expected notes (fundamental plus harmonic weights) would do, which removes
the need to render anything in the browser.

## What the audio measure sees that the note score does not, and the reverse

- **Extras cost.** The note score is recall-only; M3/M5 charge every sounded
  frame that is not the line. This is the whole Wail effect (M5 precision
  0.53 / 0.77 against a clean-take p10 of 0.90).
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
  octave up, M5-strict 0.18), the same family as the detector's Ab3→Ab4.
  pyin got the Wail Ab3 right where Pitchy did not — a hint for the detector
  bug, not a fix.
- **Metronome in the blob.** The recorder taps the master bus, so the click
  is in every take. The 250–5000 Hz gate and the band-pass make the pitch
  measures immune; the envelope measure is not (it locks onto the grid).

## Recommendation

1. **Build frame coverage (M5) from the existing readings first.** The live
   detector already produces one pitch reading per frame with clarity and
   RMS; a precision/recall of those readings against the expected piano roll
   at the scorer's own lag, with the scorer's octave policy, a 120 ms release
   tolerance and the hold rule for recall, needs no synthesis, no FFT, no new
   DSP, and never pairs notes. Report it beside the score and gate
   `great`/`perfect` on **precision** (corpus clean takes p10 0.90, production
   perfect takes 0.80–0.96; Wail 0.53 / 0.77; the flat Blue Shake 0.07).
   Precision is the duration-blind half, so it needs no policy decision.
   This is the "extras count as zero" the docs already promise, delivered
   without touching the aligner.
2. **Then chroma against a template** as the independent audio-side
   check: 12-bin chroma per frame from the analyser spectrum (or the blob on
   rescore), a lag search over the whole window (Deep Practice blobs start
   up to 3 s before the entry), and — for lick practice, where the app's
   rhythm curve is lenient at slow tempos — a banded DTW along which
   precision and recall are read (`m3_dtw_precision` / `m3_dtw_f1`; perfect
   takes ≥ 0.86 at p10, the inflated Wail takes 0.64 / 0.80, failed windows
   ≤ 0.55). The no-warp form stays the right one for ear training, where the
   grid is the lesson. Its value is disagreement: audio high with score low
   means a detector or pairing bug (five butchered corpus takes, and
   apple-jump-78e1fd in production), audio low with score high means an
   inflated score (Wail). Both are worth a diagnostics badge before they are
   worth a grade. Above ~140 BPM the 23 ms hop runs out of frames per note;
   a 10 ms hop or onset-aware frames would be needed there.
3. **Do not build raw or envelope cross-correlation.**
4. **Candidate fixtures**: pent-upper-neighbor-dotted-quart (final C read as
   C#) and pent-1-3-2-5-dotted-quarter-eigh (final C missed) are two more
   correct takes the saved detector under-scored, both audited from the audio
   and sitting in `takes/downloads/`. They belong in the regression corpus
   with a test each, as a follow-up.

**Open for Andy.** (a) Should a held note released early cost? (b) Gate the
grade, blend into `overall`, or badge only? (c) The articulation blind spot:
accept it, or revisit the onset worklet. (d) Lick-practice takes are
unscorable from the cloud: if production-side analysis of Deep/Daily takes
matters, the window's lick id, key and tempo need to travel with the blob
(a `lick_practice_results` row, or metadata on the storage object); the
Firefox profile holds them meanwhile, 300 at a time. (e) The tenor Ab3→Ab4
misread has three takes now. (f) apple-jump-78e1fd is a production take the
pairing cascade butchered (3/9 saved, 8/9 audible) — a fixture candidate for
the aligner, with the WAV re-derivable from the profile.

## Portability notes

| piece | cost | in the app today |
|---|---|---|
| M5 from readings | O(frames), no FFT | readings, clarity, RMS exist; the roll is `expected` × tempo × swing; lag = the scorer's median offset |
| chroma per frame | one 4096 FFT per frame (the analyser already computes it), 12 bins | `AnalyserNode.getFloatFrequencyData` at 60 fps; or from the decoded blob on rescore |
| chroma template | none | expected MIDI per frame → unit vector over pitch classes with 1/h harmonic weights |
| lag search | 43 fps × ±1 s × 12 bins | trivial |
| rendering audio | not needed | (`backing-bounce.ts` shows smplr `renderOffline` works if ever wanted) |


## Path forward — what shipped (2026-10-07, after Andy's approval)

Andy fixed two policies: a sharp note keeps its rhythm credit (no F2), and a
held note released early never lowers the score (no F4; the audio check is
duration-blind in recall as well as precision).

**Step 1 — measure before deciding** (`results/fix_impact.md`,
`results/ts_variants.csv`, `harness/fix_impact.py`, `ts/variants.ts`). Every
saved session is a function of its saved pairs, so the real TypeScript
scorer was run over the 1943 production sessions and the 378 Firefox takes
under each variant:

| variant | production: sessions down a grade | perfect lost | Firefox LP: charged perfect takes that read ≥ 0.90 on DTW precision | Wail (a) | Wail (b) |
|---|---|---|---|---|---|
| charge every extra | 727 | 252 | — | 0.47 | 0.68 |
| the adjacent thread's gate | 395 | 75 | 17 of 26 | 0.64 | 0.88 |
| **gate v2** (shipped) | 255 | 39 | 7 of 11 | 0.64 | 0.93 |
| gate v2 + audio corroboration | 255 | 39 | 7 of 9 | 0.64 | 0.93 |
| rhythm penalty 1.0 at every tempo (F3, on hold) | 99 | 45 | — | 0.85 | 0.92 |

The thread's gate charged a detector artefact on two thirds of the perfect
takes it touched (the window-open click read as a 0.2 s low pitch before
the entry; a scooped attack cut into three notes). Gate v2 adds two rules:
nothing more than 0.1 s before the line's first note, and a transition
under 0.25 s within two semitones of a paired neighbour is free. Its
remaining charges on "clean" perfect takes are quarter-tone-flat notes the
detector read as the neighbouring semitone — wrong by the 2026-09-16 rule,
so they stand; corroborating each charge against the pitch frames inside
its span changes nothing. A sliver-aware aligner (slivers never take a slot)
was also measured and REJECTED: it lowered the hit count on 53 takes,
because short real notes at fast tempos and ghosts fall under the same
rule; the pairing cascade needs a smarter fix.

**Step 2 — shipped**: `src/lib/scoring/extras.ts` (9a8c3617), the gate above,
`NoteResult.charged` and `Score.extrasCharged`; full suite 5644 passed, the
40 expected-fail pins unchanged; docs aligned.

**Step 3 — shipped**: `src/lib/scoring/frame-coverage.ts`, the audio check
(precision frame-level, recall weighted by notated length with a 3-frame
cover rule so an early release costs nothing), attached by the pipeline
whenever a caller passes its readings — ear training live and rescore, lick
practice, tune practice all do — shown in the feedback panel with a
"disagrees" mark at a quarter's difference from pitch accuracy, persisted
locally and in a new `session_results.audio_check` column so production
agreement can be measured before it ever gates a grade.

**Step 4 — held**: the rhythm curve, measured above (99 sessions move), is
Andy's call with that table in hand.

**Step 5 — open**: the tenor Ab3→Ab4 misread (three takes) and the
cracked-head pairing cascade (apple-jump-78e1fd; a naive sliver rule costs
53 takes, see above) are detection work with the takes in hand.

## Correction (2026-10-08) — M5's release tail hid the start of every note

`metrics.piano_roll` wrote the notes in reverse onset order with the 120 ms
release tail, so each note's tail overwrote the first 0.12 s (5 frames) of
the note after it, the opposite of its docstring. M5 precision is read
against that tailed roll: a correctly timed transition was charged for the
new note's first 120 ms and credited for the old pitch ringing there. Recall
uses the untailed roll and was unaffected. The extras gate's audio
corroboration (`gate_audio.expected_roll_fn`, "first widened row wins") had
the same shape and was fixed with it; the corroborated gate's summary is
unchanged (two takes swap one charge each). Fixed so a tail fills only frames
no note occupies (where two releases share a rest, the later note's wins),
pinned by self-test invariants (three on the roll, one on the gate's
lookup). Re-running E1–E5: every M1–M4 figure is byte-identical, only M5
moved, and the figures above are updated in place.

The fix is not monotone. An on-time transition gains its first 120 ms; a
late one loses the frames where the old pitch was still sounding, which the
bug credited (curl-to-the-floor 0.90 → 0.84, the two blues-curl-up takes
0.95 → 0.90). The shipped `frameCoverage` (src/lib/scoring/frame-coverage.ts)
never had the bug. It tests each reading against every note whose
[start, end + 0.12 s] window holds it, so around a transition either pitch
counts, and it counts only frames from 0.25 s before the line to one beat
after it. Measured with that rule at the same lags (pyin, not Pitchy; the
chroma lag, not the scorer's):

| M5 precision | old harness | fixed harness | shipped rule |
|---|---|---|---|
| corpus clean takes, p10 (median) | 0.87 (0.95) | 0.90 (0.94) | 0.95 (0.98) |
| Wail a / Wail b | 0.52 / 0.74 | 0.53 / 0.77 | 0.55 / 0.81 |
| Firefox lick-practice perfect, p10 | 0.74 | 0.77 | 0.87 |
| share of those perfect takes below Wail b | 9 % | 8 % | 4 % |
| ρ vs the corpus truth (44 takes) | 0.55 | 0.59 | 0.57 |
| ρ vs the saved score, Firefox lick practice | 0.79 | 0.80 | 0.68 |

**The conclusion behind shipping the audio check holds.** Wail b, the closer
of the two inflated takes, sits 0.13 below the clean-take p10 under all
three (Wail a 0.35–0.40 below), and the shipped rule separates Wail b from correct lick-practice takes better than
either harness version. Two corrections to what was quoted: correct takes
read higher than "≥ 0.86" suggests (clean p10 0.90 in the fixed harness,
0.95 under the shipped rule; production perfect p10–p90 0.80–0.96); and crediting both
pitches around a transition costs rank agreement with the saved lick-practice
score (0.80 → 0.68), though not with the corpus truth. One E3 verdict changes:
honeysuckle-rose (4 of 5 played) reads 0.85, inside the clean range; its
0.78 was the tail artefact, not the cracked attack.

Also fixed on the same pass: `fix_impact.line_end_seconds` now swings each
onset as `extras.ts` `lineEnd` does (one production session gains a gated
extra in `results/fix_impact.md`; the gate tables above come from
`ts/variants.ts` and do not move), and the importers write their truth file
beside `--out`.

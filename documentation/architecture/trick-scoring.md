# Trick Scoring (Fluency)

How trick attempts — triad pairs and enclosures — are scored. Companion to
[scoring-algorithm.md](scoring-algorithm.md), which covers the exact-phrase
scorer used in ear training and lick practice.

## The big picture

Both tricks share one scoring engine. The difference between them is only in
how each builds its expected **slot** sequence:

- Each device module (`src/lib/tricks/devices/`) builds a list of
  `TrickSlotSpec`s — expected notes on a rhythmic grid.
- A shared conformance engine (`src/lib/tricks/conformance.ts`) aligns the
  played notes to those slots and awards tiered partial credit.
- A fluency scorer (`src/lib/scoring/fluency.ts`) combines that with rhythm
  into the final `Score`-compatible grade.

Where the exact-phrase scorer asks *"did you reproduce this exact phrase?"*,
fluency asks *"how well did you realize the formula?"* — tricks are practiced
for fluency, not exact reproduction.

## Layer 1: Conformance (the pitch dimension)

`src/lib/tricks/conformance.ts`

Each slot carries `exactPcs` (the formula pitch classes), optional
`patternPcs` (right device, wrong member), an offset, and a role. Octaves
never matter anywhere in trick scoring; everything is pitch classes, because
a trick is a shape, not a register.

Played notes are aligned to the slots with the same DTW skeleton as the lick
scorer (3-way dynamic programming, skip cost 2.0, diagonal preferred on
ties), but the exact-pitch cost is replaced by a **conformance cost**. Each
played note is judged against its slot on a tier ladder:

| Tier | Meaning | Credit | DTW cost |
|---|---|---|---|
| exact | pc is in the slot's `exactPcs` | 1.0 | 0.0 |
| in-pattern | pc is in `patternPcs` — right device, wrong member | 0.7 | 0.3 |
| in-scale | diatonic to the context scale at the chord root, but off-formula | 0.4 | 0.6 |
| out-of-scale | chromatic miss | 0.1 | 1.0 |
| missed | slot aligned to no played note | 0.0 | (skip 2.0) |

The DTW match cost also adds a rhythm term — `|onset error| / beat length`,
capped at 1.0 — so timing influences *which* note aligns to *which* slot,
not just the final score. When the context `scaleId` is unknown, the
in-scale set degrades gracefully to the chord tones of the context chord.

After alignment, the median (detected − expected) offset over matched pairs
is subtracted, exactly as in `scorer.ts`, so constant human/mic latency does
not count against the player. The alignment is not re-run on corrected
onsets.

The **patternScore** is the mean credit over *all* slots — missed slots drag
it down as zeros. Extra played notes matched to no slot are counted and
reported (`extraCount`) but do not subtract from patternScore; their only
cost is paid inside the alignment.

## Multiple accepted playing styles (spec variants)

A device may accept several rhythmic *styles* of the same formula. Triad
pairs accept three, judged best-of via
`scoreConformanceAgainstSpecs(played, variants, context)`:

| Style | Structure | Slots |
|---|---|---|
| `cell` | A asc + B asc + first two of A (the classic cell) | 8 |
| `triplets` | four eighth-note-triplet groups per bar, alternating A-B-A-B (always on the beat) | 12 |
| `four-eighths` | four eighths of A then four of B, e.g. C-E-G-E, D-F#-A-F# (always on the beat) | 8 |

The engine scores the attempt against every variant with the ordinary
single-spec path and keeps the highest `patternScore`; ties resolve to the
earliest variant, so devices list the canonical style first. The winner's
name is reported as `ConformanceResult.style`, which `scoreFluency` feeds
back into `generateExample` (via `TrickContext.exampleStyle`) so the
report's expected notes match the style the player actually used.

Styles are deliberately NOT trick parameters: they never enter the variant
key, so one progress record covers all styles of a variant. Practice-session
previews rotate through `Trick.exampleStyles` round by round
(`exampleStyleForRound`), teaching the styles by demonstration.

## Layer 2: Fluency (the final grade)

`src/lib/scoring/fluency.ts`

```text
overall = 0.7 × patternScore + 0.3 × rhythmAccuracy
```

Deliberately different from the exact-phrase scorer's 0.6/0.4 split — a
trick attempt is judged primarily on landing the formula's pitch shape;
timing polish is secondary while the shape is being internalized.

`rhythmAccuracy` is the mean of the existing per-note `scoreRhythm` over
matched slots (latency-corrected): `1 − (onset error in beats) × penalty`,
with the tempo-scaled penalty `min(1, 0.5 + tempo/300)` — gentler at slow
tempos, tighter at fast ones. Swing is honored on both sides: expected
onsets get the same off-beat-eighth swing shift as playback (shared
`applySwingToBeats` math), so a perfectly swung performance scores
perfectly.

Grades use the same boundaries as regular practice today — perfect ≥ 0.95,
great ≥ 0.85, good ≥ 0.70, fair ≥ 0.55, else try-again — but are defined
locally in `FLUENCY_GRADE_THRESHOLDS` so trick grading can drift later
without touching lick grading.

The output is a full `Score`-compatible object, so every existing consumer
(grades, points, `recordKeyAttempt`, `applyInsertionResult`) works
unchanged: `pitchAccuracy` = patternScore, per-note `pitchScore` = slot
credit, `notesHit` = slots earning ≥ 0.7 (exact or in-pattern), plus the raw
`ConformanceResult` for per-slot display.

## What each trick puts in its slots

This is where the two feel different when played — they populate
`exactPcs`/`patternPcs` with opposite philosophies.

### Triad pairs — lenient on the note, strict on the triad

`src/lib/tricks/devices/triad-pairs.ts`

The cell is 8 eighth-note slots: triad A ascending, triad B ascending, then
the first two notes of A again. For every slot, `exactPcs` is the slot's
**entire own triad** — playing *any* member of the correct triad at that
moment scores 1.0 (right triad, wrong member still counts as exact; a
pinned design decision). `patternPcs` is the *other* triad of the pair, so
being in the pair but on the wrong triad earns 0.7. A scale tone outside
both triads gets 0.4; chromatic, 0.1.

Effectively the question being scored is *"were you inside the right triad
at the right eighth note?"* — asked of all three spec variants (see
"Multiple accepted playing styles" above), with the best answer kept.

### Enclosures — strict on the note, lenient on the neighbourhood

`src/lib/tricks/devices/enclosures.ts`

Two figures share one parameter set, selected by `TrickContext.figure` (both
`scoreConformance` and `generateExample` dispatch through
`buildEnclosureFigure`, so the judged spec always matches the demo):

- **Full** (default — the drill figure): a true anacrusis of k approach
  notes in a partial pickup bar, then four groups, each resolving onto the
  downbeat of the next content bar (or its "and" when the placement is
  offbeat) — a pickup bar + 4 content bars, final target a half note. The
  offbeat single-approach edge case rebases the whole figure back one bar —
  no pickup bar, 4 content bars — because the lone approach would otherwise
  land ON the bar-1 downbeat, leaving the pickup bar empty.
- **Compact** (`figure: 'compact'` — the tune-insertion gesture): the legacy
  2-bar layout — opening chord-tone statement, then twice over, k approach
  notes resolving into the target on beat 3 and bar-2 beat 1 in eighths
  mode. Tune windows are sized by the detected progression span, which the
  5-bar drill figure cannot fit.

Both use an eighth grid, or quarters at content tiers without eighths. The
`type` parameter (major/minor/dominant) never reaches slot construction — it
selects the practice bed and tune-alignment qualities via `ENCLOSURE_TYPES`
(major → `major-vamp` over maj7/maj6; minor → `minor-vamp` over
min7/min6/minMaj7; dominant → `dominant-vamp` over the natural-5 dominants,
deliberately excluding `7alt`, which has no natural 5th to target).

Approach slots have `exactPcs` = **the one specific approach note** (scale
neighbour from above, chromatic from below). Their `patternPcs` are the
other plausible enclosure neighbours within ±3 semitones **on the same
side** — so approaching from the correct side with a different neighbour
still earns 0.7. Target and chord-tone slots have `exactPcs` = the target pc
and `patternPcs` = the other chord tones, so landing on a chord tone that
isn't the intended target earns 0.7.

## The ladders, and where a variant is allowed to land

`src/lib/tricks/mastery.ts` holds one ordered ladder per trick in
`TRICK_MASTERY_PATHS`. Prerequisites follow the `SCALE_PREREQUISITES` model
from `tonality.ts`: the outer array is an AND of clauses, and every variant
in a clause needs `totalVariantPasses >= passes` (default `DEFAULT_PASSES =
3`, summed across all keys). Ladder keys are computed with
`trickVariantKey(trickId, params)` from the parameter objects themselves, so
they cannot drift from the device's parameters.

The two ladders have different shapes. Enclosures is **three parallel
self-contained chains** — one per chord type in `ENCLOSURE_TYPES`
(major/minor/dominant) — each a branching graph of the same 8 hand-written
steps (`ENCLOSURE_STEPS`: e3 fans out into four rungs, e8 requires e5 and e6
at once). There is **no cross-type gating**: each chain's first rung starts
unlocked, so all three types are selectable from day one, and pre-`type`
progress was re-keyed to the major chain by the `enclosure-type-v1`
migration (`src/lib/persistence/trick-state-migrations.ts`).
Triad pairs is a **strict linear chain** built by looping the 8 families
pinned in `TRIAD_PAIR_FAMILIES` — diatonic pairs, then altered pairs, then
whole-tone — so stage *n+1* opens after three passes of stage *n*:

| # | `pair` | Triads (offset from chord root) | Practice bed |
|---|---|---|---|
| 1 | `major-whole` | maj on 0 · maj on 2 | `major-vamp` |
| 2 | `major-minor` | maj on 0 · min on 2 | `major-vamp` |
| 3 | `minor-whole` | min on 2 · min on 4 | `major-vamp` |
| 4 | `major-tritone` | maj on 0 · maj on 6 | `dominant-vamp` |
| 5 | `minor-b9` | min on 1 · min on 3 | `dominant-vamp` |
| 6 | `major-sharp11` | maj on 6 · maj on 8 | `dominant-vamp` |
| 7 | `aug-major` | aug on 3 · maj on 5 | `minor-vamp` |
| 8 | `aug-whole` | aug on 0 · aug on 2 | `dominant-vamp` |

`pair` is the *only* triad-pair parameter. The family also carries the bed a
practice session should drill it over (`Trick.practiceBed`, falling back to
`'major-vamp'`) and the chord qualities it actually belongs on
(`Trick.compatibleQualitiesFor`), listed most-characteristic-first.

That quality list is what keeps tune-practice suggestions honest. A variant
declaring `compatibleQualitiesFor` is matched by `resolveQualityRoleEntry`
(`src/lib/data/progressions.ts`) against the progression's chord-quality
slots, **skipping any segment shorter than a whole note** — a device cell fills
a full 4/4 bar, so the half-bar VI7 of a iii-VI-ii-V-I never qualifies — and is then
re-rooted onto *that* chord rather than the progression's tonic — so an
altered pair lands on the V of a long ii-V-I, not on the I. When nothing
matches, the variant is simply skipped for that progression rather than
suggested somewhere it doesn't belong. Chord substitutions are deliberately
bypassed on this path; devices with no `compatibleQualitiesFor` keep the
ordinary category-registration alignment.

## Summary

An enclosure attempt is judged note-by-note against a specific figure with
partial credit for musically equivalent substitutions, while a triad-pair
attempt is judged on staying inside the correct alternating harmonic cells —
which matches how each device is actually practiced.

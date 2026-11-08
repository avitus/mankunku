# Harmonic Analysis

Living implementation plan. Started 2026-11-07 (Pacific). Update the milestone
status, decisions, acceptance cases and remaining limitations as work lands.

## Purpose

Tune lick practice should recognize useful stretches of harmony even when they
do not match a named jazz progression. A major lick can be suggested across a
passage whose chords share that major scale, rather than only over a stationary
major chord. The same analysis must work in any concert key and in local centers
outside the song's key signature.

**Cornerstone progressions take precedence when assigning practice windows.**
Harmonic interpretations may overlap: one chord can belong to a major collection
and simultaneously begin or resolve a cadence. Preserve both readings rather than
pretending harmony has a unique partition. Recognizing harmony and choosing
material from the player's book are separate steps. A missing or unready
cornerstone lick must never release its opening chord to a competing exercise.

## Reference case: Autumn in New York

The fixture `tests/fixtures/leadsheets/autumn-in-new-york.json` stores concert F.
Tenor sax displays G. Each listed chord lasts half a bar:

| Bar | Concert changes | Tenor changes | Interpretation in tenor G |
| --- | --- | --- | --- |
| 1 | Gm7, Am7 | Am7, Bm7 | ii, iii |
| 2 | Bbmaj7, C7 | Cmaj7, D7 | IV, V |
| 3 | Fmaj7, Gm7 | Gmaj7, Am7 | I, ii |
| 4 | Am7, D7 | Bm7, E7 | Beginning of the next ii–V–i |
| 5, first half | Gm7 | Am7 | Minor arrival |

Bars 1–3 contain only notes of F major (G major written for tenor), including
a dominant-to-tonic arrival in bar 3. Bar 4's first chord also belongs to that
scale, but belongs functionally to the following cornerstone. The major practice
window therefore ends at the **start of bar 4**, not at its E7 or at the next
barline after it. The analytical G-major reading continues through Bm7 to the
E7 entrance: Bm7 has both functions. The exercise boundary cannot depend on the
available lick library.

The bar-4 ii is m7, not m7b5. Preserve the authored chord. Recognize the
m7–V7–minor-tonic variant for harmonic reservation without declaring an ordinary
minor iiø–V–i lick compatible with it. Analysis identity is not permission to
bypass `progressionFitsLick` or rewrite a chart.

## Current architecture and constraints

- `tunes/progression-detector.ts` detects root/quality/rhythm templates in
  `data/progression-shapes.ts`. It already handles local keys and cyclic forms.
- `tunes/lick-matcher.ts` uses category/tags, progression fit, alignment, mastery,
  tempo and the player's own book. Phase 2 adds a distinct major-region matcher
  sharing the existing readiness, tempo and ranking rules.
- `state/tune-practice-plan.ts` chooses overlapping windows using lick readiness
  and length. A chord-category lick currently occupies its chord's run. Merely
  feeding it a synthetic major vamp would misrepresent changing harmony.
- `FlattenedTune` distinguishes notation and playback timelines and retains
  segment provenance. Analysis results must reference the supplied timeline.
- Chord symbols retain extensions, alterations and slash bass that the audio
  `ChordQuality` enum may discard. Imported `scaleId` values are per-quality
  defaults, not inferred local tonality; they are not evidence for this analysis.
- All analysis uses concert pitch and fraction offsets. Written key labels use
  the existing instrument transposition and spelling code at display time.

## Target pipeline

1. Normalize evidence from written chord symbols, retaining unknowns explicitly.
2. Detect cornerstone candidates, including supported cadence variants.
3. Detect shared-scale readings across contiguous harmony, including cornerstone
   chords; retain the overlapping interpretations.
4. Reserve cornerstone occurrences before looking at player material, then derive
   available scale-region exercise windows.
5. Assess tonic evidence and retain alternative interpretations when ambiguous.
6. Match eligible licks to each region or cornerstone using its own fit rules.
7. Plan non-overlapping practice windows, project them onto the chart and score
   them with the existing session machinery.

Keep cornerstone analysis, scale compatibility and lick suitability separately
inspectable. A scale-compatible passage need not establish a unique key center,
and a major label on a lick does not guarantee every placement sounds convincing.

## Phase 1: analysis foundation

Status: implemented locally and sandbox-validated on 2026-11-07. No production
caller is switched in this phase; existing chart annotations and practice
suggestions retain their behavior. Nothing has been deployed.

Implemented in `src/lib/music/chord-evidence.ts` and
`src/lib/tunes/harmonic-analysis.ts`, with 51 new cases across
`tests/unit/music/chord-evidence.test.ts` and
`tests/unit/tunes/harmonic-analysis.test.ts`.

Add a pure `analyzeHarmony(flat, tune, options)` entry point, returning existing
progression detections, cornerstone candidates, reserved segment indices,
`compatibleMajorRegions` (overlapping analytical readings) and `majorRegions`
(available practice candidates). It must not read practice stores or allocate audio.

### Cornerstone reservation

- Reuse existing named multi-chord detections (ii–V, ii–V–I, turnarounds and
  extended turnarounds), plus existing blues detections. Stationary vamps are
  not barriers to a larger diatonic region.
- Add an analysis-only m7–V7–minor-tonic reservation. Require the correct roots,
  qualities and contiguous chord runs, including the arrival. Retain its distinct
  identity; do not add a misleading playback template.
- Keep overlapping cornerstone candidates for later selection. Reserve the
  union of their segment sets conservatively: choosing between two cornerstone
  interpretations must not expose fragments to general major matching.
- Honor cyclic detection when enabled, including reservations at both ends of
  the form. Broad regions themselves do not wrap in this first phase.
- The analysis-only variant may use a different harmonic rhythm from existing
  practice templates. Its reservation says nothing about lick timing eligibility.

### Chord evidence

Prefer a parseable `symbol`, including its slash bass, over the audio enum.
Without a symbol, use `CHORD_DEFINITIONS` and the structured bass. A supplied but
unparseable symbol, an indeterminate `alt` chord, or inconsistent root/bass data
is an analysis barrier rather than a reason to pretend the chord is simpler.

Do not invent sevenths or sixths on written triads. Resolve concrete additions
and alterations by degree. For stacked 9/11/13 symbols, use a conservative full
stack; explicit alterations replace that degree. Jazz voicings may omit some
stacked tones, so this can decline a region a player would accept. Future voicing
policies must distinguish required tones from optional ones rather than silently
ignoring a written alteration.

### Major-region candidates

Scan all twelve major scales, not just the tune key. For each, collect maximal
contiguous runs in which every evidenced chord tone belongs to that scale.
For `compatibleMajorRegions`, break at unknown chords, gaps, section boundaries
and the form edge. Derive `majorRegions` with the same evidence rules plus
cornerstone reservation boundaries. Overlapping, invalid or out-of-form timing declines analysis of the supplied
timeline with an `invalid-timeline` issue. Do not stretch a run past a contradiction.

Initially emit regions lasting at least one bar, containing at least two
different chord roots and a major tonic chord for the candidate key. This avoids
replacing stationary-vamp detection and making unsupported tonic guesses from a
single shared chord. Preserve overlapping candidates instead of making a forced
choice. Record the tonic and dominant-to-tonic evidence and whether the candidate
matches the tune key. These are qualitative evidence, not calibrated probabilities.

This deliberately misses tonic-free but compatible passages. Expanding recall is
a later policy change with examples and tests, not an implicit fallback to the
song's key signature. Relative minor and modal interpretations also remain open.

## Phase 2: lick eligibility and practice integration

Status: implemented locally and sandbox-validated. Preview and Start share the
analysis, matching and planning path. Unit, browser and TypeScript/Svelte checks
are complete. No deployment has been performed.

Integration decisions for this increment:

- `PracticeTarget` distinguishes a named progression from a `major-region`.
  No generated progression template, persisted tag or backing track is added.
- Existing readiness/tempo/ranking filters are shared with region matching.
  Cadence categories/tags and licks written over changing chord roots retain
  their progression-specific fit path.
- Use the last sounding note, not padded `lengthBars`, to check region fit.
  Preserve authored pickup offsets from the region start; do not move a pickup
  before that boundary. Require the lick's meter to match the tune in this phase.
- Decide competing region keys before looking at available licks: cadence
  evidence, song-key support, then supported span length. Equal overlapping
  alternatives remain unassigned.
- Place filled and bare cornerstone windows before general windows. Keep
  lick-aware choices within a cornerstone, and retain its full analysis
  reservation regardless of which subwindow gets a lick.
- Close region capture exactly at the region end, without the usual one-beat
  lead-out, so it cannot capture the next cornerstone's entrance.
- Preserve overlapping analytical readings in `compatibleMajorRegions`; the
  planner consumes the reserved-space `majorRegions` candidates. Autumn's raw
  G-major reading includes Bm7 while the suggested exercise stops before it.
- Regions retain their analysis evidence on insertion points and preview markers.
  Their own rotation pool and “Major region” label distinguish them from a
  single major chord without changing saved progression tags or audio harmony.
- Compatible vamps may combine into fewer, larger windows (for example, When
  the Saints now has three windows per chorus rather than five). Pickup chords
  still enter at bar 1; reduced window counts do not remove that entrance.

### Form boundaries and cyclic identity

The full Autumn fixture ends with a minor ii–V that resolves to the first chord
of the next chorus. Fully cyclic analysis therefore reserves the opening chord
as well as the final ii–V. That is a valid repeating-form interpretation, but it
is not the current session's capture model: scored windows stop at the form edge
and are replicated for each chorus. An inferred next occurrence must not reserve
the earlier occurrence at offset zero on that finite timeline.

Keep `analyzeHarmony`'s default cyclic reservation behavior for analytical callers.
Live planning explicitly uses `reservationScope: 'form'`: preserve cyclic
progression identity, reserve its in-form tail, and clip that window to the form
end. Drop role suggestions that start at the recycled opening or whose sounding
length requires crossing the edge. The final cadence's marker stays on its
final-bar entrance; the opening receives its own three-bar region. All
cornerstones fully inside a form retain their complete reservations, including
Autumn's bar-4 minor arrival. This rule applies to every chorus, with or without
a head, and independently to the selected closing chart.

This is a finite practice-window policy, not a claim that the opening chord
loses its function in the incoming cadence. Supporting a scored cadence across
choruses requires occurrence-aware windows, reservation of the next physical
resolution, and different first/middle/final chorus plans. That remains a later
milestone; do not silently enable cross-chorus capture using wrapped source
indices.

Introduce a discriminated practice target (`progression` or `major-region`),
rather than extending `ChordProgressionType` with a fake vamp. Carry the actual
region's boundaries and evidence through the matcher, planner and chart marker.
Keep cornerstone candidates separate from the window eventually chosen inside
them; their complete reservations survive every availability filter.

Initial broad-region eligibility should use a positive major identity: explicit
major mode, reliable tonic-major harmony, or the existing major-chord assignment.
Do not interpret the legacy `lickMode` default of major as proof that an
unclassified lick is major. Respect explicit minor mode. Cadence-specific licks
retain their chord/rhythm fit requirements; a shared major mode alone must not
make a ii–V–I line eligible everywhere. The user's explicit major assignment may
include idiomatic chromatic approaches; do not silently delete those licks based
on a blanket all-notes-in-scale rule.

Reuse own-book, playable-key and tempo filters. Transpose to the region tonic.
Initially offer licks at the region's start whose complete sounding span fits;
account for pickups, trailing notation padding, actual note ends and meter.
Never extend a broad window into a reserved cornerstone to accommodate a longer
lick. Shorter licks may leave space; they do not need to fill every beat.

Choose cornerstone windows first, then broad candidates in unreserved space.
Existing choices *within* a cornerstone (a whole cadence versus one of its chord
roles) can remain lick-aware. Broader regions cannot compete with them on length
or mastery. Resolve competing broad candidates by tonic/cadence evidence, tune-key
support and phrase boundaries; leave unresolved ties unassigned or expose a
choice rather than arbitrarily selecting a chromatic pitch-class order.

Use a player-facing label such as “G major” / “Major region”; never label changing
chords as “Major vamp.” Preserve the actual tune harmony for accompaniment and
scoring. Verify notation/playback provenance, head/solo/outro variants, repeated
choruses, pickups and partial-bar transitions before enabling the new path.

## Later milestones

| Milestone | Status | Scope / evidence needed |
| --- | --- | --- |
| Cross-chorus windows | Pending | Occurrence-aware cadence capture and incoming-resolution reservations; first/middle/final chorus handling |
| Phrase-aware ranking | Pending | Strong-beat targets, held tensions, resolutions, pickups; rank suggestions without rewriting licks |
| Ambiguity and tonic-free regions | Pending | Competing major/modal/relative-minor readings, contextual evidence across boundaries, user correction |
| Minor regions | Pending | Natural/harmonic/melodic minor and their changing sixth/seventh; avoid treating minor as one fixed collection |
| Controlled chromaticism | Pending | Secondary dominants, borrowed chords, passing diminished chords; distinguish “key center retained” from “one scale fits every chord” |
| Broader cornerstone vocabulary | Pending | Backdoor cadences, substitutions and other evidenced forms; add explicit identities and timing rules |
| Analysis explanations | Pending | Inspectable reasons, rejected alternatives and optional user overrides, with a versioned persistence design if needed |

## Acceptance and regression matrix

- Autumn fixture: opening concert-F region is exactly `[0,3)` whole notes;
  tenor label is G; bar-4 Am7 concert stays reserved with D7–Gm7.
- The same opening in every transposition produces the same relative boundaries.
- A local major region differing from the tune key remains discoverable.
- A familiar cadence wins even with an empty or entirely unready lick book;
  analysis has no book dependency and the live-session regression checks this.
- Major and minor cadences, turnarounds and nested candidates keep all reserved
  occurrences out of broad regions. Default cyclic analysis reserves both ends;
  finite live windows reserve the in-form tail without claiming the earlier
  opening occurrence.
- Unknown/altered symbols, slash bass, triads, additions and extended chords cannot
  be simplified into false positives. Changing `scaleId` alone changes no result.
- Ambiguous candidates remain inspectable; isolated chords and tonic-free windows
  do not invent a key center. Section/gap/partial-bar boundaries remain exact.
- Unsorted input retains original indices; repeats retain playback provenance;
  input objects are unchanged. Invalid/overlapping timing does not create regions.
- Existing progression detector and lick-fit tests remain unchanged and passing.
- Phase 2 covers actual suggestion, length, priority-with-no-lick, instrument,
  chart-marker and scored-window behavior in isolated sandboxes.

Run relevant suites through CircleCI Smarter Testing in the local Linux sandbox,
plus the sandboxed TypeScript/Svelte check. A new regression must be observed
failing against a deliberately broken rule before the final passing run.

### Validation record — 2026-11-07

- CircleCI Smarter Testing in a disposable Linux container on the dedicated
  Colima VM: **272 tests passed across 8 selected files**; 427 other discovered
  files excluded by the focused pattern, no selected files skipped.
- The 8 files cover new chord evidence and harmonic analysis plus existing
  chord parsing, progression detection, lick matching, progression fit and both
  session-plan/role-window suites.
- Negative check, in the container only: disabling cornerstone exclusion and
  written-symbol interpretation caused **29 failures**, including Autumn's
  opening boundary. Both rules were restored before the final passing run.
- `npm run check` in the same isolated container: **0 errors, 0 warnings**.
- Direct source inspection completed. No browser test was necessary for this
  standalone analysis increment; session/UI acceptance belongs to phase 2.

The final test command inside the container was:

```sh
circleci testsuite run 'unit tests' --local --run-tests=all \
  -t 'tests/unit/(music/(chord-evidence|chord-symbol)|tunes/(harmonic-analysis|progression-detector|lick-matcher)|lick-practice/progression-fit|state/tune-practice-(role-windows|plan))\.test\.ts$'
```

`--local` is intentional: the disposable sandbox has no CircleCI credentials
or project identity. The command must still run inside a sandbox, not directly
on the user's desktop. The standard `npm run test:sandbox -- check` runner built
the secret-free repository snapshot used for this validation.

### Phase 2 validation — 2026-11-07

- CircleCI Smarter Testing inside the isolated Linux container: **298 tests
  passed across 15 selected unit files**. No selected file was skipped.
- Added matcher and real-store session coverage for major identity, cadence
  restrictions, actual sounding length, pickups, meter, own-book membership,
  target-key/tempo readiness, competing-key ambiguity, transposition, centers
  outside the tune key, marker provenance, repeated choruses, head/outro and
  alternate endings. Default cyclic analysis and finite session reservations
  are checked independently.
- The Autumn regression explicitly retains the overlapping major reading
  through Bm7 while assigning its exercise to the following cornerstone.
- Negative check in the container only: removing the sounding-length limit and
  reinstating the usual one-beat lead-out produced **3 failures**. Restoring
  both rules produced the passing run above. A gap-after-region case proves
  the exact capture boundary independently of the next window's clamp.
- `npm run check` in the same sandbox: **0 errors, 0 warnings**.
- Browser regression against the production build in Chromium, Firefox and
  WebKit: **71 unique cases passed, 16 expected Linux Firefox audio cases
  skipped**, across all 5 selected files (91 other files excluded). No selected
  file was skipped. The initial pass loaded a stale blues-count assertion;
  the corrected file's fresh rerun passed all 29 runnable cases, with its 7
  expected audio skips. There are no remaining failures.
- Unit selection ran all 15 selected files; 422 unrelated files were excluded.
  Logs, JUnit reports and inspected screenshots are retained locally under
  `test-results/harmonic-analysis-phase2/` (gitignored).
- The rendered Autumn setup chart was inspected: the major lick spans bars
  1–3, and the following cadence begins at bar 4. Existing When the Saints
  count assertions now reflect broader regions (3 windows per chorus).

Unit command inside the container:

```sh
circleci testsuite run 'unit tests' --local --run-tests=all \
  -t 'tests/unit/(tunes/(major-region-matcher|harmonic-analysis|lick-matcher|progression-detector)|music/chord-evidence|state/tune-practice.*|lick-practice/progression-fit)\.test\.ts$'
```

Browser command inside the container:

```sh
circleci testsuite run 'e2e tests' --local --run-tests=all \
  -t '^(tune-harmonic-regions|tune-practice-setup|tune-practice|tune-wrap-label|tune-jam-endings)\.spec\.ts$'
```

## Maintenance and rollout

For each increment, update this document with what is implemented, what is
connected to the app, validation results and remaining decisions. Keep the
fixture cases as executable specifications; add counterexamples before loosening
rules. Measure missed opportunities separately from incorrect suggestions.

Neither phase needs a migration or network service. Phase 2 now connects the
complete preview/session path, including scoring candidates and chart labels.
Production deployment and human musical acceptance are separate from local
implementation and tests. Further changes should keep both surfaces on the same
planning path.

## Decision log

- 2026-11-07: major-scale compatibility generalizes beyond named progressions.
- 2026-11-07: cornerstone priority overrides maximal diatonic extent and lick
  availability; Autumn's opening ends before bar 4.
- 2026-11-07: retain the m7 versus m7b5 distinction in the minor-arrival variant.
- 2026-11-07: implement an inspectable analysis foundation first; connect the
  complete preview/session path in phase 2.
- 2026-11-07 (user clarification): key-center and progression readings may
  overlap. Cornerstone priority governs exercises, not exclusive harmonic truth.
- 2026-11-07: major regions use positive lick identity and actual sounding span;
  cornerstone reservations never depend on available or ready licks.
- 2026-11-07: finite session reservations follow physical in-form occurrences;
  full cyclic interpretation remains available separately. Cross-chorus capture
  needs occurrence-aware planning before it can be enabled.

## References

- [Tune System](./tune-system.md): current detector, matcher and timeline contracts.
- [Lick Alignment](./lick-alignment.md): placement and duration semantics.
- [Humdrum key documentation](https://www.humdrum.org/tool/key/index.html): an
  example of distinguishing key-match strength from competing-key ambiguity;
  the initial implementation here uses explicit chord evidence, not that algorithm.

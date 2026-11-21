# Harmonic Analysis

Living implementation plan. Started 2026-11-07 (Pacific). Update the milestone
status, decisions, acceptance cases and remaining limitations as work lands.

The current increment compares every bar of the production arrangement of
[All the Things You Are](./all-the-things-harmonic-audit.md) with the key-center
display. G major now spans chorus bars 14–20, and A♭ major returns at bar 24 and carries
through the descending line in bars 30–32. Autumn remains a reference for distinguishing
a tonicization from a change of governing key.

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
| 4 | Am7, D7 | Bm7, E7 | iii, V/ii; overlapping short minor arrival |
| 5 | Gm7, Am7 | Am7, Bm7 | ii, iii: return to the opening harmony |
| 6 | Bbmaj7, C7 | Cmaj7, D7 | IV, V |

Bars 1–3 contain only notes of F major (G major written for tenor), including
a dominant-to-tonic arrival in bar 3. Bar 4's first chord also belongs to that
scale, but belongs functionally to the following cornerstone. The major practice
window therefore ends at the **start of bar 4**, not at its E7 or at the next
barline after it. The strictly scale-compatible G-major reading continues through
Bm7 to the E7 entrance. The **governing G-major center continues through bar 6**:
E7 is a brief secondary dominant, V/ii, resolved by Am7 before the opening harmony
returns. These are different analytical layers. A G-major key-center rail must
not authorize a G-major lick across E7. The exercise boundary cannot depend on
the available lick library. Production's stored chart was checked read-only on
2026-11-17 and confirms these six bars; bar 7 changes to Bm7♭5 in tenor.

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

Historical checkpoint (2026-11-07): implemented locally and sandbox-validated. No production
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

Original integration decisions (tag eligibility and rotation are revised in phase 3):

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

## Phase 3: progression vocabulary, setup inventory, and session variety

Status: implemented and locally validated (2026-11-10). Production rollout and
human musical acceptance remain separate from code delivery.

The All the Things You Are example exposed an overly narrow reading of practice
intent. With no ready cadence-category lick, the planner repeatedly filled ii
and V with separate minor and dominant lines. Major lines explicitly tagged for
long ii–V–I still landed only on I. A cornerstone identifies the musical passage;
it must not restrict that passage to licks bearing the same category name.

### Explicit whole-progression uses

- An ordinary tonic-major lick carrying `prog:ii-V-I-major-long` can start at ii
  in the detected cadence's tonic key. Keep its category and stored tags intact;
  the suggestion carries its whole-progression placement independently.
- A matching tag is required for this first increment. Untagged major licks keep
  their tonic-chord placement. Do not infer new whole-cadence uses, short-cadence
  tags, minor uses, or altered-harmony substitutions.
- Require positive major identity and retain the changing-root/cadence-category
  fit path. A tag adds a use; it no longer removes an otherwise valid general
  major-region use.
- Check actual sounding end, meter, and pickup offsets against the detected span.
  Trailing rest padding does not consume harmonic room. Never stretch, truncate,
  or move a pickup before the window to make a tagged line fit.
- Whole-progression suggestions join the cadence phrase pool before chord-role
  fallbacks. A short phrase may leave space inside its cadence; that space does
  not demand a second automatic lick. Existing cornerstone reservations remain.
- Preserve the existing target-key and tempo readiness rules. Broader harmonic
  eligibility is not permission to automatically suggest unready vocabulary.

### Setup inventory versus the performed plan

- Setup collects fitting alternatives before overlap selection and per-window
  limits, using the same matching, role sizing, finite-form clipping, repeat and
  closing-chart projection as the session planner.
- Group by underlying lick and retain per-placement key, chart span, musical use,
  and separate key/tempo readiness. Deduplicate repeated chorus occurrences.
- Show every fitting own-book lick, including those not selected by rotation.
  Distinguish ready now from needs practice; expand to show exact placements and
  the readiness reason, including the practiced tempo.
- Opening a lick highlights its placements on the visible chart. The user can
  restore the selected session plan. Inspection does not change the next session.
- Keep the chart primary, with compact expandable rows in the existing sidebar.
  Setup inventory never feeds unready suggestions back into automatic sessions.

### Rotation

Count usage by underlying lick across the session's keys, progression types and
choruses. Avoid consecutive repeats when another eligible lick exists, then pick
the least-used option, retaining matcher rank for ties. Reset usage per session;
no persistence or invented cross-session proficiency is added. This permits
native cadence phrases and tagged major phrases to share the same opportunities.

### Validation targets

- Tagged Major lines begin at ii in the local tonic; untagged lines still begin
  at I. Long tags do not authorize short-cadence whole-progression use.
- Reject sounding overflow, invalid offsets, silence-only lines and wrong meter;
  retain valid pickups and ignore trailing padding.
- A ready whole phrase wins over separate ii/V lines; when unavailable, the
  original chord-role fallback survives. Setup retains both alternatives.
- Inventory includes unselected ready lines and unready lines with correct
  reasons, responds to tempo/key changes, and never alters preview/Start parity.
- Rotation shares counts across keys and progression types, including transposed
  IDs, and avoids consecutive repeats when possible.
- Browser checks at desktop/mobile widths verify the full candidate list,
  placement highlights, written keys, tempo reactivity and layout containment.

### Validation evidence (2026-11-10)

- CircleCI Smarter Testing: 314 focused unit tests across 16 files passed,
  including the stored All the Things You Are chart with three ready major
  lines and a slower alternative. Preview/Start agree, phrases start at ii,
  and target keys follow the local tonic.
- Setup browser suite: 23 passed, one expected Linux Firefox audio skip across
  Chromium, Firefox and WebKit, at 1440px and 390px. Screenshots inspected;
  candidate visibility, written keys, tempo updates, accordion selection and
  chart highlighting verified.
- Live-session browser suite: 29 passed, seven expected Linux Firefox audio
  skips; combined with setup, 52 passed and eight skipped across two spec files.
- `npm run check`: zero errors and warnings. Existing SvelteKit alias deprecation
  notices remain outside the diagnostics count.
- CodeRabbit local review: one minor finding, fixed by synchronizing the expanded
  candidate row with the chart selection; browser regression checks passed.
- No database changes, proficiency edits or production-account writes.

## Key-center highlighting

Status: initial implementation and local validation complete (2026-11-15).
Production verification and human musical acceptance remain separate.

The former “Harmony colors” control calls `tunes/harmony-colors.ts`. It tints
individual tonic, subdominant (including ii) and dominant chords relative to the
**whole tune's key**. It neither detects progression spans nor establishes local
key centers. Neutral chords are simply outside that small role classifier.

Replace the existing control with **Show Key Centers**, as requested on 2026-11-15.
There is no separate chord-role display mode. Tune detail and practice setup share
the display preference; editor/import use the same marker builder and control.
An explicitly saved old display preference is the fallback until the user chooses
the new one. Show compact labeled rails in reserved gutters, with separate lanes
for genuinely competing centers. Analytical explanations remain in the display
model; the current compact UI has no expandable reading panel.

Implementation decisions for this increment:
- Analyze the finite displayed form with expanded repeats, then project contiguous
  pieces through section/bar provenance. Do not paint across repeat jumps or
  skipped endings. Retain visit numbers when a printed passage has repeat contexts.
- Practice and solo charts reuse the session’s solo-form mapping, excluding
  pickups and head-only sections without shifting their printed bar locations.
- Show compatible major collections and cornerstone destinations, with their
  separate explanations. Merge duplicate visual coverage only for the same center;
  retain each analytical explanation. Stationary chords alone and unsupported
  symbols do not establish a new center. Minor arrivals describe a destination,
  not a broad minor-scale region. Blues has its own explicit label.
- Name an implied progression center explicitly when its tonic is absent; a
  ii–V can suggest its destination before the arrival appears in the chart.
- Key colors follow the written tonic; text labels and reading details do not
  require color discrimination. Minor bands also use a dashed outline.
- Keep display state outside session planning, readiness, rotation and scoring.
  Freestyle may show key centers without gaining insertion windows.

- Build from the same `analyzeHarmony` evidence and cadence local keys used by
  practice. Show full analytical readings (`compatibleMajorRegions`), not only
  the unreserved exercise windows (`majorRegions`). A cornerstone and its key
  center can coexist; its reservation must not make that key disappear visually.
- Distinguish a supported tonal center from mere shared-scale compatibility.
  Preserve ambiguous readings and unknown gaps. Do not force the song key into
  passages without supporting evidence, or imply broad minor-region detection
  merely because a minor cadence supplies a local tonic.
- Label keys in the player's written pitch (for example, concert F is tenor G),
  with consistent key colors and a compact legend. Use text as well as color.
- Show shared chords and transitions with compact bands/boundary cues; do not
  paint overlapping readings as mutually exclusive harmonic facts. An inspection
  should explain the competing reading and the chosen practice boundary.
- Project evidence through notation/playback provenance, including repeats,
  pickups, partial bars and alternate/closing endings. Distinguish different
  occurrences when a printed chord participates in different contexts.
- Keep lick insertion bands and the playhead legible. Turning the display on or
  off must not change suggestions, backing harmony, capture windows or readiness.
- Acceptance: Autumn's G-major reading can include the shared Bm7 while its
  exercise still stops before bar 4; All the Things You Are shows secondary local
  centers independently of its signature; transposition, ambiguous regions,
  repeated forms and phone-width labels remain correct.

### Validation evidence (2026-11-15)

- Linux sandbox: 150 focused unit tests passed across analysis, key-center
  projection, preference migration and practice planning. Replacing full
  compatible collections with reserved exercise regions caused 13 expected
  failures, confirming that the overlap regressions detect that mistake.
- Chromium, Firefox and WebKit: 119 distinct checks passed across seven tune
  suites, with four existing Linux Firefox audio skips. The final 36-case batch
  passed 35 with one such skip after correcting fixture seeding and the test's
  mistaken assumption that a ii–V cannot imply a center before its tonic.
- Desktop and 390px phone screenshots were inspected; notation, lick labels,
  legends and shared-chord bands remain legible. Browser assertions also cover
  preference persistence, transposition, split-bar chord strips, freestyle,
  All the Things You Are and changes to closing-ending context.
- TypeScript/Svelte validation reports zero errors and zero warnings. No session
  eligibility, reservation, capture or scoring rules change in this increment.

## Phase 4: phrase-aware ranking

Status: initial implementation and local validation complete (2026-11-14).
Listening acceptance remains separate; this is a conservative first ranking rubric.

Existing harmonic fit, explicit tags, own-book membership, readiness, tempo and
cornerstone reservations remain eligibility rules. Ranking adds no new eligible
lick and removes none. It never edits notes, stretches timing or moves pickups.

- Assess the transposed notes against the **actual analyzed playback harmony**,
  not the template or a per-quality `scaleId`. Pass that timeline explicitly to
  matching, including solo omissions and alternate closing charts.
- Reward chord-tone attacks on strong beats, duration-weighted support for held
  notes through chord changes, short offbeat stepwise approaches resolving
  immediately to a supported target, and a supported final sounding note.
- Meter matters: 4-beat measures emphasize beats 1 and 3; simple other meters
  claim the downbeat; compound meters use dotted beats in their stated unit. Asymmetric
  groupings beyond the downbeat are deferred until explicit grouping exists.
- Tied continuations are one attack and one sustained event. Rests, pickups and
  the last sounding end keep their authored timing; trailing rest padding is
  irrelevant. Do not credit a resolution across a rest or a phrase boundary.
- Written extensions/alterations/slash bass remain authoritative. Unknown chord
  evidence, malformed or overlapping timing, gaps under sounding notes, a meter
  mismatch, or notes beyond the supplied form yield an unassessed/neutral rank.
  Do not substitute template harmony or cyclic opening chords for missing evidence.
- Store inspectable counts with a weighted support score, not a probability or
  proficiency grade. Strong attacks count twice, held notes by beat duration,
  approaches and the ending once. Unassessed candidates use a neutral midpoint
  for deterministic sorting; the score is rounded before comparison.
- Within the existing mastery and match-source tiers, use phrase support before
  practice-set membership, category specificity, difficulty and alphabetical
  ordering. Session rotation still avoids repeats and prefers less-used eligible
  licks; musical rank breaks those ties, so variety is preserved.
- Synthetic trick examples are already transposed and must not be transposed
  again during assessment. Real phrase transposition is octave-independent for
  chord support, while stepwise resolution uses actual melodic intervals.

Limitations: chord-tone support is not a complete model of jazz phrasing. A held
unwritten ninth or intentional unresolved tension may rank below a more literal
line, but remains available. Listening calibration, stylistic tension preferences,
phrase placement alternatives, and richer multi-note resolutions are subsequent
work. This phase does not claim human musical acceptance or implement the planned
key-center display.

### Validation evidence (2026-11-14)

- CircleCI Smarter Testing in the isolated Linux sandbox: **258 tests passed in
  13 files**. Coverage includes actual chord changes, held/tied notes, chromatic
  approaches, pickups, all 12 transpositions, meter, unknown evidence, readiness,
  rotation, shortened solo forms and alternate closing harmony.
- Negative check in the container only: removing phrase support from sorting
  failed the tagged-major ranking regression, reverting to the alphabetical
  tension line. Restored the rule before the final passing run.
- Browser suites `tune-harmonic-regions` and `tune-practice-setup`: **30 passed,
  3 expected headless Linux Firefox audio skips**, across Chromium, Firefox and
  WebKit. The new regression verifies that both ready lines remain in setup,
  the better-supported line wins despite its alphabetical name, and Start uses
  that same line on the playing chart. Existing setup coverage includes desktop
  and phone widths, tempo changes, inventory inspection and readiness labels.
- Sandboxed TypeScript/Svelte check: **0 errors, 0 warnings**. The default 2 GB
  Node heap was insufficient; the passing run used a 3 GB heap. An overlapping
  browser build was killed by VM memory pressure before tests began; the final
  heavy checks ran sequentially and passed. Existing alias deprecation notices
  remain outside the diagnostics count.
- Direct source review completed. No database/proficiency changes or production
  account writes. Dev delivery does not establish production or musical acceptance.

## Contextual key centers — 2026-11-17

Status: implemented and sandbox-validated. This increment takes priority
over cross-chorus windows following the production Autumn review.

- Add `contextualMajorRegions` to the analysis result, separately from strict
  `compatibleMajorRegions` and reserved `majorRegions`. No matcher or planner
  consumes the new regions as lick eligibility.
- Require an established V–I arrival in at least two bars of compatible harmony.
  Do not use the song signature to force a center. Inspect all twelve possible
  keys, using authored chord evidence rather than per-chord scale defaults.
- Permit one applied dominant event of at most one bar, immediately resolving by
  fifth to a diatonic major/minor triad on ii, iii, IV, V or vi. Repeated notation
  segments of the same chord count as one event. Require the dominant-seventh
  core and reject unexplained chromatic extensions or bass tones.
- Require prompt return to varied established harmony: at least three roots,
  two shared non-target roots, and the parent's tonic or dominant within two
  bars. The returning compatible span must last at least one bar. A prolonged
  destination, unexplained chord, gap or section/repeat boundary prevents bridging.
- Paint the continuing major rail. Retain contained cornerstone readings with
  `contextKey` and V/degree explanations as subordinate tonicizations rather
  than equally prominent competing key rails. Other overlapping readings remain.
- Autumn acceptance: G-major rail covers bars 1–6; A-minor arrival at bar 4 is
  retained as a tonicization, while the later minor cadence from bar 7 is still
  visible. Strict G compatibility ends at bar 4 beat 3 and the major exercise
  still ends before bar 4. The rule must work in every transposition and away
  from the tune's signature. Tune chart and setup use the same projection.

This is intentionally a conservative first contextual rule, not a full modulation
model. Multiple chromatic events in one region, altered secondary dominants,
tonic-free context, borrowed chords and passing diminished harmony remain future
work. The returning-vocabulary thresholds need musical calibration on more tunes.

### Validation and delivery

- CircleCI Smarter Testing in the isolated Linux sandbox: **375 unit tests passed
  across 17 selected files** (575 unrelated files excluded, no selected file
  skipped), covering analysis, all 12 transpositions, unrelated signatures,
  applied degrees, counterexamples, repeat projection and existing lick planning.
- Disabling contextual analysis in the sandbox caused **33 expected regression
  failures**; restoring it returned the complete selected suite to green.
- TypeScript/Svelte: **0 errors, 0 warnings**. The first check exhausted Node's
  default heap; the successful run used a 3 GB heap inside the 4 GB container.
- Chromium, Firefox and WebKit: **66 distinct browser checks passed**, with
  **3 existing Linux Firefox audio skips**, across `tune-key-centers`,
  `tune-harmonic-regions` and `tune-practice-setup` (126 unrelated files excluded).
  A new assertion initially queried the chord-only renderer after navigating to
  the engraved setup chart. Correcting that locator yielded a fresh **36/36**
  pass for the full key-center file across all three browsers.
- Inspected desktop tune-chart and mobile setup screenshots: continuous G-major
  rails through bar 6, the later minor cadence visible, existing lick windows
  retained. Reports and screenshots are retained under
  `test-results/harmonic-analysis-contextual-centers/` (gitignored).
- Direct source review completed. Delivery target: `dev`; no schema, account
  data or proficiency changes, and no production deployment in this increment.

Commands inside the isolated container:

```sh
circleci testsuite run 'unit tests' --local --run-tests=all --analyze-tests=none \
  -t 'tests/unit/(tunes/(tonal-centers|key-centers|harmonic-analysis|major-region-matcher|lick-matcher|progression-detector)|state/tune-practice.*|music/chord-evidence|lick-practice/progression-fit)\.test\.ts$'
circleci testsuite run 'e2e tests' --local --run-tests=all --analyze-tests=none \
  -t '^(tune-key-centers|tune-harmonic-regions|tune-practice-setup)\.spec\.ts$'
```

## Longer governing key centers — 2026-11-18

Once a V–I cadence establishes a major key, the chart can carry it across
successive secondary dominants. Each dominant must resolve immediately and the
following chords must independently meet the November 17 return criteria using
the harmony just before that excursion. A failed return ends the span at the
last supported chord. The analysis records each successful V/degree with its
own segment indices. Practice still allocates each cornerstone independently.

For wholly diatonic passages, prefer a single cadenced parent key when it
contains the entire competing collection and lasts at least one bar longer.
The shorter reading stays inspectable. A cadence in the shorter reading, an
equally long reading, or multiple qualifying parents preserves the alternatives.

Regression examples (concert pitch):

- In Autumn at bar 16 the local minor arrival overlaps a change between two
  established major centers. The split at beat 3 is described below.
- C6–F6–C6–G7–Cmaj7 gives one five-bar C rail. F major also fits the first
  three bars, but the only cadence establishes C. This also holds with an F
  key signature.
- After C is established, A7–Dm7 and E7–Am7 can occur in the same C span when
  each returns to familiar diatonic harmony. A subsequent A7–Dmaj7 with a
  confirming cadence in D starts a separate reading.

Altered dominants, successive dominants without intervening returns, and
general minor-key continuity remain open. The one-bar margin is an initial
display choice for comparing fully contained readings.

The Linux sandbox passed 211 focused unit tests across six files, 39 chart and
setup browser cases across Chromium, Firefox and WebKit, and the TypeScript/Svelte
check. Both new display regressions reproduced the extra rail on the previous
dev revision.

## An applied dominant at a change of key

In the tenor chart of *Autumn in New York*, Em7–A7–Dmaj7 establishes D.
Bar 16 opens with Bm7, its vi7. E7 on beat 3 leads to Am7, the ii of the
returning G major. The subsequent D7–Gmaj7 confirms G. The chart places
the D-to-G boundary at the E7 entrance. The underlying Bm7–E7–Am7
minor-arrival interpretation remains available for cornerstone practice.

For any contiguous m7–V7–minor arrival, look for exactly one cadenced major
collection ending on its approach and one beginning on its resolution.
Require a different tonic on each side and a V–I arrival within four bars
on each side. The written approach must have a minor third and perfect fifth.
The dominant must supply a supported dominant seventh. Both the dominant
and its minor target may last up to one bar each. Read the target as ii, iii
or vi according to the incoming key. These timing bounds are conservative
defaults for distinguishing a tonicization from a sustained destination.

Use performed chord occurrences, including across the barline or into the
next section. Existing evidence for continuation in a single key has priority.
The strict collections still determine scale-based lick eligibility.

The Linux sandbox reproduced the previous bar-16 reading on both chart
timelines. The new rule passed transposition checks in all twelve keys,
separate iii and vi targets, and counterexamples for a prolonged tonic,
missing cadences, an altered dominant and a half-diminished approach. Across
the focused suites, 282 unit tests and 39 browser checks passed, including
the exact half-bar rail boundary in Chromium, Firefox and WebKit.

## Tonic-free passages between cadences

Analyze the passage between two major cadences in the same key. A brief
borrowed iv or a chromatic passing diminished seventh may explain the gap,
provided the neighboring diatonic harmony supports that function. Preserve a
separate record of the chord indices and their roles for the chart. The
four-bar passage limit and one-bar chromatic chord limit are initial calibration
choices. The [chorus audit](./all-the-things-harmonic-audit.md) records the
evidence, boundaries, ambiguous passages and remaining discrepancies.
Validation reproduced the baseline gap, then passed 255 focused unit tests,
39 browser cases across three engines, and the TypeScript/Svelte check.

## Let the sounded resolution settle the center

In *All the Things You Are*, chorus bars 14–20 now form one G-major span
(A major on tenor). Two rules supply the additional evidence.

- A contiguous iiø7 leading to a diatonic V7–I in major borrows its iiø
  from minor. The written tonic establishes the arrival mode. A short minor
  iiø–V cornerstone at that same occurrence remains available to practice
  and retains its explanation. Gaps and section boundaries interrupt the inference.
- Between two cadences in the same major key, a dominant seventh with a raised
  fifth can tonicize ii, iii or vi. Require the augmented dominant to last at
  most one bar and resolve directly down a fifth to a diatonic minor chord
  with a minor third and perfect fifth. The existing four-bar maximum for
  the intervening passage applies.

Both rules describe chart context. Lick eligibility continues to use the
written harmony and existing cornerstone reservations.

The tune fixture and a separate progression in all twelve keys failed before the change.
The Linux sandbox passed 1,148 unit tests across 85 files, all 39 key-center
browser cases across Chromium, Firefox and WebKit, and the TypeScript/Svelte
check. The browser tests cover the full width of each tenor chart bar and
the key labels on practice setup.

## An altered dominant introducing a different key

In chorus bar 24 of *All the Things You Are*, E major has just cadenced.
C7♯5 resolves to Fm7, and B♭m7–E♭7–A♭maj7 puts that Fm7 in context as vi.
Start the returning A♭-major chart span on C7♯5. The same opening followed
by Gø7–C7–Fm7 confirms F minor and earns no incoming A♭ span.

The outgoing cadenced collection must end on its major tonic. The written
7♯5 must resolve directly down a fifth to ii, iii or vi of a different major
collection that confirms its key with V–I. Allow up to one bar for the
dominant and one for the minor target. Require the two major tonic arrivals
within four bars of the dominant entrance and minor resolution respectively.
These initial limits apply in the tune's own meter. Adjacent segments of one
sustained chord count together. A gap, a section break across the approach,
or an unspecified alteration interrupts this reading.

The existing transition model records the exact dominant and resolution
occurrences and the target degree. Chart and setup use this evidence. The
new reading adds no scale-compatible lick window. Regression checks cover
all twelve transpositions, ii/iii/vi targets, split and prolonged chords,
gaps, section boundaries, and the F-minor counterexample. The Linux sandbox
passed 1,170 selected unit tests and all 39 key-center browser checks across
Chromium, Firefox and WebKit. The TypeScript/Svelte check was clean.

Next, compare the last bar of a repeated chorus with its actual final ending.

## Later milestones

| Milestone | Status | Scope / evidence needed |
| --- | --- | --- |
| Cross-chorus windows | Pending | Occurrence-aware cadence capture and incoming-resolution reservations; first/middle/final chorus handling |
| Key-center highlighting | Initial implementation validated | Shared chart/setup overlays, written-key labels, overlapping readings, repeat provenance and inspectable reasons; human musical acceptance remains |
| Phrase-aware ranking | Initial implementation validated | Actual-chord support at strong beats, held notes, immediate stepwise resolutions and endings; listening calibration and richer phrasing remain |
| Ambiguity and tonic-free regions | Pending | Competing major/modal/relative-minor readings, contextual evidence across boundaries, user correction |
| Minor regions | Pending | Natural/harmonic/melodic minor and their changing sixth/seventh; avoid treating minor as one fixed collection |
| Controlled chromaticism | Implemented for brief applied dominants, borrowed iiø and iv, and passing diminished sevenths | Incoming 7♯5 at a modulation implemented. Compare cyclic turnarounds, chained dominants and further borrowed chords. |
| Broader cornerstone vocabulary | Pending | Backdoor cadences, substitutions and other evidenced forms; add explicit identities and timing rules |
| Analysis explanations | Structured reasons implemented | Key-center evidence, implied destinations, subordinate tonicizations and chart visits remain in the model; compact user-facing inspection and optional overrides remain |

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

### PR #300 review follow-up

- A malformed imported tail (for example, retained 3/4 meter followed by 4/4
  harmony) can make strict analysis reject the whole timeline. An empty analyzed
  progression list now falls back to the existing shape detector, retaining
  usable windows whose starts lie inside the played form. Normal capture clamps
  still apply; starts beyond the form are discarded. Analysis reservations are
  unchanged and invalid timelines still produce no general major regions.
- A real preview/Start regression failed before the fix (zero windows), then
  passed with it. The focused sandbox suite now passes **299 tests in 15 files**.
- Added function documentation for practice-target helpers, region scanning and
  fixture setup in response to the review's docstring-coverage warning.
- Follow-up review extended the finite-form rule to fallback roles, suggestions
  and chart markers. Roles opening after the form are dropped, crossing windows
  are clipped, and only licks fitting the retained span remain eligible. Two
  new negative cases failed before this fix; a positive case retains a short
  tonic lick inside a clipped tail. The focused sandbox suite now passes
  **302 tests in 15 files**, with a clean TypeScript/Svelte check.

## Maintenance and rollout

For each increment, update this document with what is implemented, what is
connected to the app, validation results and remaining decisions. Keep the
fixture cases as executable specifications; add counterexamples before loosening
rules. Measure missed opportunities separately from incorrect suggestions.

These phases need no migration or network service. Phase 2 now connects the
complete preview/session path, including scoring candidates and chart labels.
Production deployment and human musical acceptance are separate from local
implementation and tests. Further changes should keep both surfaces on the same
planning path.

## Decision log

- 2026-11-17: favor the simplest supported governing center over a new key for
  every short arrival. Autumn's first six bars remain G major in tenor, with
  E7 as V/ii. Retain the minor-arrival reading and cornerstone reservation;
  distinguish tonal continuity from strict scale and lick compatibility.

- 2026-11-15: replace Harmony colors with Show Key Centers rather than retaining
  multiple coloring modes. Share display state and evidence across tune detail,
  practice setup, editor and import preview; preserve analytical overlaps and
  keep cornerstone exercise priority independent of display.
- 2026-11-15 (PR #307 review): apply the compound dotted-beat ranking grid to
  6/4 and 6/16 as well as 6/8. Regression cases fail on the original denominator
  restriction; asymmetric meter still claims only the downbeat.

- 2026-11-14: key-center visualization is a core harmonic-analysis deliverable,
  distinct from the current global-key chord-role colors. Begin phrase-aware
  ranking as a soft ordering rule; preserve eligibility, reservations and variety.

- 2026-11-10: explicit long ii–V–I tags authorize whole-cadence placement for
  tonic-major lines. Keep cornerstone identity; prefer a ready phrase before
  chord-role fallbacks, expose all fitting alternatives, and rotate across the
  entire session by underlying lick.

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

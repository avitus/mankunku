# PDF recognition and accuracy

The browser first reads explicit music glyphs and vector notation in exported PDFs. Supported measures can be imported locally without model calls. For scans and unsupported notation it extracts staff geometry, obtains small header readings, propagates printed context in reading order, and reads music with bounded concurrency. Harmony and melody use separate recognition requests. The current provider remains Anthropic; replacing it must not require changes to layout extraction, quality policy, or tune assembly.

| Boundary | Responsibility |
| --- | --- |
| `pdf-repeat-dots.ts` | Compact repeat-dot evidence with staff-ink exclusion; separate from model repeat flags |
| `pdf-geometry.ts`, `pdf-layout.ts` | Staff calibration, measure endings, crop boundaries, uncertain-layout detection |
| `pdf-notation-fonts.ts`, `pdf-legacy-text.ts` | Font-scoped legacy symbol/metric adapters and split chord-text decoding |
| `pdf-tuplets.ts` | Bounded joint assignment of printed triplet groups; ambiguous or overlapping assignments decline |
| `pdf-operators.ts`, `pdf-music-glyphs.ts`, `pdf-vector-paths.ts` | PDF.js 6 operator adapters; individual glyph coordinates and black vector paths |
| `pdf-glyphs.ts`, `pdf-glyph-rhythm.ts`, `pdf-glyph-form.ts`, `pdf-glyph-layout.ts` | Conservative monophonic notation, rhythm, ties, repeats, brackets, and recovery of obscured barlines |
| `pdf-embedded.ts` | Shared browser/evaluator fusion policy; exact embedded measures take precedence and optical failures preserve supported measures |
| `pdf-noteheads.ts`, `pdf-stem-noteheads.ts`, `pdf-raster-heads.ts` | Replaceable pixel detector contract; measured staff thickness selects stem/ring analysis or staff-masked shape matching |
| `pdf-review-image.ts` | Bounded enlarged source columns and opening accidental margins; predicted vertical positions are never drawn |
| `server/pdf-import/recognition-json.ts` | Shared decoding of one plain or fenced JSON value; rejects ambiguous/malformed responses before schema validation |
| `pdf-pitch-reconciliation.ts` | Provider-neutral reconciliation of aligned pitches with complete independent head evidence; preserves timing, rests, ties and form |
| `pdf-bar-review.ts`, `pdf-notation-review.ts` | Provider-independent review orchestration and two-reading notation acceptance; reader supplied through a callback |
| `pdf-accidental-review.ts` | Advisory explicit-symbol observations with independent count alignment; never rewrites pitches |
| `pdf-harmony-reading.ts` | Indexed per-measure chord screening, separate from network recovery |
| `pdf-system-extract.ts` | Browser/PDF.js adapter; full system/header crops, isolated QA measures, original measure images, text and notehead observations |
| `pdf-recognition.ts` | Provider-neutral inputs, printed-pitch bars, context, harmony, and `SystemRecognizer` interface |
| `pdf-context-run.ts` | Cheap concurrent header observations, ordered inheritance, concurrent music requests, preserved failure slots |
| `server/pdf-import/anthropic-*.ts` | Current provider prompts, response screening, independent harmony/context readers, bounded reread |
| `pdf-recognition-quality.ts`, `staff-pitch.ts` | Disagreement policy and deterministic spelling from staff coordinates, signatures, explicit accidentals and ties |
| `omr-transcription.ts`, `omr-quality.ts` | Untrusted file conversion separate from acceptance/alignment policy |
| `pdf-system-assemble.ts` | Text harmony precedence, vision harmony fallback, structural assembly |
| `pdf-accuracy.ts` | Provider-independent precision/recall and release targets |

## Behavior

A staff's opening border does not close a measure. Header scanning runs after removing that border, preventing phantom pickups and preserving the real first measure. System crops include the chord row and stop before the next system's chord row. If a page has no recognizable staves or the detected boundaries are inconsistent, the importer uses the existing whole-document fallback. That fallback is still probabilistic; declining an unsafe skeleton does not guarantee a correct transcription.

Omitted key signatures and clefs inherit from the preceding explicit header observation. Zero fifths means an explicit natural-key observation, not “nothing printed.” Melody calls receive the resolved context. The tune's opening key comes from the first explicit reading, not a majority vote that can turn omissions into C major. Printed meter mismatches remain review warnings: the application's tune model still has one declared meter.

For systems without text-layer chords, harmony is read independently. Vision harmony never replaces text-layer chords in the same measure. It also runs when accepted OMR supplies melody. Failed harmony does not discard accepted OMR melody. When full-system harmony fails measure alignment or individual chord validation, reread available unannotated measure crops independently, keeping their original indexes. Recovery is bounded to eight measures per system with two concurrent requests; unrecovered measures retain explicit warnings. Text/vision disagreement and incomplete text-layer coverage remain areas for further evaluation.

Pitch QA compares staff letter **and octave**, even when note counts agree. It does not compare accidental spelling to accidentalless pixel evidence. The detector currently interprets treble staff coordinates; its pitch evidence is disabled for other clefs. A focused quality reread gets its own two-minute deadline even after a slow first attempt. Isolated measure crops carry numbered staff coordinates and, for up to twelve detected heads, enlarged narrow head columns that exclude nearby flags. The columns retain the full vertical staff range and use only horizontal anchors; the model must independently read each vertical position and accidental. The original whole measure remains visible, and panels are clipped to its source boundaries. The opening boundary is a content estimate rather than a printed barline, so the first measure retains two interlines of leading ink for accidentals; interior measures retain their exact left barline. Oversized panel sets retain the ordinary crop. Focused review uses the configured tune model with adaptive reasoning and an 8,192-token ceiling. When the existing rhythm tiles the measure, ordinary pitch review preserves its timing and ties. Dotted durations, adjacent untied repetitions, and note-count disagreements with complete pixel evidence additionally trigger notation review: two full-measure observations must agree on timing, rests and ties, tile the meter, and independently match complete staff-position evidence before replacing a clean rhythm. A disagreement retains the original rhythm and an explicit warning. Staff coordinates and explicit accidentals are converted to pitch deterministically, with within-bar accidental state and cross-bar tie handling. Candidates need clean rhythm and complete independent notehead agreement (or repair a broken rhythm) before replacing a bar. When both readings have clean timing equal within 0.001 beats and unchanged note/rest alignment, a partially corroborated reread can supply individual pitches whose letter and octave agree with complete pixel evidence. Other pitches, timing, ties and form remain from the original reading, and unresolved disagreements remain warnings. Incomplete head evidence, unsupported clefs, or changed event alignment prevent partial reconciliation. When a reread changes an accidental while retaining the same letter/octave at the corresponding head index, preserve the original accidental and produce a review warning: pixel coordinate agreement cannot adjudicate that symbol. This conservative rule can retain a wrong original accidental. A separate symbol-only pass adds specific source-review suggestions when two observations agree on every sign and independently count the measure's heads, and the melody aligns with complete staff-position evidence. These observations never change pitches: in the held-out raster Lady Bird evaluation, both readings mistook a printed natural for a flat and automatic correction damaged a correct note. Symbol absence never erases an accidental. Suggested signs carry within the measure, and tie conflicts remain explicit. Unknown/non-treble clefs, missing head evidence and OMR harmony-only requests skip this pass. The two symbol calls run concurrently, each with a one-minute deadline and no retry; failures preserve the melody with a warning. Same-model agreement is not independent evidence of symbol correctness. At most four measures per system receive focused review, with one extra confirmation per notation candidate (eight calls total). The initial melody pass is bounded at six minutes; header/harmony reads have one-/two-minute deadlines. Caller cancellation aborts provider work. Header, harmony, system and focused-review adapters share JSON envelope decoding: one fenced JSON value may have surrounding prose, but multiple alternatives and malformed syntax fail. Schema checks, note counts, truncation checks and musical acceptance rules still apply.

OMR only bypasses melody recognition after exact document measure-count alignment and quality checks. Surplus or missing measures cannot safely be assigned to particular lines and cause a full fallback. Unparsed regions, empty or rhythmically invalid measures, decoder truncation/voice warnings, and long identical decoder runs are rejected. Correctly aligned unaffected systems may still be used. Full-bar rests are valid; a short opening pickup and its complementary final measure are handled explicitly. This policy is deliberately separate from Python normalization: raw output remains untouched.

## Embedded notation and correction

The direct reader uses [SMuFL glyph identities](https://smufl.formats.music/latest/tables/noteheads.html), calibrated staff positions, explicit accidentals, and vector stems/beams. It supports ordinary whole/half/black noteheads, rests, dots, common equal-duration triplets (including multiple printed groups in one measure), and visible ties, including matching continuation halves across systems. Header context distinguishes an initial signature-free C staff from a later omitted signature. Unsupported heads, ambiguous voices, grace-sized heads, unknown header accidentals, internal clef changes, incomplete rhythm, and printed meter mismatches decline automatic reading. A failure in one measure preserves other independently read measures at their original indexes. Optical pitch fusion requires exact note-count correspondence. Unknown measures are never matched by deleting extra notes.

The PDF.js-specific adapters are intentionally small and separate from music interpretation. New font conventions, PDF operator versions, or recognition engines should emit the existing observation/result interfaces. Direct reading currently targets black, horizontal SMuFL notation and explicitly identified Inkpen2/Inkpen2Std legacy notation; it is not a general PDF-to-MusicXML engine. Complex tuplets, polyphony, uncommon glyphs, navigation instructions such as D.C./D.S., and mixed meters still require review. A clean rhythmic tile is necessary evidence, not a universal accuracy guarantee.

The editor retains unannotated original measure crops in ephemeral import-review state. “Compare with original PDF” is collapsed by default; selecting a measure also moves the editor cursor to that bar. Source crops are cleared when loading another tune and are not serialized into saved tune data. Review warnings are deduplicated before rendering. The original PDF remains linked through the existing PDF store.

## Reproducible evaluation

Use Node 24 and installed Playwright Chromium. The evaluator imports the same application modules and renders the real PDF. A default run only measures layout:

```sh
npm run pdf:eval -- --pdf "Leadsheets/PDF/Lady Bird.pdf" --out /tmp/lady-layout
```

Run the complete exported-PDF corpus without a provider or API charges:

```sh
npm run pdf:eval:corpus -- /tmp/pdf-corpus-new-run
```

The command evaluates all nine existing MuseScore comparison charts through the same extraction, fusion, assembly, and transposition functions used by the uploader. It records per-chart manifests and a summary, and exits nonzero for any failed target. A single chart can be tested with `--glyphs-only` instead of `--live`.

Live evaluation requires `ANTHROPIC_API_KEY` and incurs provider charges. Use a fresh output directory each time:

```sh
npm run pdf:eval -- --pdf "Leadsheets/PDF/Lady Bird.pdf" \
  --reference tests/fixtures/leadsheets/pdf-accuracy/lady-bird.reference.json \
  --source Bb --live --runs 3 --out /tmp/lady-recognition

npm run pdf:eval -- --pdf tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-scan.pdf \
  --reference tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-first-system.reference.json \
  --systems 1 --live --runs 3 --out /tmp/black-orpheus-recognition
```

Each run retains the PDF and implementation hashes, Git revision, crops, provider identity, exact request/response bodies, timings, normalized result, and accuracy report. Credentials are never recorded. The Black Orpheus reference is an assistant's provisional visual transcription and remains `reviewed: false`; it cannot approve a release. The Lady Bird reference points to the existing verified MuseScore corpus fixture. `--source Bb` performs the same tenor written-to-concert conversion as the application.

Release targets require exact key, meter and measure count; 95% precision **and** recall for pitches, rhythms, complete note events (including ties), and chord positions; and exact repeat/pickup/ending form. Event comparisons retain locations, so wrong bars do not get credit through sequence alignment. Extra or duplicate hallucinated events reduce precision. Every recorded run must pass. `--replay-first-pass path/to/run-1-raw.json` permits cheaper development of the review pass; reports explicitly disqualify these mixed replay/live runs from release approval. Replay consumes recorded attempts once per image and model, including errors and fallbacks; missing attempts fail rather than silently making fresh melody calls. The manifest hashes the replay source. `--rescore path/to/run-1.json` recomputes metrics with a revised reference without overwriting the original evidence; it records both reference identities. Unreviewed references or unmet targets cause exit code 2, not an expected-failure exemption.

The historical `pdf-vs-musescore` tests remain regression checks on old saved imports. Their low floors and expected failures are not accuracy approval. Before claiming production accuracy, expand independently reviewed scan references beyond Black Orpheus's first system and evaluate the whole existing chart corpus, including obscured/highlighted layouts, repeated forms, pickups, tuplets, multiple pages and explicit context changes. Hermetic tests cover policy and browser plumbing; they cannot establish a live model's musical accuracy.

## Measured status (2026-10-10)

All nine exported reference charts pass the offline gate without model calls. All 710 pitched note events match their MuseScore references, including timing, duration and ties. Chords match 246/247 (99.6%); keys, meters, measure counts, and scored repeat/pickup/ending events match exactly. These results apply to this corpus, not all PDFs.

| Chart | Measures | Exact melody events | Chords |
| --- | ---: | ---: | ---: |
| Lady Bird | 16 | 53/53 | 15/15 |
| All of Me | 32 | 83/83 | 24/24 |
| All the Things You Are | 41 | 112/112 | 36/36 |
| Autumn Leaves | 28 | 67/67 | 24/24 |
| Body and Soul | 17 | 72/72 | 37/38 |
| Fly Me to the Moon | 32 | 101/101 | 34/34 |
| On Green Dolphin Street | 24 | 57/57 | 23/23 |
| Take the A Train | 25 | 68/68 | 21/21 |
| There Will Never Be Another You | 33 | 97/97 | 32/32 |

Body and Soul prints EΔ7/G# at written pitch; the existing MuseScore-import reference omits its bass note. The new reader preserves that printed slash chord, and the reference is unchanged. The corpus metrics exclude rests and do not score D.C./D.S. navigation, rehearsal-label names or spelling-only differences; this is an explicit measurement limit. The browser tests additionally verify actual upload, editor handoff, source comparison, saving, cancellation, partial failures and no-provider operation.

Previously, a full live Lady Bird run matched only 30/53 pitches and 49/53 rhythms and took about 4m44s. Its new direct result is exact and does not need an API key. This is a change of reading strategy, not evidence that the optical model became more accurate.

Black Orpheus remains an optical-recognition limitation. Its layout now has 39 measures rather than 48. A fresh live first-system test matched 10/12 pitched events, 12/12 rhythms, 6/6 chords, and the pickup form; it still fails the 95% melody target. Its assistant-created reference remains provisional and cannot approve a release. Replayed first-pass experiments with stronger focused reasoning did not improve this reliably and were discarded.

Additional isolated engine experiments were rejected as defaults: Audiveris 5.11.0 returned 15 measures for Lady Bird and 29 for Black Orpheus; HOMR found Black Orpheus's 39 measures but changed clefs, keys and meter and produced invalid durations. An experimental run conditioned on the known printed header improved context, but did not solve rhythmic errors. None of those runtimes, downloaded weights, or local engine patches were added to application dependencies. Raw experimental artifacts are preserved with the local evaluation evidence.

Software verification results are recorded with the final local delivery. Local verification and corpus success do not imply deployment or certification of scanned charts.

## Scan follow-up (2026-10-11)

The old pixel detector counted staff/tie ink as heads and displaced their centers in the thick-lined Black Orpheus scan. The new shape detector excludes staff/ledger rows from its ellipse and surrounding-whitespace scores, requires legal stem attachments or isolated hollow heads, checks ledger support, and resolves competing head/flag claims on one stem. Scores are geometric fit measures, **not calibrated probabilities**. Thin-line notation retains the existing stem/ring detector; a trial replacing it everywhere regressed engraved hollow notes and was rejected.

A compressed raster regression fixture now covers all nine Black Orpheus systems: 39 measures and 113 heads. Detection matches every expected count and staff coordinate. These are assistant-transcribed, provisional coordinates; they do not certify accidentals, rhythm, harmony, or full-chart import accuracy. Independent glyph-derived raster fixtures for Lady Bird and All of Me protect thin-line behavior. The original first-system regression failed with 16 detected heads instead of 12 before the fix.

A fresh first-system live run with enlarged panels matched 11/12 complete note events, 12/12 rhythms, 6/6 chords, and the pickup form, versus the previous 10/12 melody events. Its elapsed recognition time was approximately 63 seconds. The remaining mismatch is A natural versus the provisional reference's A sharp in the third printed measure. The reference remains unchanged and unreviewed; resolving this requires independent inspection of the accidental. Three final replay evaluations matched 11/12, 12/12, and 11/12 note events; the two conflicting accidental readings now remain visible as warnings. Replay experiments are development evidence only, and one earlier exploratory harmony request failed. These results still fall below the 95% target and do not establish reliability across scans.

The source-only panel adapter, pixel detectors, spelling rules, provider review, and acceptance warnings remain separate modules. No new runtime dependency was introduced. Exported-PDF recognition continues to prefer explicit glyphs, so pixel uncertainty does not replace supported embedded notation. Final software and corpus verification is recorded with the local delivery evidence; nothing here implies deployment.

## Legacy exported-PDF follow-up (2026-10-11)

Two additional PDFs exposed a separate failure mode: legacy Sibelius fonts encode music as ordinary-looking characters. `pdf-notation-fonts.ts` maps explicitly identified Inkpen2/Inkpen2Std music fonts into the existing SMuFL observation interface. Font names come from PDF.js's loaded font objects; subset prefixes are removed only for exact family matching. Prose, chord fonts, and unknown families are never interpreted as legacy notation. Unknown legacy music symbols block their measure; an unknown header symbol blocks context inheritance rather than reusing a potentially wrong clef or meter. Notehead ink width is separate from character advance, preserving text positions while correctly finding attached stems. `pdf-legacy-text.ts` separately decodes Inkpen2 chord fonts and joins touching split runs such as the three characters used to print “maj.”

Known glyphs now supplement otherwise plausible pixel layouts with full-staff vector boundaries, preserving existing boundaries and repeat evidence. They can also recover a content edge that swallowed early melody into the header. A leading accidental just before that edge must match exactly one note; it is not automatically counted as part of the signature. `pdf-tuplets.ts` solves multiple printed triplet labels together against the meter, using notehead centers, disjoint groups, a search bound, and an ambiguity margin.

| Additional chart | Before | After |
| --- | --- | --- |
| Donna Lee – Bb | No embedded notation; 31 detected measures | 32 measures, all 32 read locally |
| Do Nothing Till You Hear From Me – Bb | No embedded notation | 33 measures, all 33 read locally |

These are **coverage results**, not independently certified full-chart accuracy. Compressed PDF operator/text fixtures protect both Type 1 and TrueType font variants. Printed opening excerpts independently assert notes, within-measure accidentals, triplets, rests, and chord qualities. The existing nine-chart MuseScore benchmark remains the broader scored regression gate. No model/runtime dependency was added. Font translation, geometry, rhythm assignment, provider fallback, and assembly remain separate modules.

The full 39-measure Black Orpheus visual reference is now stored separately as `black-orpheus-full.reference.json`. It is explicitly unreviewed and cannot approve a release. It records uncertain accidentals and the HEAD/SOLOS harmony alternative instead of silently treating an assistant transcription as ground truth.

## Full-scan evaluation and repeat recovery (2026-10-11)

A fresh full Black Orpheus baseline took 554 seconds and returned all 39 measures with the correct key and meter. Against the **provisional, unreviewed** full reference, it matched 107/113 pitched locations, 111/113 rhythmic events, 105/113 complete pitched-note events, and 45/47 expected chord changes (46 observed). Scored form matched 3/5 events. The run fails the melody/form gates and cannot certify scan accuracy; the reference itself still needs independent review.

The model had read the final system's opening and closing repeats correctly, but assembly removed them because pixel corroboration failed. The new `pdf-repeat-dots.ts` isolates that detector and excludes staff ink before measuring a dot's vertical run. It accepts compact, slanted scan dots with clearance on at least one side of the middle staff line, while retaining width, height and surrounding-ink checks. The printed repeat regression now also passes through assembly. Reassembling the saved provider results with freshly extracted geometry retains all 5/5 scored form events; this is explicitly recorded as a replayed local regression experiment, **not a new live accuracy run**. Melody and chord metrics are unchanged. Other repeat-dot observations on this scan are unchanged, including ambiguous note-like evidence that still requires corroborating model repeat flags.

Remaining discrepancies include a misread descending phrase, accidental disagreements, timing differences and ties. Neither clean geometry nor passing software tests establishes reliable recognition of arbitrary scans. No reference was changed to match model output.

## Scan reconciliation and response recovery (2026-10-11)

The opening Black Orpheus natural was outside the first-measure crop. First-measure source images now include a two-interline leading margin; interior crops remain bounded by their barlines. The natural is visibly present in both the whole measure and enlarged panel. This exposes the symbol but does not guarantee the model reads it correctly.

`pdf-pitch-reconciliation.ts` separates complete staff-position corroboration, partial pitch reconciliation, and accidental disagreement. Identical clean timing and note/rest alignment allow individually corroborated pitch corrections to survive an otherwise uncertain review. Missing letter/octave evidence cannot certify pitches just because note counts match. Disputed accidentals retain their original spelling with explicit warnings; this avoids arbitrarily preferring the latest reader but can retain an incorrect original.

Live review also returned useful JSON inside prose, which previously discarded entire corrections. The shared `recognition-json.ts` decoder now accepts exactly one plain or fenced JSON value. It rejects alternative blocks and malformed syntax; all downstream schema, note-count, truncation and musical checks remain in force.

The evaluation replay had another fault: a recorded initial timeout caused a fresh melody call instead of replaying the failure and fallback. Replay now consumes the recorded image/model attempts in order, reproduces errors, records its source hash, and refuses missing attempts. One incomplete exploratory run was stopped after identifying that fault and is not an accuracy result.

Three full-chart experiments held initial melody attempts constant and made fresh header, harmony and focused-review calls. Before JSON-envelope recovery they matched **97, 102 and 104 of 113 complete note events**. Replaying every exact recorded request/response through the final parser recovered **103, 103 and 107 of 113** respectively; pitches matched **106, 106 and 110**, rhythms **111/113** throughout, and scored form **5/5**. Chord matches were **45, 39 and 45 of 47** expected changes (46, 40 and 46 observed). The final parser comparison made no live calls. These are development replays against an unchanged, unreviewed reference, not release approval. Variation remains substantial, and every final run still fails the complete-note accuracy target. The new deterministic regressions verify specific recovered observations, not general scan reliability.

## Bounded notation and harmony recovery (2026-10-11)

System-level harmony occasionally omitted the pickup, causing all six first-line chords to be discarded. The harmony adapter now validates each measure independently and recovers failed indexes from unannotated source crops. Replaying that specific malformed system response with fresh isolated recognition recovered all six chords in three of three trials. Empty valid measures do not trigger retries. Recovery preserves valid partial harmony on failure, honors cancellation, and is bounded to eight measures with concurrency two.

A full-measure recognition experiment with the configured tune model read all 113 rhythms correctly, but only 103/113 pitches. Replacing every system reading wholesale would therefore regress pitch accuracy and was rejected. The cheaper base-model experiment was worse: 60/113 pitches and 63/113 rhythms, with 120 observed events. The application instead selects dotted rhythms, adjacent untied repeated pitches, and complete head-count disagreements for review. A rhythmically valid but incorrect note count must use full notation review; pitch-only review would otherwise force the reader to keep the incorrect count. Two separate calls must agree on timing, rests and ties and match complete independent head evidence before a clean rhythm changes. These calls use the same model and can share systematic errors; agreement is an acceptance guard, not calibrated confidence.

The enlarged head panels now retain a narrow horizontal slice and the full vertical staff range, excluding the measured stem only for an isolated head. This removes nearby flags that confused the model about a head's center, while the complete measure above retains accidentals and rhythmic context. The troublesome flagged E was independently read correctly in three of three isolated trials. A second crop experiment excluded the measured stem from the panel edge; the opening pickup and flagged E were then both read correctly in three of three trials each. Neither panel construction nor labels disclose predicted vertical positions. Pitch alignment tolerates decimal rounding below 0.001 beats; it still rejects changed rhythm or rest alignment. Ordinary pitch/notation reviews retain disputed accidentals even when a corroborated rhythm correction changes timing; preserving them must not introduce impossible ties. Dedicated symbol review is advisory as described above.

`pdf-bar-review.ts` takes a source-reading callback and owns acceptance independently of the provider. `pdf-notation-review.ts` owns selection and agreement policy. `pdf-harmony-reading.ts` owns chord screening; the current provider owns network recovery. `pdf-accidental-review.ts` owns advisory explicit-symbol alignment, state and tie checks; the symbol adapter obtains two fresh source readings with independently counted notes. The source-image adapter, recognizer interfaces, and these policies can be replaced separately.

## Independent raster benchmark and rejected variants (2026-10-11)

`tests/fixtures/leadsheets/pdf-accuracy/lady-bird-raster.pdf` is a 150-DPI, image-only rendering of the existing Lady Bird PDF. Its provenance file records source and derived hashes. It uses the existing verified MuseScore reference with `--source Bb`; no model output was used as ground truth. This is a clean synthetic scan, not a sample of scanner noise.

A fresh optical run took 426 seconds and matched 50/53 pitches, 49/53 rhythms, 47/53 complete notes, and 15/15 chords. Key, meter and measure count were correct. This exposed false pixel heads around rests/accidentals and remaining rhythmic errors. More importantly, two dedicated symbol readings both classified a printed natural as a flat; the experimental automatic correction changed a correct F4 into Fb4. Automatic accidental correction was therefore removed. The final symbol pass only adds source-review suggestions, even when both observations agree. Original pitches cannot be rewritten by that adapter. These data do not establish usable accuracy for arbitrary scanned charts.

Universal stem exclusion also regressed full-chart pitch review and was rejected after a complete run; an additional partial run was stopped and is not accuracy evidence. The retained crop only excludes the stem for an isolated head and keeps centered narrow columns for multi-note measures. A lower-reasoning initial-reader experiment took 332 seconds but matched only 93/113 complete Black Orpheus note events; it was rejected. Timings came from overlapping development evaluations and are not a controlled latency benchmark. The configured initial model and reasoning setting are unchanged.

A separate fresh Black Orpheus run exposed a valid four-beat transcription containing four notes where the source has three. Previously, pitch-only review was forced to retain that wrong count. Complete pixel count disagreements now trigger full notation review, and two agreeing, corroborated readings can repair the count and rests. Three isolated live trials recovered the same correct three-note measure. The acceptance policy still declines incomplete or contradictory pixel evidence rather than deleting arbitrary events to force a match.

## Final local verification for this follow-up (2026-10-11)

The retained implementation passed 5,985 unit tests (40 pre-existing expected failures), 36 PDF-import browser tests across Chromium/Firefox/WebKit, and type checking with zero errors or warnings. The nine exported charts still pass their gate: 710/710 complete melody events, 246/247 chords, and exact scored key/meter/measure/form results. These checks do not certify optical recognition.

Three development trials reused the earlier initial Black Orpheus melody attempts and made fresh context, harmony and review calls. Replaying all 88 exact recorded requests from each trial through the final conservative policy produced:

| Trial | Pitches | Rhythms | Complete notes | Chords | Scored form |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 110/113 | 111/113 | 109/113 | 45/47 | 5/5 |
| 2 | 112/113 | 113/113 | 112/113 | 45/47 | 5/5 |
| 3 | 112/113 | 113/113 | 112/113 | 45/47 | 5/5 |

All three have 113 observed notes and 46 observed chords. The exact final replays made no live calls. The provisional reference remains unchanged and unreviewed. A different, fresh initial transcription demonstrates remaining variability: a subsequent final-policy review trial matched only 103/113 complete notes, although the erroneous extra note was removed. That failure is retained in the evidence rather than excluded from the reported result.

The final raster Lady Bird trial reused its recorded initial melody and made fresh review calls. It matched 51/53 pitches, 49/53 rhythms, 48/53 complete notes and all 15 chords. It still fails the complete-note and rhythm gates. Its independently sourced reference and raster fixture are retained for future provider/detector work. More heuristic or model-consensus changes are not justified as automatic corrections by these results; the remaining errors need better independently validated symbol/head evidence and recognition. Local changes and development replays are neither release approval nor deployment.

## Future providers

Implement `SystemRecognizer` at the composition boundary used by `/api/tune-parse`. Keep pitches as printed, preserve omissions as unknown, return bounded structured results, and retain raw provider output in evaluations. Reuse acceptance and accuracy policies. New OMR engines may expose better source alignment and calibrated confidence; add those as explicit evidence rather than silently trusting list position. Provider changes require fresh live evaluations, not merely green schema tests.

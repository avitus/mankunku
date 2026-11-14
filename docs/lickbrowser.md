# Native lick browser

`/lickbrowser` searches Weimar solo excerpts using the shared practice progression dropdown and chord families (extensions and slash bass do not constrain matching). It loads the corpus only when visited. Artist filtering, automatic all-key matching, native instrument notation, slower playback and paginated scores are available.

The last chord's span is clipped at the first source barline after that chord starts, even when the same chord continues for several bars. A new melodic attack must occur before that barline. The first chord needs an entrance, all three chords of a three-chord cadence need activity, and more than half the excerpt's beat cells must contain activity. A held note crossing into I does not count as a new resolution. Resolution here means arrival during I, not a pitch-class test for a tonic chord tone.

`excerptPhrases` builds a native Phrase and calls the existing `fitLickToRange` with the selected instrument and effective highest note. Its one octave displacement is applied to both written notes and measured playback. `NotationDisplay`, `leadSheetTuneFor`, and `createLickAudition` own engraving and sound; there is no separate sax bank, ABC generator, or range algorithm. Template chords use the catalog’s concert C reference; the staff is written for the selected instrument.

## Shared rhythm fitting

Both record-a-lick and Weimar now call `music/phrase-rhythm.ts`. It jointly selects an attack sequence, swing feel, clock phase and conventional releases over the whole phrase. The former browser swing-pair and displaced-run fitters have been removed; there are no excerpt-ID exceptions.

`audio/recorder-rhythm.ts` is a seconds-to-beats adapter. It retains the recorder's six-tick grid, eight-bar limit, phase search, optional acoustic boundaries, entrance override and ending-join policy. Its public result remains unchanged.

The Weimar adapter interpolates performed attacks and releases through the source beat timestamps (`music/beat-map.ts`) before fitting. Thus tempo changes follow the annotated clock instead of an average-tempo grid. It uses twelve ticks per beat to admit real sixteenths, dotted figures and triplets, the actual excerpt length and a fixed phase. Source eighth-grid anchors stay in place; ambiguous attacks can move at most a sixteenth. `music/annotated-rhythm.ts` supplies evidence for complete triplets, sixteenth runs, repeated dotted motifs, isolated figures and sustains. It does not assign replacement rhythms: the shared fitter chooses the remaining attacks and releases together. Source evidence also discourages inventing gaps or short subdivisions without timing support.

WJD 1-63 retains eleven eighths; WJD 1-96 retains twelve, with its beat-2 entrance and internal eighth rest. Short on-beat quarters still read as quarters when the surrounding phrase supports them. This remains inferred notation rather than an authoritative edition: timing alone cannot distinguish every deliberate dotted figure from heavy swing.

Playback continues to use the original measured seconds in `Excerpt.notes`, at the source tempo scaled by the speed selector. The fitting inputs are separate notation data; neither the source array nor the performance Phrase is rewritten.

## Data

Rebuild with `python3 scripts/build-lickbrowser-corpus.py /path/to/wjazzd.db`. Download the source from https://jazzomat.hfm-weimar.de/download/downloads/wjazzd.db. The raw SQLite database remains outside Git. This derivative retains original seconds, source bar/beat coordinates, source subdivisions and unrounded release lengths in beat ticks.

The source release 2.1's `db_info` declares ODbL 1.0 for the database and DbCL 1.0 for individual contents. Credit: Jazzomat Research Project; Pfleiderer et al., *Inside the Jazzomat* (2017). This browser's data is distinct from the historical attribution index documented in `wjazzd-attribution.md`.

## Verification

`tests/unit/lickbrowser/browser.test.ts` pins the second-I-bar regression, validates an I-bar attack in every returned native major-cadence score, and checks shared range fitting and identical sounding/written pitches across saxophones. `tests/e2e/lickbrowser.spec.ts` exercises the app route, native SVG scores and progression selection. Run tests through the repository's Linux sandbox.

`tests/unit/lickbrowser/rhythm.test.ts` pins both examples and unchanged playback, mixed swing, genuine dotted figures, triplets, sixteenths, breaths and sustains. It also checks every supported progression against the corpus for feasible, positive, non-overlapping notation. `tests/unit/music/phrase-rhythm.test.ts` checks tempo-changing beat maps, partial final beats, long phrases and mixed source subdivisions.

`tests/unit/audio/recorder-rhythm-extraction.test.ts` compares 64 recorder outputs captured before extraction (four tempos, four swing feels, current/previous/placed/optional-boundary paths) with the shared engine. The fixture includes every note, rest, phase, collision count and omitted index. Existing recorder rhythm, boundary, refinement and real-WAV baseline tests must continue to pass. Run these through the Linux sandbox. Type checking uses a 3 GiB Node heap inside the existing 4 GiB container limit.

Extraction validation: 57 tests across eight suites passed, including the archived recorder audio baseline and every supported progression over the Weimar corpus. All four Chromium browser scenarios passed, including the two engraved example scores. Type checking reported no errors or warnings. The corpus sweep also caught coincident source attacks that could emit a zero-length note; the fitter now reports those as collisions instead. The recorder comparison fixture was captured from commit `543c9ddc` before extraction and matches exactly.

The dropdown reads every entry of `PROGRESSION_TEMPLATES`, including vamps and the Blues I7 vamp. Short and long variants match the template’s chord-change spacing, not just the same chord names.

## Stealing excerpts

Steal saves the displayed written Phrase through `saveUserLick`, with a new personal ID, source attribution and a stable `wjazzd:<excerpt>:<end-tick>` tag. The existing outbox handles authenticated sync; anonymous users can save locally. A second steal returns the existing personal copy without overwriting edits. Success is shown only after reading back the saved copy. Shared `seedStolenLickPracticeDefaults` seeds practice membership and a fitting progression. These are editable personal copies, not community adoption rows.

Steal validation: the three helper tests cover copying, preserving edits on duplicate attempts, and failed local writes. The browser scenario confirms the Stolen state survives reload and the copy appears in `/licks` (Chromium, Linux sandbox).

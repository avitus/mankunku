# Native lick browser

`/lickbrowser` searches Weimar solo excerpts using the shared practice progression dropdown and chord families (extensions and slash bass do not constrain matching). It loads the corpus only when visited. Artist filtering, automatic all-key matching, native instrument notation, slower playback and paginated scores are available.

The last chord's span is clipped at the first source barline after that chord starts, even when the same chord continues for several bars. A new melodic attack must occur before that barline. The first chord needs an entrance, all three chords of a three-chord cadence need activity, and more than half the excerpt's beat cells must contain activity. A held note crossing into I does not count as a new resolution. Resolution here means arrival during I, not a pitch-class test for a tonic chord tone.

`excerptPhrases` builds a native Phrase and calls the existing `fitLickToRange` with the selected instrument and effective highest note. Its one octave displacement is applied to both written notes and measured playback. `NotationDisplay`, `leadSheetTuneFor`, and `createLickAudition` own engraving and sound; there is no separate sax bank, ABC generator, or range algorithm. Template chords use the catalog’s concert C reference; the staff is written for the selected instrument.

Written rhythm shares the recorder's triplet-attack evidence and articulation-gap threshold through `music/rhythm-evidence.ts`. Brief gaps join to the next attack and a short on-beat quarter can occupy its written beat. The browser keeps Weimar's annotated clock rather than fitting the recorder's fixed eight-bar clock to a solo with variable tempo and meter.

Continuous eighth-note runs resolve mixed swing subdivisions: 2:1 pairs write as ordinary eighths with another neighbouring eighth pair, and an isolated 3:1 pair needs at least two ordinary/2:1 pairs in the same run. Both written lengths change together, including a terminal pair. Full eighth- and quarter-note triplets, rested triplet entrances, isolated dotted figures, repeated dotted motifs, longer sustains and breaths remain. All gap evidence uses the original source positions. WJD 1-63 (Art Pepper, Anthropology) is the real-data regression: all eleven notes write as eighths. This is conservative heuristic transcription, not an authoritative edition; timing alone cannot distinguish every deliberate dotted figure from heavy swing. Playback retains the original measured offsets and durations at source tempo, scaled by the speed selector.

## Data

Rebuild with `python3 scripts/build-lickbrowser-corpus.py /path/to/wjazzd.db`. Download the source from https://jazzomat.hfm-weimar.de/download/downloads/wjazzd.db. The raw SQLite database remains outside Git. This derivative retains original seconds, source bar/beat coordinates, source subdivisions and unrounded release lengths in beat ticks.

The source release 2.1's `db_info` declares ODbL 1.0 for the database and DbCL 1.0 for individual contents. Credit: Jazzomat Research Project; Pfleiderer et al., *Inside the Jazzomat* (2017). This browser's data is distinct from the historical attribution index documented in `wjazzd-attribution.md`.

## Verification

`tests/unit/lickbrowser/browser.test.ts` pins the second-I-bar regression, validates an I-bar attack in every returned native major-cadence score, and checks shared range fitting and identical sounding/written pitches across saxophones. `tests/e2e/lickbrowser.spec.ts` exercises the app route, native SVG scores and progression selection. Run tests through the repository's Linux sandbox.

`tests/unit/lickbrowser/rhythm.test.ts` pins WJD 1-63's written eighths and unchanged measured playback, mixed swing, dotted motifs, triplets, breaths and sustains. Run it alongside `tests/unit/audio/recorder-rhythm.test.ts` and `tests/unit/audio/recorder-boundaries.test.ts` when changing the shared rhythm evidence. The WJD regression and mixed-swing/triplet-transition cases fail against the previous converter.

Swing-fix validation: 38 focused browser/recorder tests and all three Chromium browser scenarios passed in Linux. The WJD 1-63 browser scenario checks eleven engraved eighths and captures the score. Svelte checks passed with no errors or warnings; the sandbox check needed a 3 GiB Node heap inside its existing 4 GiB container limit.

Delivery checks: 41 browser-model/range tests and 9 audition lifecycle/tempo tests passed in the Linux sandbox; the Chromium route/engraving/input test passed against the production build. Svelte checks reported no errors or warnings. The regression corpus includes all returned major cadences, including partial opening bars and terminal tonic bars without a following recorded barline.

The dropdown reads every entry of `PROGRESSION_TEMPLATES`, including vamps and the Blues I7 vamp. Short and long variants match the template’s chord-change spacing, not just the same chord names.

## Stealing excerpts

Steal saves the displayed written Phrase through `saveUserLick`, with a new personal ID, source attribution and a stable `wjazzd:<excerpt>:<end-tick>` tag. The existing outbox handles authenticated sync; anonymous users can save locally. A second steal returns the existing personal copy without overwriting edits. Success is shown only after reading back the saved copy. Shared `seedStolenLickPracticeDefaults` seeds practice membership and a fitting progression. These are editable personal copies, not community adoption rows.

Steal validation: the three helper tests cover copying, preserving edits on duplicate attempts, and failed local writes. The browser scenario confirms the Stolen state survives reload and the copy appears in `/licks` (Chromium, Linux sandbox).

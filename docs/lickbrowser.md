# Native lick browser

`/lickbrowser` searches Weimar solo excerpts by concert chord symbols and chord families (extensions and slash bass do not constrain matching). It loads the corpus only when visited. Artist filtering, all-key matching, native instrument notation, slower playback and paginated scores are available.

The last chord's span is clipped at the first source barline after that chord starts, even when the same chord continues for several bars. A new melodic attack must occur before that barline. The first chord needs an entrance, all three chords of a three-chord cadence need activity, and more than half the excerpt's beat cells must contain activity. A held note crossing into I does not count as a new resolution. Resolution here means arrival during I, not a pitch-class test for a tonic chord tone.

`excerptPhrases` builds a native Phrase and calls the existing `fitLickToRange` with the selected instrument and effective highest note. Its one octave displacement is applied to both written notes and measured playback. `NotationDisplay`, `leadSheetTuneFor`, and `createLickAudition` own engraving and sound; there is no separate sax bank, ABC generator, or range algorithm. Entered chords are concert pitch; the staff is written for the selected instrument.

Written rhythm retains the prototype's recorder-informed articulation policy: brief gaps join to the next attack, a short on-beat quarter can occupy its written beat, repeated swing pairs write straight, and genuine triplets and longer breaths remain. This is heuristic transcription, not an authoritative edition. Playback retains measured timings at source tempo, scaled by the speed selector.

## Data

Rebuild with `python3 scripts/build-lickbrowser-corpus.py /path/to/wjazzd.db`. Download the source from https://jazzomat.hfm-weimar.de/download/downloads/wjazzd.db. The raw SQLite database remains outside Git. This derivative retains original seconds, source bar/beat coordinates, source subdivisions and unrounded release lengths in beat ticks.

The source release 2.1's `db_info` declares ODbL 1.0 for the database and DbCL 1.0 for individual contents. Credit: Jazzomat Research Project; Pfleiderer et al., *Inside the Jazzomat* (2017). This browser's data is distinct from the historical attribution index documented in `wjazzd-attribution.md`.

## Verification

`tests/unit/lickbrowser/browser.test.ts` pins the second-I-bar regression, validates an I-bar attack in every returned native major-cadence score, and checks shared range fitting and identical sounding/written pitches across saxophones. `tests/e2e/lickbrowser.spec.ts` exercises the app route, native SVG scores and invalid chord input. Run tests through the repository's Linux sandbox.

Delivery checks: 41 browser-model/range tests and 9 audition lifecycle/tempo tests passed in the Linux sandbox; the Chromium route/engraving/input test passed against the production build. Svelte checks reported no errors or warnings. The regression corpus includes all returned major cadences, including partial opening bars and terminal tonic bars without a following recorded barline.

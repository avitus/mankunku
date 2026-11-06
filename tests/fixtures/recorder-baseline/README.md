# Lick recorder evaluation set

[Results and per-note comparisons](baseline.md) · [Reference notes and tempos](takes.json)

The source is two snapshots of the owner's Firefox audio store for mankunkujazz.com. The October 7 export contains 285 scored lick-practice windows. The Firefox copy supplied on November 5 holds 300 recordings for that account (240 lick-practice windows and 60 ear-training takes). Together the snapshots provide 525 distinct scored lick-practice takes across 14 licks. Six winners come from November and eight from October. Each manifest entry includes the source session ID, recording timestamp, and number of candidates for that lick.

For each underlying lick ID (after removing the practice-key suffix), select the highest full-precision saved overall practice score across keys. Break ties by the most recent recording timestamp, then filename. Deduplicate repeated session IDs across snapshots, preferring the first archive supplied. Report keys in tenor saxophone written pitch. November's stored metadata has no instrument field, so the Firefox import uses the same tenor configuration as the October benchmark.

The reference is the exercise as presented in that key. Each expected sounding note, including missed notes, comes from the non-extra rows of the saved score. This supplies the written pitch, onset and duration independently of the recorder output. A player can choose another octave, miss a note, sustain it longer, or enter late. Listening and annotating what was actually played is necessary before attributing a particular disagreement to the recorder.

To refresh, decode the copied Firefox store with `uv run python -m harness.firefox_import <idb-directory> --account <account-uuid> --out <new-export>` from `research/audio-scoring`. Then run `python3 scripts/recorder-review/select-takes.py <new-export> <account-uuid> --additional-archive <older-export>` from the repository root.

## Estimated editing effort

The primary figure is **logical corrections per 10 reference notes**, pooled across the fixed takes. Lower is better. We also report absolute corrections per lick, the median across licks, and how many need zero edits. Compare the saved C-normalized draft with the exercise normalized to C from its practice key. Preserve absolute octave. Merge tied sounding notes, represent leading and internal silence as rests, and ignore trailing pad rests.

A minimum-cost sequence alignment charges one unit to insert or remove a note/rest, change its pitch (including note ↔ rest), or change its duration. Changing both pitch and duration costs two. Editing a duration shifts subsequent offsets in the model, so a single leading rest or misplaced boundary cannot create a separate error on every later note. A uniform transposition of the whole draft costs one if it reduces total effort. This credits a common key or octave correction once. On equal cost, prefer keeping the original register, then matching existing events. The per-lick breakdown shows one minimum-cost solution.

Units count musical decisions. Actual gestures and seconds depend on selection, duration controls, instrument range, and how resizing overwrites or leaves rests in the editor. Partial-range shifts and copy/paste shortcuts are outside this first model. Count a draft over four bars in the benchmark but flag that the recorder cannot open it for editing. Exercise disagreement includes performance choices. To calibrate these weights against human effort, compare estimates with timed corrections on the same takes.

## Replay

The integration test decodes the archived mono PCM, runs the shared pitch and onset detectors with the recorder’s window-end timestamps, then calls the same transcription implementation as the record page. This includes segmentation, quantization, key inference, and normalization to C. It uses the recorded tempo and assumes the start of each practice window is the recorder entrance. No notes, inferred key, or timing corrections from the reference are passed to the recorder. The files contain the practice mix. The original recorder count-in, mic-only signal, browser scheduling, and silence auto-stop are outside this replay.

Pitch recall counts the longest in-order, one-to-one sequence of concert pitches shared with the exercise, divided by the number of reference notes. Precision divides the same count by emitted notes. Pitch class permits octave differences. MIDI requires the same octave. The onset and duration counts compare exact notation grid positions without requiring a pitch match. Relative rhythm removes the offset between the first reference and emitted attacks. Exact saved notes require the reference pitch shifted to C using the practice key, in its original register, at the exact notated onset and duration. All percentages pool note counts across takes.

## Rhythm comparison

The fixed comparison runs the previous phrase-level decoder, a clock-adjusted beat-local quantizer, and the current recorder on the same audio. The current decoder uses pitched windows to refine attack times and releases, recovers sustained low-clarity notes, and can join a weak candidate to the preceding note. The estimated edit total includes the consequences of these decisions. The report separately counts omitted acoustic candidates and collisions on a single grid slot. No exercise notes or practice key enter the automatic decoder.

Dexter Gordon, Wouldn’t It Be Loverly, Cry Me a River, and Fats Navarro were reserved by lick ID for the first rhythm experiment. Those examples have since been inspected and now serve as regressions for the next decoder. The integration test checks for at most 2.3 edits per ten reference notes, half as many resizes as the previous recorder, and all three opening triplet positions on both Dexter and Loverly. Synthetic swung eighths and true triplets are also recorded through the real microphone graph and checked after saving in the Linux Chromium and WebKit sandboxes.

The live route captures microphone samples on the audio clock and runs a worker after the player stops. The live pitch readings remain available as a fallback. PCM also lets the recorder distinguish a sample splice during a held tone from a new articulation. Both use the same transcription tail as the replay above. Review shows the instrument’s written register and offers the original recording alongside notation playback. The musician may specify a written key or the first note’s beat. User-supplied information is excluded from the automatic benchmark.

For the wider check, run `node scripts/recorder-review/evaluate-archives.mjs <account-uuid> <new-export> <older-export>`. It compares the two recorder versions on the primary takes, the remaining highest-scoring takes per lick and key, and the other performances. The last group includes player errors; compare the versions on the same performances. The exercise target measures the work to produce the intended lick, even when a different note was actually played.

### November 5 rhythm and segmentation comparison

| Selection | Takes | Reference notes | Previous edits | Current edits | Improved / tied / regressed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Highest-scoring take for each lick | 14 | 150 | 59 | 24 | 9 / 5 / 0 |
| Highest-scoring takes in other keys | 129 | 1,241 | 716 | 477 | 81 / 42 / 6 |
| All remaining performances | 382 | 4,639 | 2,759 | 1,971 | 226 / 132 / 24 |
| **Total** | **525** | **6,030** | **3,534** | **2,472** | **316 / 179 / 30** |

On the 274 remaining performances with a practice score of at least 90%, the estimated edits fell from 1,559 to 976. All 525 takes come from the same player and 14 lick identities. The decoder settings were fixed before scoring those 382 remaining performances. A human transcription of the performances would let future evaluations distinguish player differences from recorder errors.

### Tonic, octave and ending review

The next recorder scores the twelve possible tonics from the pitch classes and last note, including evidence for a harmonic-minor cadence. It checks isolated high notes in a limited register against the PCM. A lower fundamental alone is insufficient. Multiple pitched windows must also contain the lower note’s third and fifth harmonics above the surrounding noise. The earlier acoustic recorder and the key-only version supply separate edit totals.

| Selection | Takes | Previous edits | Key only | Key and octave | Improved / tied / regressed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Highest-scoring take for each lick | 14 | 24 | 20 | 16 | 6 / 8 / 0 |
| Highest-scoring takes in other keys | 129 | 477 | 443 | 430 | 44 / 84 / 1 |
| All remaining performances | 382 | 1,971 | 1,892 | 1,838 | 125 / 246 / 11 |
| **Total** | **525** | **2,472** | **2,355** | **2,284** | **175 / 338 / 12** |

Key matches rose from 106 to 240. Drafts needing zero edits rose from 19 to 43. Relative to the key-only version, octave evidence reduced edits on 60 takes and increased edits on zero. For an independent key check, run `node scripts/recorder-review/evaluate-archives.mjs --fresh-keys <account-uuid> <november-export>`. On 60 ear-training recordings of 35 other licks, excluding benchmark IDs and transposed copies of the benchmark melodies, key matches rose from 12 to 21. Archive-independent catalogue checks used symbolic pitches and all twelve transpositions. On 543 distinct melodies without an explicit mode the match count rose from 1,763 to 2,957 out of 6,516. On 25 explicit minor melodies it rose from 79 to 84 out of 300. The catalogue was used to refine the minor rule.

Five of the six remaining benchmark resizes involve the ending. For example, in Blue Monk the final pitch has about 1.0 second of readings above 16% of its peak amplitude, against 2.88 seconds written. The recorder leaves the measured ending as its default. Review lets the musician choose a different last-note length, audition it, and save it. Manual changes are excluded from every automatic total. The comparison page’s **Play ending** button seeks the original recording to just before the exercise’s final note.

### Sustained endings and passing notes

The recorder can recover a passing note from a brief run of confident and weak pitch windows, and can join a final repeated pitch when harmonic phase and amplitude support a single sustain. Joining the ending happens after clock fitting so an apparent last attack cannot move the rest of the line. When the segmenter observed a tongue stop and recovery in the instrument band, the recorder preserves that repeat even if the waveform is already steady at the reported onset.

| Selection | Takes | Previous edits | Current edits | Improved / tied / regressed |
| --- | ---: | ---: | ---: | ---: |
| Best take per lick | 14 | 16 | 12 | 3 / 11 / 0 |
| Best takes in other keys | 129 | 430 | 420 | 8 / 121 / 0 |
| All remaining performances | 382 | 1,838 | 1,818 | 16 / 366 / 0 |
| **Total** | **525** | **2,284** | **2,250** | **27 / 498 / 0** |

Ready-as-recorded drafts rose from 43 to 45. *Indiana* now matches all 22 reference notes. *Sharp 9 Flat 9 Dom* recovers the written G4 with its eighth-note duration. *Basis of Everything* has one final written A4, with its remaining disagreement in duration. A separate check of 11 recorded fixtures with repeated endings in the exercise retained all eight previously detected final pairs and recovered the soft repeat on the September 18 *Blues Curl Up* take. These comparisons use exercise notation as the target.

## Reproduce

From the repository root with dependencies installed:

```sh
circleci testsuite run 'unit tests' --local --run-tests=all -t 'recorder-baseline\.test\.ts$'
```

The test compares the full report, including every emitted note, to a Vitest file snapshot. After an intentional change, inspect the differences, listen to the affected WAVs, and update the snapshot when the new results are accepted. Add independently reviewed performance transcriptions alongside the exercise targets if labeling recorder errors by ear.

## Listen and compare

Run `node scripts/recorder-review/build.mjs /tmp/recorder-review.html` from the repository root, then open the HTML file in a browser. It embeds the original recordings and the previous, new, and reference scores, works offline, and displays written pitches and keys for the instrument in each take. “As played” shows the performed register; “As saved” shows the normalized draft and exercise in the instrument’s written key (D for tenor saxophone).

“Listen to note decisions” plays short excerpts around recovered passing notes and candidates the automatic decoder joined to the preceding note. Use these to check the acoustic decision independently of the exercise.

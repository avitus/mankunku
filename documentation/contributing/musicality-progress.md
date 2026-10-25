# Musicality development progress

This is the chronological engineering and listening handoff for the `musicality` branch. The [implementation ledger](/musicality) remains the requirement-by-requirement record; the [architecture roadmap](/docs/architecture/musicality) explains the design. Passing tests establishes behavior, not musical excellence or human listening acceptance.

## Overnight working agreement — 24–25 October 2026

Continue coherent musicality milestones overnight, document progress and retain clear checkpoints. Keep all work on `musicality`; leave `dev` and production available for their existing purposes. Use local and sidecar validation, `[skip ci]` commits, non-force pushes and exact remote SHA verification. Do not run hosted CircleCI or release experimental accompaniment during this work.

Preserve the musical character of Swing, Straight, Bossa Nova and Ballad. Original mode remains the compatibility baseline. Keep causal observations, immutable committed events, deterministic replay, checkpoint identity, protected pulse and explicit form semantics. Do not weaken existing tests to hide regressions. Fix a blocker or document it and continue independent useful work. Human listening remains pending until a person records judgments over complete tunes.

Overnight continuation is scheduled in the existing chat every 15 minutes through 08:00 America/Los_Angeles on 25 October 2026. Local execution requires the computer and app to remain running. Each milestone below records what changed, validation, limitations, listening guidance and a commit checkpoint. No raw microphone audio or private reasoning belongs in this log.

## Starting checkpoint — `98a59f26`

Structural performance energy is implemented for explicit coordinated 4/4 forms. Heads are restrained, solo choruses build and release, returning heads ease back, and the final closing phrase releases energy. The same policy drives fixed and rolling generation, with a compact audio-clock **Planned arc** cue on `/musicality`.

Validation: 6,457 tests passed locally and on the sidecar, with 40 existing expected failures; 45 browser checks passed across Chromium, Firefox and WebKit; typecheck/build passed. Five discovered regressions were fixed without weakening their assertions: earlier loop prefixes remain stable when future loops are added, and nonterminal releases retain eligible bass launches and drum setups. Final release follows the actual final section's closing phrase, including irregular lengths. Commit `98a59f26946eb34318e4dcf6d0940b5ada86c142` was verified on `origin/musicality`.

Remaining: deliberate texture transitions, reciprocal dialogue beyond recent-piano drum answers, richer voicing objectives, acoustic validation and recorded human acceptance. Production integration remains separate because the current release base has newer playback/form fixes.

## 25 October — deliberate structural textures

Intent: make the arrangement's texture audible through sustained player choices, rather than relying only on energy weights.

- Bass: explicit head/solo-aware two-feel and walking choices, including return to the melody, shared by fixed and rolling generation. Preserve eligible transitions and already committed launches.
- Drums: selected sustained ride-bell color at appropriate solo peaks, latched to a phrase, with a return to ordinary ride and protected quarter-note pulse. Preserve native Bossa and Ballad grooves.
- Piano: inspect deliberate voicing expansion and line objectives before selecting the next implementation; do not claim work completed from an audit alone.

Implemented in explicit Coordinated Swing/Straight forms. Heads and returning heads use two-feel; solo choruses walk. A seeded structural choice can walk the last two bars into a declared solo, and quiet final phrases can return to two. Bass durations stop at intervening harmonic changes; already committed launches and short solo arrivals remain intact. Selected complete solo-peak phrases sustain bell color with a cooldown, then return to ride. Original and native Bossa/Ballad paths remain unchanged. The live musician view exposes planned feel and cymbal color alongside actual emitted attacks, including honest silence states.

Behavioral tests first reproduced the missing returning-head two-feel, missing sustained bell time, misleading presenter action and overlapping bass release at an odd-beat harmonic change. The fixes passed those tests without changing existing assertions. An independent full-tune Saints test verifies actual bell time, fixed/rolling decisions, JSON restoration within a bell phrase and the final return to two-feel. Review found the harmonic-release defect; it is fixed and covered. Typechecking also caught a readonly test-helper annotation, which was corrected.

Local and sidecar unit validation: **6,477 passed, 40 expected failures**, across 414 files. Focused instrument partitions passed 95 bass and 71 drum/ensemble/rolling/style cases; presenter tests passed 15 cases; the independent real-tune matrix passed both styles. Ledger/docs checks passed 56 cases. Typechecking passed with zero errors/warnings; production build passed. All **45 browser checks passed** across Chromium, Firefox and WebKit, including complete-tune playback, matched blind reviews, native styles, cancellation and the new progress-log navigation. Hosted CircleCI was not run. This entry ships in the structural-texture checkpoint; the next entry records its verified commit SHA.

Audition: on `/musicality`, use **When the Saints Go Marching In**, Coordinated Swing or Straight, with four solo choruses. Listen to the head's half-note pulse, walking entry into the solo, selected later solo-peak bell phrase, then two-feel under the returning melody. Bell selection is seeded and deliberately occasional. A 12-bar Blues peak can be too short or misaligned for the existing phrase, so it retains ordinary ride. Compare complete takes at matched settings; record observations in the listening marks or blind review. Human acceptance remains pending.

Next: shared causal piano voicing placement based on the last chord actually emitted. Preserve existing family choices and native style biases; address legal defining tones, common-tone retention and guide-tone continuity with actual musical examples. Structural piano texture expansion follows as a separate increment. Production rollout, richer reciprocal dialogue, bass sample-layer correction/balance and acoustic validation remain separate work.

## 25 October — causal piano voice-leading

Structural textures were committed and verified on `origin/musicality` as `c79f4d262e3a43cf7d9dd70baaa6045b0c02e4ff`. That milestone took approximately ten minutes of overlapping work: reading/planning about two minutes, implementation five, and review/documentation three. Measured local unit tests took 23.54 seconds, sidecar unit tests 68.11 seconds (81 seconds including sync), and the slowest check was the browser matrix at 3.5 minutes. These estimates overlap and must not be added as serial elapsed time.

The next increment is deliberately limited to explicit-form Coordinated piano placement. Fixed playback currently voice-leads through harmony even when the piano rests; rolling playback follows emitted voicings. A shared causal resolver will make the previous **sounding** chord the reference, preserve existing family choices and native style biases, and test guide-tone motion/common-tone retention using concrete ii–V–I examples. Original and metadata-free compatibility paths remain unchanged. New structural piano texture thresholds are deferred to a separate milestone.

Implemented: a bounded resolver chooses legal inversions from the selected family using the last actual chord, with defining-tone motion, exact common tones, total movement and register objectives. The Dm7 F3/C4 → G7 F3/B3 → Cmaj7 E3/B3 example works in all twelve keys. Coordinated guide/shell shapes identify the major third of a sharp-nine dominant correctly; altered drop-2 shapes retain the seventh and named color tone. Quartal shapes retain fourth stacks and do not claim a guide-tone objective. The current attack bar supplies energy even when the chord anticipates upcoming harmony. Only emitted attacks advance memory or create evidence; checkpoints validate that memory and bind the new policy.

Behavioral reds reproduced the missing ii–V–I connection, sharp-nine guide-tone error, influence from unheard intermediate harmony, memory updates after rejected hits and future-energy leakage into an anticipation. These are fixed without weakening existing assertions. The musician view now shows matched actual voicing families, common tones and guide-motion evidence; absent attacks, mismatched notes and Original mode cannot acquire invented explanations.

Validation: **6,500 tests passed locally and on the sidecar**, with 40 expected failures across 417 files. Focused resolver/legacy voicing checks passed 54 cases; causal integration/ensemble/rolling/style/goldens passed 65; independent musical/native-style integration passed five; presenter tests passed 17. Typechecking passed with zero errors/warnings and the build passed. All **45 browser checks passed** across Chromium, Firefox and WebKit, including full-tune exported voicing evidence, blind reviews and lifecycle behavior. No hosted CircleCI ran. This entry ships in the causal-piano checkpoint; the following entry records its verified commit SHA.

Independent Saints evidence at identical rhythmic inputs: attack counts, times, durations, velocities and motif traces stayed identical in all four styles. Largest chord-center leaps decreased from 7.25 to 4.67 semitones in Swing, 11.5 to 5.75 in Straight, 10.25 to 6.92 in Bossa and 12 to 4.75 in Ballad. This is one scenario, not an acceptance threshold. A separate local generation benchmark across both tunes/all styles measured 4.95–22.02 ms for a complete fixed take; rolling bar p95 was 0.59–0.84 ms and the maximum 2.13 ms. Realized candidate counts were 2–36. These are single-run measurements, not a latency guarantee.

Audition: compare complete Coordinated takes with the previous checkpoint, focusing on the piano’s connections after rests, ii–V–I changes and altered dominants. Native Bossa and Ballad rhythms should remain recognizable. Repeated harmony intentionally favors stable common tones over following a rising register target; structural voicing expansion and a composed top-note line remain future work. Human listening acceptance is pending.

Next investigation: repair source-defined Smolken bass velocity/round-robin selection, which currently layers 7–12 recordings for one note. Keep the repair bank-specific, preserve current gain initially, verify actual native source counts, and retain same-gain before/after full-tune audio measurements before judging balance.

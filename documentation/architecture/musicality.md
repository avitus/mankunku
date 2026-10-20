# Rhythm section musicality

The `musicality` branch develops the accompaniment as an ensemble. The target is the [original specification](/musicality#original-spec); the [implementation ledger](/musicality) records individual requirements, evidence and remaining work. A legal note sequence or passing test does not establish that a performance sounds musical.

## Current foundation

The current foundation provides:

1. A living specification with all 50 sections and 202 named devices, separate implementation and listening status, source/test evidence, search, filters and permanent requirement links.
2. An explicit performed form. The owner of a playback session supplies head/solo passes, section occurrences and chorus boundaries. An internal repeated A section is no longer mistaken for another chorus when this metadata is present.
3. A pure ensemble planner before instrument generation. It assigns phrase intention, piano attack limits, drum commentary limits, bass ornament restraint, response ownership, intentional silence and selective setup/arrival pairs. The existing players realize those instructions with their established vocabulary.
4. Restorable planner memory and correlated phrase timing. Planning can resume at a contiguous bar boundary from a versioned JSON checkpoint; the three players share bounded phrase motion with their own placement and smaller event residuals.
5. Scoped bass and piano development. Selected piano phrases reuse and transform an existing rhythm; eligible two-bar bass passages aim at the root of a known following chorus. Event exports include the device decisions and reasons for withholding them.
6. Drummer phrasing within the current kit. Two-to-four-bar ride cells and selected commentary motifs develop through repetition, displacement and orchestration. A previous bar of emitted piano attacks can supply a drum answer; the accepted kit strokes are included in the trace.
7. Live observation and recorded-feature replay in the lab. A finite microphone take produces qualified density/rest evidence and an inspectable trace; a coordinated replay generated after the take can use that evidence.

Coordinated generation currently applies to **swing in 4/4**, selected in the [listening lab](/diagnostics/backing-mixer). Ordinary practice keeps the original orchestration mode until the comparison has received listening acceptance. Both modes consume corrected explicit form metadata where available. The lab supports original/coordinated comparison, variation seeds, WAV bounce and event/decision export.

The lab supports scripted observations, fixed microphone capture/replay, and a finite **rolling adaptive take**. In rolling mode, qualified completed microphone evidence changes upcoming uncommitted bars while the instruments retain phrase state. Scheduled attacks and releases remain fixed. The adaptive loop option continues this state across a selected number of repeats on one absolute timeline. Ordinary loops still repeat a precomputed timeline; indefinite adaptation and the complete vocabulary specification remain unfinished.

## What the existing architecture provides

`backing-generation.ts` separates deterministic musical decisions from Tone/smplr rendering. Each instrument has its own seeded random streams. The piano has named one/two-bar figures and voice-leading, the bass has targets, approaches and contour, and drums have timekeeping, commentary and fills. Existing reports, golden fixtures and the lab make changes reproducible.

Those are useful foundations. The missing architectural responsibility was deciding what the band is doing together. Previously piano generated first, bass independently, then drums could react to their onset maps. That one-way coupling could not reserve a response for one player, ask piano to leave space for a drum setup, or distinguish missing solo information from a soloist resting.

The foundation preserves instrument-specific musical knowledge and inserts an explicit planning contract. It does not replace those generators with one large algorithm.

## Responsibilities and data flow

| Stage | Owns | Must not own |
| --- | --- | --- |
| Performance form | Performed head/solo passes, section occurrences, source provenance, 2/4/8-bar position, boundary strength | Guessing a chorus from a repeated section ID |
| Observation adapter — partly implemented | Bounded microphone evidence, activity/density/rest qualification, coverage and freshness; diagnostic register/dynamics | Scoring, musical decisions, claiming phrase recognition or interpreting unavailable input as silence |
| Ensemble planner | Shared phrase intention, energy, density, tension, response owner, silence reasons, setup/arrival reservations | Audio APIs or arbitrary deletion of already rendered notes |
| Instrument planners | Eligible figures, voicings, bass targets and paths, ride phrases and commentary within the ensemble plan | Competing for a response already assigned to another player |
| Resolver/validator — partly implemented | Shared arrival timing, attack budgets, reserved silence, simultaneous drum-limb occupancy, event legality | Repairing a bad arrangement only by thinning random notes |
| Scheduler/renderer | Commit generated events and publish the exact accompaniment evidence used by detection | Inventing new musical decisions inside an audio callback |
| Evaluation | Replays, invariants, scenario metrics and human comparisons | Automatically declaring a musical requirement accepted |

The current path is `PerformanceForm → EnsemblePlan → piano/bass/drums → generated events → scheduler and detection evidence`.

### Form contract

`Phrase.performanceForm` is optional for backward compatibility. `buildPerformanceForm` constructs explicit contiguous chorus ranges and splits section occurrences at their boundaries. `performanceBarContext` exposes head/solo role, section/chorus position, phrase units and boundary strength.

Tune practice constructs the form **after** expanding the selected head and solo choruses, alongside the actual harmony and section map. The wrapper forwards all three. Ordinary tune playback is one explicit head performance, including internal repeats and alternate endings. Existing callers without metadata retain the legacy fallback.

The generator fits the final explicit section/pass to the emitted harmony extent, preserving pass identity when a melody tail needs accompaniment or the harmony ends early. Denominator-aware audio scheduling is a separate compatibility task: playback only passes this metadata into the current generator for quarter-note-denominator meters. Tests of 6/8 form metadata are not proof of 6/8 accompaniment timing.

### Ensemble contract

`planEnsemble` returns a deeply frozen, versioned plan and decision trace. `planEnsembleWindow` additionally returns a serializable `EnsembleMemory` checkpoint. A phrase choice persists for its phrase; named seeded streams make replay deterministic and independent of instrument draw order. This first planner exposes support, space, build, release, answer and form-marking intentions.

Each bar specifies:

- Piano role, maximum attacks, density weight and an explicit silence reason when silent.
- Drum role, commentary allowance, optional fill permission and an unconditional timekeeping obligation.
- Bass pulse obligation and ornament allowance.
- Response ownership, including `nobody`, with a cooldown and space after a response.
- Optional preceding setup and target arrival carrying the same accent identity.

Whole piano figures are filtered by the budgets of every bar they occupy. A developing motif admits each later cell whole against that bar's roles and budget; future solo evidence does not rewrite its earlier statement. Preceding piano notes release at a reserved silent boundary or an accepted motif gap, and an early player offset cannot enter that rest from the other side. Natural sample and room decay can continue after note release. Drum timekeeping is separate from commentary; whole commentary gestures must fit the allowance. A zero commentary allowance does not mute the ride or foot hi-hat. Reserved bass/drum arrivals share a tick instead of receiving unrelated timing jitter. Broader limb transitions, register and harmonic conflict resolution remain future work.

An ownership assignment is an opportunity, not a guarantee of an audible lick: vocabulary may still choose restraint. The drum phrase trace now records short piano-derived answers and reasons for withholding cells. More reciprocal motif responses remain to build.

### Memory and phrase timing

`planEnsembleWindow` receives the full declared form and a contiguous planning range. Its checkpoint binds the phrase identity, tempo and form fingerprint; a mismatched form, skipped/repeated range or foreign checkpoint is rejected. It retains the active phrase choice, response/fill cooldowns, a pending setup arrival, the last two bar summaries, the last four phrase summaries and bounded performance aggregates. JSON save/restore across a mid-phrase or setup boundary produces the same decisions as a single full-form call. Future observations can change only future windows. The ordinary loop still generates the complete form once. The rolling lab path now composes this planner checkpoint with explicit instrument memory and additive audio scheduling.

`ensemble-timing.ts` places coordinated swing events on the existing swing grid with three additions: smooth common phrase motion, a stable placement for each player and a smaller event residual. Drum limbs share one drummer placement. Named seeds keyed by phrase and exact event position keep timing independent of event order and draw counts. Motion returns to zero at phrase edges rather than accumulating tempo error. Declared bass/drum arrivals omit player residuals and share a tick; reserved piano silence still constrains attack and release.

The timing bounds are conservative engineering parameters for listening comparison, not an empirically accepted model of professional playing. Build/release intentions bias the common motion modestly, and strong closing boundaries damp it. Richer context-aware placement, live timing adaptation and motif development across phrases remain future work. Lab event exports include the final memory checkpoint and per-phrase timing trace. Cached exports restore deep immutability as well as value equality.

An October 20 listening report identified a separate sample-onset problem: the recorded foot hi-hat has about 40 ms of quiet pedal movement before the chick, whereas the ride attack begins about 4 ms into its recording. The shared drum decoder removes a declared 40 ms from that pedal sample only, retaining its natural attack and tail. Ordinary and rolling playback and offline bounce receive the same prepared buffer; generated ticks, swing, phrase timing and scoring do not change. Stereo waveform preservation and sample-rate handling have unit coverage, and a browser regression measures the audible attack of isolated pedal, stick-hat and ride hits through the public WAV renderer. This corrects a measured source of late backbeats; human listening must still assess the complete groove.

The follow-up audit covered all 91 bass recordings mapped to MIDI 28–55 and all 226 unique recordings loaded by the piano. The bass attacks promptly and needs no trim. The installed piano is the Splendid library with five velocity bands, not the previously documented Salamander library. Its hardcoded player preset omits ten sample start offsets declared by the source SFZ. `backing-piano-samples.ts` restores only those offsets through the shared pitched-sample loader, converting original 44.1 kHz frame counts into the decoded sample rate. A 0.5 ms fade at the new sample edge follows the source attack setting and avoids a hard cut. Remaining waveform and decay, musical event times, intentional piano placement and mix gains are preserved. Live and offline paths use the same preparation. See the October 20 entry in the [listening log](https://github.com/avitus/mankunku/blob/musicality/documentation/contributing/backing-listening.md) for the measured scope and a separate bass sample-selection follow-up.

### Bass and piano development

The first piano development policy uses selected complete four-bar phrases. It chooses a short rhythm from the existing figure library using the current statement's eligibility, then proposes repetition or space, a displaced reprise two bars later, and a shortened closing cell. Every later cell is admitted whole against its own bar's budget, response ownership and arrival restrictions. A rejected reprise becomes reasoned space rather than a truncated rhythm; it cannot change the already chosen statement. Displacements stay on the existing beat/eighth grid, and each attack uses the existing current or anticipated harmony and voicing path. This causal guarantee covers the new motif choices: legacy two-bar fallback figures still consult future budgets, so complete rendered-prefix stability is not yet guaranteed. This delivers scoped P12/P13 behavior without adding solo motif recognition or new voicing objectives.

The bass launch planner addresses B59 at an explicitly declared following chorus. It requires the preceding two bars already to be walking, a compatible role at the launch and suitable harmonic segment boundaries. It plans eight quarter-note pitches and the next chorus's root arrival as one bounded directional path, using the actual harmonies. The target keeps the existing register arc's root octave, preserving the register used to plan the next phrase. The realized arrival must be that exact target; independent pitched pickups and triplets cannot compete with the path. Unsupported harmony, two-feel, or space/response reservations at the launch leave the existing line in place with a reason in the trace. Later observations do not rewrite its committed quarter-note path. A terminal ending without a declared following chorus does not invent a wraparound target.

These policies run only in the coordinated swing 4/4 lab mode. Their separate piano-motif and bass-turnaround traces describe accepted cells/paths and skipped opportunities, and cached exports preserve their immutability. The ensemble checkpoint still carries planner memory, not instrument realization state. The fixed generator still starts fresh when called again. The adaptive loop path carries realized history and accepted bass arrivals across declared repeats; motif groups still end at their musical phrase boundary. General long-wave bass writing, reciprocal motif dialogue and deliberate guide-tone/common-tone/top-note lines remain later work; human listening acceptance is pending.

### Drummer phrasing

`backing-drum-phrases.ts` retains a ride cell through a two-to-four-bar group within the declared phrase, section and chorus. A repeated opening can lead to a skip-note variation and a quieter release. The quarter-note cymbal pulse and pedal hi-hat on beats 2 and 4 stay protected; an agreed arrival or cymbal-colored commentary may replace a coincident ride stroke. Short groups and partial harmony have bounded fallback behavior, without inventing a following bar.

Commentary begins from a short vocabulary cell or one or two beat/eighth-grid piano attacks from the previous bar's emitted onset map. It can repeat, displace or change orchestration while retaining its source identity. Each later cell must fit the current bar's allowance, response ownership, fill reservation and actual harmony extent. A withheld motif cell leaves reasoned space. This uses generated piano evidence, not microphone listening or a model of the soloist's phrase endings.

The current kit uses a fixed assignment: ride, bell, crash and stick hi-hat share the right hand; snare and cross-stick share the left hand; kick and pedal hi-hat use separate feet. Complete accepted gestures replace conflicting ostinato strokes at the same offset. The immutable drum trace includes the accepted bar and commentary source, transformation and withholding reason; integration checks compare it with emitted events after collision resolution. This is a simultaneous-occupancy model, not a general biomechanical simulation: stick travel, recovery times, flexible sticking, toms and note-length/choke articulation remain incomplete. Drum motif state remains within a generated phrase and is not part of the restorable ensemble checkpoint. Original practice output and scoring remain unchanged; human listening acceptance is pending.

### Solo evidence contract

`SoloFeature` includes decision bar, observation bar, source, confidence, note density and rest duration. Only finite, sufficiently confident, fresh evidence can affect the plan. Missing, invalid, stale or future evidence falls back to accompaniment-led form decisions. Future features cannot change earlier decisions.

The first live-observation stage uses `solo-observer.ts` for bounded feature accumulation and `solo-listener.ts` for the lab's microphone lifecycle. Capture accompanies one finite pass. Completed bars can qualify as active or resting, or remain unknown because of insufficient coverage, input loss or ambiguous backing matches. The trace retains the evidence behind each result, and only qualified completed evidence is eligible for a later decision bar. Only feature summaries stay in the page; raw audio is neither recorded nor uploaded. The lab can export that bounded trace and generate a coordinated replay from its density/rest features after the take. The replay uses the captured evidence; it does not claim to react to new playing during playback.

Headphones are an operating assumption, and the observer uses fixed engineering thresholds that depend on microphone gain and device characteristics. It does not calibrate the room or separate sound sources. A rest requires healthy frame coverage below the quiet threshold. The committed accompaniment schedule helps identify suspicious nonquiet matches, but uncertainty remains unknown rather than becoming a soloist rest. Fast or busy backing can leave too little independently supported activity for a usable observation. A held note is activity without necessarily being a dense run; a missing pitch estimate alone cannot establish silence.

Register and dynamics are diagnostic observations in this stage and do not steer the accompaniment. The optional `phraseEnded` field still does not establish phrase recognition. MIDI input, reliable solo phrase-end detection, register avoidance, contour and rhythmic imitation remain separate work. The rolling lab mode now uses qualified density/rest evidence during the same take. The fixed capture/replay option remains available for comparison.

### Scheduling and scoring boundary

`BackingTrackSchedule` feeds pitch bleed filtering and onset handling as well as playback. The current coordinated mode generates one coherent event set; live playback and offline bounce use the same generation policy. Scoring algorithms, pass thresholds and practice progress are unchanged.

### Rolling orchestration decision — 15 October 2026

The additive path is `backing-rolling.ts` → `backing-rolling-session.ts` → `backing-rolling-renderer.ts`, with browser instrument ownership in `backing-track.ts`. It is limited to finite, complete coordinated swing 4/4 forms of at most 128 bars in the listening lab. The original generator and ordinary practice/scoring policy stay unchanged.

- Static preparation knows the complete harmony and form, but does not generate a full performance and splice future suffixes. Each call realizes exactly one new absolute bar from a versioned, score-bound checkpoint.
- Piano retains motif, figure and sounded voicing history. Bass uses forward pitch/velocity/ornament streams and retains actual pitch history, harmonic targets and accepted following-chorus launches. Drums retain ride/commentary phrase state and the previous emitted piano attacks. Ensemble cooldowns and accepted setup/arrival reservations survive later observations. Timing coefficients latch at phrase entry against its known form extent.
- Rolling v1 owns each bar's attacks and pitched releases. Early microtiming cannot precede that bar; sustained bass/piano releases end by its boundary. Unreserved two-bar piano fallback figures are excluded; selected motif cells continue through retained state and current-bar admission. This deliberately limits vocabulary parity and cross-bar sustain, rather than letting a later silence decision rewrite a sounding note. Sample envelopes and room tails may remain audible after scheduled release.
- The renderer derives its dispatch horizon from actual audio time, Tone lookahead/update interval and a small safety allowance. A separate measured computation budget determines when rendering must start. Two initial bars are primed; a 25 ms coordinator pump approaches the next deadline with a 75 ms timer margin. Each batch is revalidated after computation. A missed deadline or suspended audio stops the take; it never emits a burst of overdue notes.
- Completed microphone windows carry original availability timestamps. Receipt time and the next uncommitted bar are recorded separately. Future, duplicate and foreign observations are rejected; older evidence is never made fresh by changing its observation timestamp. Qualified evidence can affect only a later eligible decision. Missing or ambiguous input leaves a complete form-led band.
- Every accepted window appends audio callbacks and the exact corresponding pitch/transient bleed reference as one synchronous transaction. Rejected registration rolls back the candidate callbacks and does not advance musical memory. Unique voice ownership and transport IDs protect a new take from late callbacks or cleanup belonging to an old one.
- Stop, navigation and parameter changes invalidate pending permission/sample work, cancel callbacks and stop owned voices. A completed adaptive export and bounce use the committed event ledger, not a regeneration from the final observations. Partial exports retain dispatch evidence and explicitly identify cancelled future notes; only complete takes can be bounced.

An ensemble checkpoint alone was insufficient: legacy piano figures consult future budgets, future silence can change earlier durations, and full-segment bass random draws can depend on later ornaments. The separate forward path avoids those dependencies while reusing existing harmonic, motif, turnaround and drum vocabulary. No LLM or network request belongs in the scheduling deadline.

This is bounded bar-level adaptation, not instantaneous call-and-response or acoustic source separation. The observer still assumes headphones and gain-dependent thresholds. Long main-thread stalls terminate the take. Human listening must assess the shorter rolling sustain policy, forward bass phrasing and musical reaction delay before enabling this in practice.

### Cross-loop adaptation decision — 16 October 2026

The lab's **Adapt across loops** action declares the repeat count before starting, then uses the same rolling pipeline for the entire take. The selectable counts are 2, 3, 4 and 8, filtered to at most 512 performed bars; each source form remains at most 128 bars. A 96-bar AABA preset already contains three choruses, so repeating it twice creates two loops and six choruses, not two choruses. One-pass behavior remains available for comparison.

- Static preparation repeats harmony and explicit chorus/section spans, with unique absolute occurrences and retained source provenance. Each bar exposes loop, source bar, source chorus and source section identity. Only static score data is expanded; notes are realized one upcoming bar at a time.
- One audio epoch, microphone stream, observer, checkpoint chain and additive event ledger span every seam. Ensemble response/fill cooldowns, previous piano attacks used by the drummer, voicing and bass history are carried forward. A new musical phrase can choose a new motif; repeating the score does not replay a previously rendered phrase.
- Fresh completed observations near the seam can influence a later uncommitted bar in the next loop. Availability and receipt times remain absolute. A previous loop's evidence is never replayed or made fresh by reducing its bar index modulo the source length. Missing input returns to the existing unavailable-evidence policy.
- The next declared loop supplies real following harmony for eligible bass launches and setup/arrival reservations. The final loop has no invented next-loop target. Committed notes, including an accepted path and arrival, remain immutable when later observations arrive.
- The status shows the sounding loop from the audio clock rather than the scheduler's lookahead position. Stop, navigation, parameter changes, stalled audio and cancelled permission still cancel the entire owned take. Loop boundaries neither reopen input nor restart playback.
- Event exports retain the expanded performed form, loop mapping, actual committed events, checkpoints, dispatches and observation receipts. Recorded-feature comparison uses the same full captured timeline. A completed WAV bounce includes all loops and the room tail. Browser WAV rendering is limited to ten minutes including the tail to bound its full-buffer allocation; longer takes retain complete JSON export and are never silently truncated.

This is deliberately bounded repetition of a declared score, not an endless session or a form editor during playback. Indefinite adaptation needs bounded event-history retention and a separate policy for deciding the next form before its scheduling deadline. Loop count is part of checkpoint identity; a checkpoint cannot be restored against a different repeat plan. Ordinary practice and scoring stay unchanged. Human listening must still judge response timing, seam continuity and long-take development.

Acceptance evidence is in `backing-rolling-loop.test.ts`, `backing-rolling-loop-session.test.ts`, observer/renderer boundary tests and the cross-loop browser cases in `solo-listening.spec.ts`. These cover real generated events, restored seam checkpoints, absolute observation freshness, scheduling ownership, full-form replay and WAV duration. Automated evidence does not establish musical acceptance.

## Delivery sequence

Every increment stays on `musicality`, updates the ledger in the same change and preserves an original/reference comparison. Small focused commits allow fixes on `dev` to proceed independently; integrate advancing `dev` deliberately and rerun the relevant regressions before a later merge.

The exact `musicality` branch has a hosted CircleCI setup-workflow guard, so ongoing pushes do not allocate its path-filtering or continuation jobs. CircleCI may still show a skipped pipeline record. Validate milestones on a Chunk sidecar or locally using the [contribution guide](/docs/contributing/contributing#ci); `dev`, `main` and other branches retain their existing CI. A skipped pipeline is not verification evidence, and moving this work to a release branch remains a separate decision.

| Milestone | Deliverable and acceptance | Current state |
| --- | --- | --- |
| 1. Living evidence | Preserve original text; enumerate every requirement; direct links; separate source, test and listening claims | Implemented |
| 2. Performed form | Explicit chorus/head/solo context survives expansion and repeats; generators receive the performed structure | Implemented foundation; audio support remains scoped |
| 3. Shared intention and space | Phrase plans, complementary piano/drum budgets, silence, response cooldown, setup/arrival ownership; actual generated-event invariants | Implemented foundation in lab preview; listening pending |
| 4. Phrase memory and timing | Checkpointable short/medium/performance memory; response and fill history across loops; phrase timing with player offsets and coordinated exceptions | Planner checkpoints and shared phrase timing implemented; bounded cross-loop audio state implemented in the lab; listening acceptance pending |
| 5. Bass and piano development | Multi-bar bass targets/turnarounds, melodic restraint, rhythmic motifs and transformations, then explicit guide/common/top-note objectives | Scoped following-chorus bass launches and within-phrase piano motifs implemented in the lab; broader melodic objectives and listening acceptance pending |
| 6. Drummer phrasing | 2–4-bar ride phrases, commentary motifs, shared setups, credible limb allocations, expanded kit articulation when needed | Ride/commentary phrasing, recent-piano answers and simultaneous limb occupancy implemented in the lab; broader physical/articulation models and listening acceptance pending |
| 7. Live listening | Independent activity/rest/register features, confidence and bleed handling, rolling atomic scheduling, safe reset/replay | 7a capture/replay, 7b rolling adaptation and 7c bounded cross-loop continuity implemented in the lab; indefinite continuation, richer solo understanding, acoustic validation and listening acceptance pending |
| 8. Structural development and styles | Non-monotonic build/peak/release across choruses; head/solo arrangements; traditional/bebop/post-bop profiles and complexity separate from density | Local phrase movement started; full arc/styles planned |
| 9. Musical acceptance and rollout | Recorded A/B reviews at multiple tempos/seeds/forms; maintain evidence in ledger; enable ordinary practice only after acceptance | Lab ready; human acceptance pending |

Vocabulary work should follow the specification's priorities. Do not implement every exotic voicing or substitution before the band leaves appropriate space. Each new device should declare its identity/family, scope, compatible roles, duration, density, required harmonic agreement, cooldown and transformations. A reusable device contract should grow from the existing figure representation rather than duplicating it beside the engine.

## Evaluation and status maintenance

The original spec stays verbatim in `documentation/musicality/spec.md`. The separately reviewed manifest in `src/lib/musicality/manifest.ts` joins it by stable S/P/B/D IDs. Validation rejects duplicate, missing or unknown requirements. A new device is not automatically marked implemented merely because its name appears in source.

For each change, record its musical scope, reachable behavior, remaining limitations and evidence revision. Baseline evidence is pinned to its inspected commit; later branch evidence must be labeled separately. Once a milestone is finalized, pin its evidence to the implementation commit. The running app build identity is displayed independently from the audit identity.

Use three layers of verification:

1. **Contracts and properties:** deterministic replay; causal observations; response exclusivity; pulse preservation; accurate form; reserved silence; coordinated onset; valid ranges/durations; no stale scheduled notes.
2. **Scenario/event evidence:** A medium swing, B dense soloist, C sparse soloist, D chorus build/release, E section arrival and F repeated harmony, across slow/medium/fast tempi and several seeds. Export the exact events and decision trace. Golden fixtures detect accidental changes but do not judge musical quality.
3. **Human listening:** blind original/coordinated comparison with matching preset, seed, tempo, instrument and mix. Ask about swing, space, repetition, interaction, form and development. Record the build, preference and concrete observations, including ties or regressions.

An automated result can promote verification evidence; it cannot promote listening acceptance. Keep the new mode reversible until the actual sound has been judged. Persisted listening reports and automatic detection of stale evidence are useful follow-up improvements; the current ledger is deliberately reviewed data rather than an automatic code scanner.

### Browser audio verification boundary — 15 October 2026

The initial full-mix WebKit test concealed a silent bass stem: `smplr` 1.0.0 selected M4A from browser hints, then resolved loading even when every sample decode failed. Independent fixed-note probes showed that the same OGG samples decoded in both Chromium and WebKit. The repaired shared loader now tests actual decoding, tries alternate encodings, preserves sharp signs/spaces in sample URLs and requires every referenced sample before reporting bass/piano readiness. Both live loading and offline bounce use this policy. Failed instruments disconnect, and disposal invalidates outstanding pitched loads.

Four automated browser audio tests now pass across Chromium and WebKit. A fixed six-note phrase rendered isolated bass and piano with audible signal on every note: bass peaks were approximately 0.50–0.69 and piano 0.81–0.89 in both engines. Full-mix and golden-reference renders also retained signal throughout their measured durations. Unit regressions cover codec fallback, partial-bank failure/retry, encoded sample names and disposal during bass/piano loading. These checks establish actual offline WAV output and readiness behavior; they do not establish musical quality or hardware Safari behavior.

At the preceding checkpoint/timing milestone (`19ab6bf3`), the full unit suite passed 6,240 tests with 40 existing expected failures. The tracker and lab passed 18 browser checks across Chromium, Firefox and WebKit; type checking was clean. Original-mode golden events and the previous full-form planner decisions were preserved. An independent split-window probe also matched 200 varied forms, including 150 setup/arrival pairs. These are historical validation results for that milestone, not the test count for the subsequent bass/piano increment. Human A/B listening acceptance remains pending.

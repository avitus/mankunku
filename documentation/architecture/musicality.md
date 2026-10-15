# Rhythm section musicality

The `musicality` branch develops the accompaniment as an ensemble. The target is the [original specification](/musicality#original-spec); the [implementation ledger](/musicality) records individual requirements, evidence and remaining work. A legal note sequence or passing test does not establish that a performance sounds musical.

## Current foundation

The current foundation provides:

1. A living specification with all 50 sections and 202 named devices, separate implementation and listening status, source/test evidence, search, filters and permanent requirement links.
2. An explicit performed form. The owner of a playback session supplies head/solo passes, section occurrences and chorus boundaries. An internal repeated A section is no longer mistaken for another chorus when this metadata is present.
3. A pure ensemble planner before instrument generation. It assigns phrase intention, piano attack limits, drum commentary limits, bass ornament restraint, response ownership, intentional silence and selective setup/arrival pairs. The existing players realize those instructions with their established vocabulary.
4. Restorable planner memory and correlated phrase timing. Planning can resume at a contiguous bar boundary from a versioned JSON checkpoint; the three players share bounded phrase motion with their own placement and smaller event residuals.

Coordinated generation currently applies to **swing in 4/4**, selected in the [listening lab](/diagnostics/backing-mixer). Ordinary practice keeps the original orchestration mode until the comparison has received listening acceptance. Both modes consume corrected explicit form metadata where available. The lab supports original/coordinated comparison, variation seeds, WAV bounce and event/decision export.

Optional solo observations are an input contract and can be scripted for tests. They are **not a live microphone connection**. The complete timeline is still generated before playback; looping repeats that timeline. Neither the real-time adaptation milestone nor the complete vocabulary specification is finished.

## What the existing architecture provides

`backing-generation.ts` separates deterministic musical decisions from Tone/smplr rendering. Each instrument has its own seeded random streams. The piano has named one/two-bar figures and voice-leading, the bass has targets, approaches and contour, and drums have timekeeping, commentary and fills. Existing reports, golden fixtures and the lab make changes reproducible.

Those are useful foundations. The missing architectural responsibility was deciding what the band is doing together. Previously piano generated first, bass independently, then drums could react to their onset maps. That one-way coupling could not reserve a response for one player, ask piano to leave space for a drum setup, or distinguish missing solo information from a soloist resting.

The foundation preserves instrument-specific musical knowledge and inserts an explicit planning contract. It does not replace those generators with one large algorithm.

## Responsibilities and data flow

| Stage | Owns | Must not own |
| --- | --- | --- |
| Performance form | Performed head/solo passes, section occurrences, source provenance, 2/4/8-bar position, boundary strength | Guessing a chorus from a repeated section ID |
| Observation adapter — planned | Causal solo activity, density, phrase-end/rest confidence, register and freshness | Scoring, musical decisions or interpreting unavailable input as silence |
| Ensemble planner | Shared phrase intention, energy, density, tension, response owner, silence reasons, setup/arrival reservations | Audio APIs or arbitrary deletion of already rendered notes |
| Instrument planners | Eligible figures, voicings, bass targets and paths, ride phrases and commentary within the ensemble plan | Competing for a response already assigned to another player |
| Resolver/validator — partly implemented | Shared arrival timing, attack budgets, reserved silence, event legality | Repairing a bad arrangement only by thinning random notes |
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

Whole piano figures are filtered by the budgets of every bar they occupy. Preceding piano notes release at a reserved silent boundary, and an early player offset cannot enter that rest from the other side. Natural sample and room decay can continue after note release. Drum timekeeping is separate from commentary; whole commentary gestures must fit the allowance. A zero commentary allowance does not mute the ride or foot hi-hat. Reserved bass/drum arrivals share a tick instead of receiving unrelated timing jitter. Broader limb, register and harmonic conflict resolution remains future work.

An ownership assignment is an opportunity, not a guarantee of an audible lick: existing vocabulary may still choose restraint. Future motif response realization should provide explicit response devices and traces for rejection reasons.

### Memory and phrase timing

`planEnsembleWindow` receives the full declared form and a contiguous planning range. Its checkpoint binds the phrase identity, tempo and form fingerprint; a mismatched form, skipped/repeated range or foreign checkpoint is rejected. It retains the active phrase choice, response/fill cooldowns, a pending setup arrival, the last two bar summaries, the last four phrase summaries and bounded performance aggregates. JSON save/restore across a mid-phrase or setup boundary produces the same decisions as a single full-form call. Future observations can change only future windows. This is planner continuity, not a rolling audio scheduler: playback still generates the complete form once and repeats it on a loop.

`ensemble-timing.ts` places coordinated swing events on the existing swing grid with three additions: smooth common phrase motion, a stable placement for each player and a smaller event residual. Drum limbs share one drummer placement. Named seeds keyed by phrase and exact event position keep timing independent of event order and draw counts. Motion returns to zero at phrase edges rather than accumulating tempo error. Declared bass/drum arrivals omit player residuals and share a tick; reserved piano silence still constrains attack and release.

The timing bounds are conservative engineering parameters for listening comparison, not an empirically accepted model of professional playing. Build/release intentions bias the common motion modestly, and strong closing boundaries damp it. Richer context-aware placement, live timing adaptation and long-term motif development remain future work. Lab event exports now include the final memory checkpoint and per-phrase timing trace. Cached exports restore deep immutability as well as value equality.

### Solo evidence contract

`SoloFeature` includes decision bar, observation bar, source, confidence, note density and rest duration. Only finite, sufficiently confident, fresh evidence can affect the plan. Missing, invalid, stale or future evidence falls back to accompaniment-led form decisions. Future features cannot change earlier decisions.

This narrow contract deliberately starts with density and rests. The optional `phraseEnded` field is carried but does not yet influence decisions. Pitch/register, contour and rhythmic motifs need separate validated features. Microphone input is particularly vulnerable to hearing the generated backing itself; its adapter must use the committed accompaniment timeline and independently qualified confidence before making the band respond.

### Scheduling and scoring boundary

`BackingTrackSchedule` feeds pitch bleed filtering and onset handling as well as playback. The current coordinated mode generates one coherent event set; live playback and offline bounce use the same generation policy. Scoring algorithms, pass thresholds and practice progress are unchanged.

Real-time listening will require a rolling planner with explicit checkpoints:

1. Observe only completed audio/MIDI evidence, accounting for capture and analysis latency.
2. Keep a short immutable committed horizon; plan farther ahead on a musical grid.
3. Replan only uncommitted bars, retaining pending motifs, setups, responses and random-stream state.
4. Validate the whole candidate window before commitment.
5. Publish scheduled events **and** detection/bleed evidence together under one generation token.
6. Cancel obsolete future events on stop, restart, tempo/key changes and navigation; reject stale asynchronous work.
7. If observations are absent or delayed, continue a complete accompaniment plan without changing score interpretation.

The commit horizon must be measured against Tone lookahead, renderer scheduling and microphone latency on supported browsers. A fixed number chosen without those measurements would be premature. No LLM or network request belongs in the audio scheduling deadline.

## Delivery sequence

Every increment stays on `musicality`, updates the ledger in the same change and preserves an original/reference comparison. Small focused commits allow fixes on `dev` to proceed independently; integrate advancing `dev` deliberately and rerun the relevant regressions before a later merge.

| Milestone | Deliverable and acceptance | Current state |
| --- | --- | --- |
| 1. Living evidence | Preserve original text; enumerate every requirement; direct links; separate source, test and listening claims | Implemented |
| 2. Performed form | Explicit chorus/head/solo context survives expansion and repeats; generators receive the performed structure | Implemented foundation; audio support remains scoped |
| 3. Shared intention and space | Phrase plans, complementary piano/drum budgets, silence, response cooldown, setup/arrival ownership; actual generated-event invariants | Implemented foundation in lab preview; listening pending |
| 4. Phrase memory and timing | Checkpointable short/medium/performance memory; response and fill history across loops; phrase timing with player offsets and coordinated exceptions | Planner checkpoints and shared phrase timing implemented; cross-loop audio state and listening acceptance pending |
| 5. Bass and piano development | Multi-bar bass targets/turnarounds, melodic restraint, rhythmic motifs and transformations, then explicit guide/common/top-note objectives | Existing vocabulary retained; new development planned |
| 6. Drummer phrasing | 2–4-bar ride phrases, commentary motifs, shared setups, credible limb allocations, expanded kit articulation when needed | Pedal hi-hat and coordinated commentary started; broader phrasing planned |
| 7. Live listening | Independent activity/rest/register features, confidence and bleed handling, rolling atomic scheduling, safe reset/replay | Input contract only; adapter and scheduler planned |
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

The full unit suite passes 6,240 tests with 40 existing expected failures. The tracker and lab pass 18 browser checks across Chromium, Firefox and WebKit; type checking is clean. Original-mode golden events and the previous full-form planner decisions are preserved. An independent split-window probe also matched 200 varied forms, including 150 setup/arrival pairs. Human A/B listening acceptance remains pending.

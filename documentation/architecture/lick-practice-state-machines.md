# Daily and recommended Deep Practice: state machines

Code audit: 2026-10-06. Daily cue and notation simplification is scoped separately from the Deep handoff implementation at `864bb730` and its later preparation cues. This document concerns lick practice, not tune practice or trick drills.

## Deep transition audit: predictable next action

The earlier diagrams exposed the reported bug: notation was reevaluated at a cycle boundary, while `Play → Play` explicitly included retries, tempo steps and handoffs with **zero preparation bars**. The handoff repeated the current key while a different key appeared underneath, but its cue only said “Play”. A sheet graduation at that boundary could therefore remove the sheet and demand another same-key attempt immediately. The strategy was internally consistent; the player-facing state machine was incomplete.

| Boundary reviewed | Gap in the earlier diagrams | Current contract |
| --- | --- | --- |
| Sheet graduation, including later rows and returning keys | Support disappears on a playing downbeat | Name the key and “from memory” before recording opens; at least one preparation bar |
| Earned handoff, including later admissions | Lower chart suggests advance, while current key repeats | One preparation bar naming “once more”; repeat cue names the promised next key |
| Focus retry, tempo step up/down, rebuild survivors, full rotation refill | Outcome depends on the just-finished score; no time to react | “Then get ready” during the final take; resolve result, show the next key and changed BPM, prepare for one bar |
| Deep: three sheet passes with a different key below | Lower chart is not yet the immediate next action | First two passes say the same key is next; final pass names the next key or upcoming preparation |
| Promised key after handoff | Already announced for an entire loop | Honor it directly; retain two-bar sheet preparation if needed |
| Ordinary Deep reorder/refill | Existing turnaround gives time, but does not explain a repeat or graduation | Reuse that bar and name the repeat, memory change and changed BPM |
| Deep call and response | Per-key call already gives reaction time | Retain calls and turnaround; name “Listen to [key] next” when another call follows |
| Daily key/lick transitions | Upcoming sheets used to appear only at entry, requiring a reading pause | Show notation from the start in equal-height rows; continuous Play between keys, including all three sheet passes; retain two-bar inter-lick rest |

Deep preparation uses the same pause plan as backing, microphone windows and visual cues. It never adds scored attempts. Existing two-bar sheet preparation absorbs the one-bar requirement; the two are not added together. A later key that graduates from its sheet gets its own one-bar preparation, even if it sat out a round before returning. Key names are in the player's written pitch. Score-dependent future keys are not guessed before the result is known.

## Reading the diagrams

There are three simultaneous state machines, not one:

| Layer | States | Owns |
| --- | --- | --- |
| Session lifecycle | setup, count-in, lick-running, inter-lick-rest, complete | Loading, scheduling, plan advancement, report |
| Musical activity | count-in, listen, read/preparation, play, transition, idle | What the player should do now; derived from recording windows |
| Recommended Deep strategy | focus, handoff, rebuild, complete | Which keys enter the next cycle and at what tempo |

Notation is a separate per-key decision. **Playing with sheet music is still PLAY.** The internal `read` phase means a timed preparation period with the microphone's scoring window closed. It is not the entire time the sheet is visible. A `complete` focus ramp means the drill continues with its full rotation; a `complete` session means playback stops and the report opens.

All score comparisons below use unrounded values. A displayed 70% can represent a value just below 70%. A loop is the entire effective lick length, including any extension beyond the progression. A bar uses the phrase's time signature; the final entrance cue counts at most four beats.

## 1. Shared session lifecycle

```mermaid
stateDiagram-v2
    [*] --> Setup
    Setup --> PlanReady: Start / build Daily or Deep plan
    Setup --> Setup: No eligible lick or invalid selection
    PlanReady --> Loading: Navigate or restart session page
    Loading --> MicError: Microphone unavailable or denied
    Loading --> AudioError: Sample or detector initialization fails
    Loading --> CountIn: Mic and audio ready
    MicError --> Setup: Return to setup
    AudioError --> Loading: Reload and retry
    CountIn --> Running: One count-in bar ends
    Running --> Running: Next key or Deep cycle
    Running --> ScoreHold: Daily final key closes
    ScoreHold --> Running: One bar elapsed / another Daily lick remains
    ScoreHold --> Report: Plan exhausted or duration budget reached
    CountIn --> Report: End Session
    Running --> Report: End Session
    ScoreHold --> Report: End Session
    Report --> Loading: Start recommended Deep Practice in place
    Report --> Loading: Start progression in place with Focused configuration
    Report --> Setup: Done
    Loading --> Disposed: Navigate away
    CountIn --> Disposed: Navigate away
    Running --> Disposed: Navigate away
    ScoreHold --> Disposed: Navigate away
    Report --> Disposed: Navigate away
    Disposed --> [*]
```

Loading prebuilds the chart, acquires the mic, loads samples and starts pitch detection. The elapsed practice clock begins when transport playback starts, excluding loading and permission dialogs. Initialization continuations check whether the page was destroyed. Teardown cancels future transport work, stops instruments and detectors, releases the mic, and discards an unfinished recording window. Completed attempts already written remain available.

This lifecycle diagram names the stages the player experiences. Loading, errors, score hold and disposal are page-local flags, not extra `LickPracticePhase` enum values. In particular, `startLick` sets the coarse enum to `lick-running` while scheduling the first bar; the audible count-in/listen/play distinctions come from the finer musical timeline. The mic can be acquired and its detector running while the scored recording window is closed.

End Session creates a report from completed attempts, including an in-progress lick's completed keys. Daily completion during its score-hold bar still runs that lick's advancement bookkeeping. Deep Practice has no duration cutoff: the user ends it. A missing plan redirects to setup. There is no pause/resume state in this flow.

## 2. Daily plan and one complete lick

Daily collects eligible practice-tagged licks across progressions, ordered least recently practiced first. Each lick gets a compatible progression from its tags/history, its saved tempo (new lick default 60 BPM), and its unlocked key set. Under twelve unlocked keys it uses the unlock order; fully unlocked licks use the tempo-dependent key planner. Whole licks fill the duration budget, with one oversized lick permitted so Start is not a no-op. The displayed duration estimates demos, notation rehearsals, count-in and score hold. Daily has no sheet-preparation bars; the budget and audio plan both omit them.

```mermaid
stateDiagram-v2
    [*] --> CountIn: First lick only / one bar
    CountIn --> Demo: Continuous mode
    CountIn --> Call: Call and response mode
    Demo --> KeyChoice: App plays first key for one lick length
    KeyChoice --> SheetPass1: Revealed key / sheet already visible
    KeyChoice --> MemoryPlay: Unrevealed key
    SheetPass1 --> SheetPass2: First rehearsal closes / flash score
    SheetPass2 --> SheetPass3: Second rehearsal closes / flash score
    SheetPass3 --> RecordResult: Final pass closes
    MemoryPlay --> RecordResult: Single pass closes
    Call --> Response: App's full lick finishes
    Response --> RecordResult: Player's full lick finishes
    RecordResult --> KeyChoice: Another key / continuous
    RecordResult --> Call: Another key / call and response
    RecordResult --> HoldResult: Last key / one bar score hold
    HoldResult --> AdvanceLick: Archive and update Daily progress
    AdvanceLick --> NextLickLead: Another planned lick and time remains
    NextLickLead --> Demo: Continuous / second rest bar finishes
    NextLickLead --> Call: Call and response / second rest bar finishes
    AdvanceLick --> Report: Plan exhausted or time budget reached
    Report --> [*]
```

| State | Audio and microphone | Screen and player action | Exit |
| --- | --- | --- | --- |
| Count-in | One bar; no scored recording | Initial charts, including eligible sheets; plain red Listen, no numeral | First demo or call |
| Demo | Melody plus enabled backing; no scored recording | Plain red Listen, then key-free Play 4–1 over the final bar | After one full lick |
| Memory play | Backing; recording window open | Play; chord chart and beat dots | One lick closes |
| Sheet rehearsal 1 and 2 | Backing; captured and scored | Play from visible sheet; inline feedback | Immediately next pass, no gap |
| Sheet final pass | Backing; captured and scored | Play; sheet remains visible | Persist one attempt for that key |
| Call | App plays lick; no scored recording | Listen; sheet visible if eligible | Player response |
| Response | Backing; scored recording | Play; one response even if sheet is visible | Persist result |
| Score hold | First rest bar, no scored recording | Finished lick's feedback/breather | Advance bookkeeping |
| Next-lick lead | Second rest bar, enabled ii–V cue into next key | Next chart shown before demo/call | Next lick downbeat |

Daily's sheet rows are visible as notation from the first render, including upcoming rows. They use the same 128 px height as chord-only rows. The CHANGES word is removed while its space remains. The active cue says only Listen, Play, or Rest (plus the sheet-pass number). Only the final bar of a demo/call has a Play countdown, with no key name. Continuous key changes and all three sheet passes join without Read, preparation, or an entrance countdown. The initial audio count-in and two-bar gap between licks remain.

```mermaid
sequenceDiagram
    participant A as Audio
    participant U as Daily chart
    participant P as Player
    U->>P: Current chords and upcoming sheet visible from the start
    A->>P: Demonstrate first key
    U->>P: LISTEN without countdown
    U->>P: PLAY 4, 3, 2, 1 during final demo bar
    P->>A: Play current key
    U->>P: PLAY
    Note over A,P: Direct key boundary, no added bar
    U->>P: Activate existing sheet row, PLAY 1/3
    P->>A: Sheet passes 1, 2, 3 without gaps
    A->>U: Retain final pass result
```

The three sheet passes are not three persisted attempts. Only the final pass updates progress, report and recording history. Current production keeps the sheet visible for all three; the comment describing “play it from memory” is not an enforced hide-on-third-pass behavior.

## 3. Daily advancement and recommendation

```mermaid
flowchart TD
    Close[Daily lick finished] --> Has{Any recorded results?}
    Has -->|No| Next[Next lick or report]
    Has -->|Yes| Stats[Compute mean and minimum score]
    Stats --> Floor{Every key at least 75 percent?}
    Floor -->|No| NoUnlock[Block unlock and positive tempo change]
    Floor -->|Yes| Gate{Mean at least 90 percent AND newest key has 3 passes AND fewer than 12 keys?}
    Gate -->|Yes| Unlock[Unlock one key, reduce saved tempo by 10 percent]
    Gate -->|No| Delta[Apply score-based tempo change]
    NoUnlock --> Delta
    Delta --> Save[Persist per-lick tempo and progress-history point]
    Unlock --> Save
    Save --> Next
    Next --> Report[Session report]
    Report --> Rest{Mean below 75 percent over at least 8 attempts?}
    Rest -->|Yes| Stop[Recommend rest, no drill action]
    Rest -->|No| Weak{Eligible repeated weak key?}
    Weak -->|No| Done[Completion recommendation]
    Weak -->|Yes| Drill[Recommend Deep Practice with focusKey]
```

Daily tempo adjustment: mean ≥95%: +2 BPM; ≥90%: +1; ≥75%: −1; below75%: −3. A minimum below75% caps the delta at zero. A key unlock replaces the delta with the 10% reduction. Tempo is clamped to 50–300 BPM. A persisted pass means ≥90%, distinct from Deep's ≥95% mastery/drop threshold.

Recommendations use up to five recent sittings per key, deduplicating retries and progression slices. More than half must be below90%. Learning licks (fewer than twelve keys) rank before fully unlocked licks; fully unlocked keys additionally need at least three weak sittings. Within that priority the lower median wins. The recommendation passes the lick and `focusKey` to Deep; it does not unlock a new key.

## 4. Recommended Deep Practice: strategy and key admission

Opening: validate that the focus key is unlocked; start that key alone at saved tempo minus 10% (rounded to the nearest BPM, at least a 1 BPM reduction unless already at the minimum50). Queue the other unlocked keys worst first by rolling score, with never-practiced keys first. Keep the complete unlocked set as the stable progress ring. Continuous mode plays one opening demo; later misses and tempo changes do not request another demo.

### Baseline failure, before this change

```mermaid
sequenceDiagram
    participant P as Player
    participant A as Audio scheduler
    participant S as Strategy
    participant U as Chart
    P->>A: Finish focus attempt at 82 BPM
    A->>S: Close callback runs ahead of audible boundary
    S->>S: Passed, proposed next tempo is 83
    S->>S: Admit queued key immediately, sort weakest first
    S->>U: Replace entire stack and reset scroll now
    Note over P,U: Last audible beat can still belong to the old key
    A->>P: New key starts at 83 on the next downbeat
    Note over P,U: No previous loop showed that key, no preparation time
```

The old “up to speed” milestone also described the *next* BPM, rather than a successful attempt actually performed at the target.

### Handoff: announce the repeat and show what follows

`handoff` is an internal strategy state. After clearing the focus key at the actual target, give one unscored preparation bar, then repeat it once while the next key's chord chart is already visible below it. The entrance says “[key] once more”, including “from memory” if the sheet has just withdrawn; the play cue says “[key] once more · [next key] next”. Then start the promised key first in the rebuilt rotation. The final repeat cannot revoke admission or lower tempo. Its genuine score is still recorded.

Use the same one-loop handoff for later admissions: after clearing the remaining active keys, repeat the last-played key while showing the queued key. This prevents the same surprise when the rotation grows from two to three keys and beyond. Do not repeat an entire multi-key rotation just to provide notice. If there is no queued key, no handoff is needed.

```mermaid
stateDiagram-v2
    [*] --> ValidateFocus
    ValidateFocus --> OrdinaryDeep: Focus absent or not unlocked
    ValidateFocus --> OpeningDemo: Valid focus / continuous
    ValidateFocus --> Focus: Valid focus / call and response uses per-key calls
    OpeningDemo --> Focus
    state Focus {
        [*] --> Solo
        Solo --> Solo: Score below 75% / lower BPM by 3 times bump percentage
        Solo --> Solo: Score 75% to below 95% or missing / hold BPM
        Solo --> Solo: Score at least 95% below target / bump capped at target
    }
    Focus --> Handoff: Clear at target AND queue nonempty
    Focus --> FullRotation: Clear at target AND queue empty
    state Handoff {
        [*] --> AnnounceRepeat
        AnnounceRepeat: One unscored bar, name repeat and any sheet graduation
        AnnounceRepeat --> PreviewLoop: Entrance count ends
        PreviewLoop: Repeat last-played key once at held tempo<br/>Show promised next key underneath<br/>Record actual score, no new pass requirement
    }
    Handoff --> Rebuild: Repeat finishes / admit promised key first, queue remains
    Handoff --> FullRotation: Repeat finishes / admit final queued key
    Rebuild --> Rebuild: Some keys below 95% / drop mastered keys, retry survivors
    Rebuild --> Handoff: Active rotation cleared / preview next queued key
    FullRotation --> FullRotation: Some keys below 95% / retry survivors
    FullRotation --> FullRotation: Entire rotation cleared / bump BPM and refill unlocked set
    OrdinaryDeep --> FullRotation: Full unlocked rotation, start 2% below saved tempo
    Focus --> Report: End Session
    Handoff --> Report: End Session / no future handoff starts
    Rebuild --> Report: End Session
    FullRotation --> Report: End Session
    Report --> [*]
```

| Boundary | Next audio rotation | Tempo | Advance visibility |
| --- | --- | --- | --- |
| Focus below75% | Same focus | Subtract ceil(BPM × 3 × bump%); minimum50 | Preparation bar names same key and changed BPM |
| Focus 75%–<95%, or missing score | Same focus | Hold | Preparation bar names same key |
| Focus ≥95%, performed below target | Same focus | Add ceil(BPM × bump%), at least1; cap at target | Preparation bar names same key and changed BPM |
| Focus ≥95%, performed at target | Repeat focus once; reserve queue head | Hold target | One preparation bar names repeat; reserved key appears underneath for the whole loop |
| Handoff loop ends, any score or missing score | Reserved key **first**, then previously admitted keys worst first | Hold | The promised chart becomes active on the audible downbeat |
| Rebuild has survivors | Survivors worst first | Hold target | Preparation names resolved head before playing |
| Rebuild clears | Repeat last-played key once; reserve queue head | Hold target | Preparation announces repeat; reserved chart below it |
| All keys admitted, survivors | Survivors worst first | Hold | Preparation names resolved head before playing |
| All keys admitted, full clear | Full currently unlocked circle worst first | Bump, maximum300 | Preparation names new head and BPM |

Example with target83 and default1% bump:

```mermaid
sequenceDiagram
    participant P as Player
    participant U as Chart
    participant E as Engine
    P->>E: Pass focus at 82
    E->>U: Same key, 83 BPM entrance cue
    Note over P,U: One unscored preparation bar
    E->>P: Play focus at 83
    P->>E: Pass focus at 83
    E->>U: Focus remains active, next key visible below
    E->>U: Focus once more, then next key
    Note over P,U: One preparation bar before the repeat
    E->>P: One more focus loop at 83
    Note over P,U: Full lick-length notice: focus once more, next key next
    P->>E: Finish repeat, even with a mistake
    E->>E: Persist actual result, honor reserved admission
    E->>U: Activate previewed key on audible downbeat
    E->>P: Continue with previewed key at 83
```

If that newly admitted key needs notation, its normal sheet-preparation rule still applies; the handoff does not remove support for unfamiliar material. An unopened queue key's preview is a chord chart, not early sheet music. Once the ramp completes, refill/reordering remains score-driven and gets the same preparation bar naming the resolved head. The upcoming cue during the last take says “then get ready”, without guessing an outcome.

## 5. Notation decision and learning substates

```mermaid
flowchart TD
    Build[Build next cycle] --> Legacy{Newest unlocked key AND fewer than 12 unlocked AND defined rolling below75?}
    Legacy -->|Yes| Reveal[Show notation for this cycle]
    Legacy -->|No| Deep{Deep Practice?}
    Deep -->|No| Memory[Chord chart only]
    Deep -->|Yes| One{Exactly one recorded attempt for key this session?}
    One -->|Yes and score below50| Reveal
    One -->|Yes and score at least50| Memory
    One -->|No| Two{Last two recorded attempts average below70?}
    Two -->|Yes| Reveal
    Two -->|No or no attempts| Memory
    Reveal --> Freeze[Freeze decision for whole cycle]
    Memory --> Freeze
    Freeze --> Prep{Revealed key in continuous mode?}
    Prep -->|No| Entrance{Head of score-dependent Deep cycle, or later sheet graduation?}
    Entrance -->|Yes| Ready[One preparation bar, name key and any memory change]
    Ready --> OnePass[One play window, C and R includes a call]
    Entrance -->|No| OnePass
    Prep -->|Yes| Daily{Daily session?}
    Daily -->|Yes| Three[Three consecutive play windows]
    Daily -->|No| Demo{Opening demo already prepares this key?}
    Demo -->|Yes| Three
    Demo -->|No| Pause[Two bars preparation then three windows]
    OnePass --> Final[Persist final attempt]
    Three --> Final
    Pause --> Final
    Final --> Build
```

The **handoff repeat** is a special case: one preparation bar announcing the extra repeat, then one play window. It does not repeat all three sheet rehearsals. Call-and-response retains its explicit call. The queued preview does not enter this cycle's audio, score windows, or key ring results.

Important boundaries:

- 50% exactly does not trigger the first-attempt rescue; 70% exactly does not trigger the two-attempt rescue. These use final recorded attempts, not rehearsal scores or EWMA.
- Rescue applies to any unlocked Deep key, including older keys and fully unlocked licks. Daily uses the legacy newest-key rule only.
- Sheet graduation is reevaluated at the next cycle: no legacy reveal and no rescue condition means return to the chord chart with an explicit “from memory” entrance cue and preparation time. A slight memory mistake does not automatically start another Listen phase in a recommended drill.
- In Deep and Focused sessions a sheet is engraved ahead, but remains hidden behind its chord-chart placeholder until that key becomes current, at the beginning of preparation. The next key is not illuminated as though already active.
- Daily shows upcoming notation immediately, without a chord placeholder or preparation pause. Deep and Focused retain the later reveal and taller sheet rows.
- A row remains current through any preparation and every pass. Previous-row feedback stays visible above it where the stack has room. Mixed sheet/chord row heights determine the viewport so beat dots are not clipped.

## 6. Musical cues, boundaries, and clocks

```mermaid
stateDiagram-v2
    [*] --> CountIn
    CountIn --> Listen: Demo or call starts
    Listen --> Play: User window opens
    Play --> Play: Announced adjacent key, rehearsal, or promised handoff exit
    Play --> Prepare: Score-dependent Deep result, retry, tempo step, or handoff entry
    Play --> Prepare: Non-Daily key has notation preparation
    Prepare --> Play: One result-preparation bar or two sheet-preparation bars finish
    Play --> Listen: Next C and R call, or ordinary Deep requests demo
    Play --> Transition: Daily rest or ordinary Deep turnaround
    Transition --> Listen: Next lick demo or call
    Transition --> Play: No-demo cycle
    Play --> Idle: Session ends
    Listen --> Idle: Session ends
    Prepare --> Idle: Session ends
    Transition --> Idle: Session ends
    Idle --> [*]
```

The phase timeline is derived from the very same window plan as recording. Consecutive play windows merge into one PLAY segment. Final four-beat entrance cues are for an actual return to playing, not every key boundary. Outside Daily, labels are Listen, Read (sheet preparation), Get ready (other preparation), Play, Rest, and “Straight in” for an unchanged transition directly to Play. The tab also names same-key repeats, sheet graduation, changed BPM and known next keys. Multi-pass rows name another same-key pass before the lower chart becomes next. Those detailed labels apply outside Daily. Daily shows plain Listen, key-free Play with only the pass number, and Rest; only the demo/call ending counts into Play. Daily never creates a Read segment.

| Session/mode | Opening | Between cycles/licks |
| --- | --- | --- |
| Daily continuous | One count-in bar, then one demo per lick | Two rest bars: score hold then next-lick lead |
| Daily call and response | One count-in bar, then per-key call | Same Daily rest, then next call |
| Recommended Deep continuous | One count-in bar and one opening demo | One embedded preparation bar for score-dependent outcomes, including post-ramp; two existing sheet bars absorb it. Promised handoff exits join directly |
| Ordinary Deep continuous | One count-in bar and opening demo | One turnaround bar; on non-clear cycles a head key below90%/unpracticed may get a demo |
| Deep call and response | One count-in bar; call before each response | Existing one-bar turnaround; calls remain intentional |
| Actually late focused callback | Opening unchanged | Recover at a future safe bar; cannot schedule audio into the past |

Scheduling and display must use different notions of “now.” Tone schedules sound ahead of the speaker's audible clock. **Audible timing rule for joined cycles:** prepare the next cycle's audio/windows during lookahead, but hold the current chart, key name, active row, beat position and cue until the new cycle's audible start tick. Commit all visual cycle data together. The recording ring also waits for the audible Play phase; arming capture during audio lookahead must not illuminate it during the last preparation beat. End Session clears any pending display so a scheduled handoff cannot reappear afterward.

```mermaid
sequenceDiagram
    participant T as Transport lookahead
    participant A as Audio and recording scheduler
    participant V as Pending visual cycle
    participant R as Animation frame / audible clock
    T->>A: Last window closes, compute next cycle
    A->>A: Schedule next backing and recording windows at boundary
    A->>V: Stage rows, preview, layout and cue timeline
    R->>V: Audible tick still before boundary
    V-->>R: Keep prior display, including final beat
    R->>V: Audible tick reaches boundary
    V-->>R: Activate next display atomically
    Note over A,R: Preparation vamp belongs to new cycle; recording opens after it
```

## 7. Persistence and terminal behavior

| Data | Daily | Recommended Deep |
| --- | --- | --- |
| Final-attempt score, rolling score, ≥90% pass count, recency | Persist | Persist, including handoff repeat's genuine result |
| Rehearsal-only score | Inline feedback only | Inline feedback only |
| Recording | Final pass only | Final pass only |
| Saved lick tempo | Adjust after completed lick | Unchanged by session ramp |
| Newly unlocked keys | Daily gate can unlock one | Never unlocked by lick Deep Practice |
| Session log/report | Upsert after attempts and final flush | Same; include round history and ramp milestones |
| Focus/rebuild/handoff strategy | Not applicable | Session-local; reset on restart/exit |
| Up-to-speed milestone | Not applicable | New behavior: actual target-tempo clear, not prospective bump |
| Rebuilt milestone | Not applicable | Round that actually admits final queued key |

Scoring/recording persistence failures are caught so one failed save cannot freeze the session's cycle boundary. A missing scored result is not a pass; it does not advance a focus staircase. The committed handoff is the deliberate exception: a missing or low final-repeat score does not cancel the already announced next key.

## Code map and regression obligations

| Concern | Source |
| --- | --- |
| Daily plan, session state, notation decisions, attempts and progress | `src/lib/state/lick-practice.svelte.ts` |
| Focus policy, pure cycle/window timing and playhead position | `src/lib/state/lick-practice-rotation.ts` |
| Cue timeline and user-facing cue labels | `src/lib/state/lick-practice-phase.ts` |
| Duration/count-in/rest constants | `src/lib/state/lick-practice-duration.ts` |
| Daily recommendation evidence/ranking | `src/lib/state/lick-practice-next-steps.ts` |
| Score thresholds, unlock and tempo persistence | `src/lib/persistence/lick-practice-store.ts` |
| Transport, mic windows, cycle boundary, display and report | `src/routes/lick-practice/session/+page.svelte` |
| Chart stack, notation visibility, compact cue and geometry | `src/lib/components/lick-practice/UpcomingKeysDisplay.svelte` |

Regression obligations: 82→83 alone before actual target clear; full-loop preview after clear; low/missing final-repeat score cannot revoke the promised key or change tempo; promised key starts first despite rolling-score reordering; later admissions receive the same preview; single-key licks need no preview; preview creates no audio/recording window; one preparation bar before a continuous handoff, no new demo; sheet graduation explicitly named; rehearsal repeats named before the lower chart; resolved retry/reorder/refill/tempo change gets preparation; promised admission adds no redundant gap; old chart survives lookahead through its final audible beat; End Session cancels staged display; Daily upcoming notation visible immediately in equal-height rows, key-free final-demo countdown only, no Daily Read segment or pause bars, accurate duration without those bars, three Daily passes retained; Deep rescue thresholds, preparation and persisted-tempo behavior remain intact.

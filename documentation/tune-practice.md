# Playing Over Tunes

Side A trains your ear. Side B drills a line into your fingers in all 12 keys. **Tune practice** is the third thing — the one that actually connects them: the rhythm section plays a real song form, and at every spot in that form where your vocabulary fits, the app hands you the space.

In **Suggest** and **Points** it scores what you play there. **Freestyle** drops the windows entirely — no scoring, just a solo the app listens to for licks it recognises.

Open any tune from your book and turn on **Lick Practice**.

## What the app is doing

Before the session starts, Mankunku reads the tune's changes and looks for **progressions it knows** — short ii-Vs (with their I, or without one: a half-bar ii-V that resolves somewhere unexpected is still a ii-V slot, and the lick's resolution falls on whatever comes next), long ii-Vs (major and minor), short and long turnarounds, short and long iii-VI-ii-V-Is, minor/major/dominant vamps, and blues. Each one it finds can become an **insertion point**: a window in the form, in a specific local key, where a lick tagged for that progression will land correctly.

So a tune in F that has a ii-V into Bb in bar 5 gives you an insertion point in Bb, and the app looks for licks that fit it: licks tagged for that progression, or whose category belongs to it. It knows which keys you've unlocked and which you've drilled, and ranks with that in mind — licks you've passed in that key first, then ones you're still learning there, then ones that would be new to you; within that, licks tagged for the progression and licks in your practice set come first. In **Suggest** mode it goes further and only names licks you already have in that key — played there, or unlocked there on Side B — at a practised tempo at or above the session's. It won't ask you to sight-transpose something you've never touched. (If nothing qualifies, the band on the chart names the progression instead, so you still know what you're blowing over.)

**Recognize harmony, then choose practice windows.** The analysis can retain overlapping readings: one chord may fit a major scale and also begin a cadence. Cornerstone progressions reserve their windows even when you have no ready lick for them. A competing major exercise stops at the cadence's opening chord, so adding a lick to your book does not change where the cadence starts.

**Major-scale regions** connect compatible changing chords in a local major key. They can suggest a major lick from your own book, rather than requiring a stationary major chord. The local key can differ from the tune's key signature. The app checks chord compatibility conservatively; an ambiguous or incompatible passage does not receive a forced major label. Named progressions and major regions use the same written-key labels in setup and during the session.

Within the available space, longer useful windows take precedence and shorter compatible chord windows fill gaps. A single-chord lick must fit within the chord's duration. All suggestions come from your own book: written, recorded or adopted licks, plus your practice set and practiced licks. Suggest mode still requires readiness in that key at the chosen tempo. If nothing is ready, the progression or harmonic-region band remains visible without a lick name. Windows and fallback suggestions stay inside the form actually played; they never extend into the returning head.

For the exact analysis rules and acceptance cases, see [Harmonic Analysis](https://github.com/avitus/mankunku/blob/main/documentation/architecture/harmonic-analysis.md).

The setup screen tells you what it found before you start: *"6 insertion points: 3× Short ii-V-I (Maj), 2× Long Turnaround, 1× Blues."* If it finds nothing it says so — you can still play along, but there'll be nothing scored.

It also warns you if licks in your book can't be suggested because they have no progression tag, with a link to go fix them.

### Tricks in the mix

Licks aren't the only thing that can fill a window. Any [trick](./tricks.md) variant you've **starred** — the *Suggest in tunes* toggle on its page — joins the suggestion list too, and gets scored on fluency rather than exact reproduction when you play it.

Where they can appear is deliberately narrow:

- Only over **vamps and ii-V-Is** (major and minor, short and long). Never over a turnaround, a iii-VI-ii-V-I, or a blues.
- **Ranked below** licks tagged for that progression, at the same level of mastery — a ii-V-I lick you've passed in that key is named ahead of a trick you've also passed there.
- **A device gets re-rooted onto the chord it belongs on.** The app looks through the progression for a full bar whose chord quality suits the variant — the triad-pair family, or the enclosure's chord type — so an altered pair lands on the V of a long ii-V-I rather than on the tonic. If nothing in the progression fits, that variant is quietly skipped. Enclosures play a compact two-bar version of their figure here, sized to the window.

A trick played here earns points and counts toward your take, but it writes **nothing** back to the trick: no passes, no key unlocks, no tempo. That's the drill's job.

## The setup screen

Set the **Tempo** dial, choose 1–12 **Choruses**, and switch **Head** and **Outro** independently. The **Backing track**, **Metronome**, and **Show key centers** switches sit above the chart. Open **Tune settings** to change the written key or backing style.

With **Lick Practice** on, the chart gains three practice controls.

| Control | What it does |
|---|---|
| **Mode** | Choose **Automatic licks** to practise suggested lines, **Play for points** to build a streak, or **Freestyle** to play freely through the changes. |
| **Chart cues** | Choose **Lick names**, **Progressions**, or **No cues**. Returning from Freestyle restores the selected cue level. |
| **Target lick** | In Points mode, choose a fitting lick to prioritise in compatible windows, or leave the default selection in place. |

The chart previews the first visit to each insertion point. Later choruses rotate eligible suggestions. Below the chart, the inventory lists fitting licks, their placements, and their readiness in the chosen key and tempo. On phones the chart engraves two bars per line.

Press **Play** beside the title to start the count-in. **Stop** ends the take and opens the report.

## The head rule

The default session is **head → solo choruses → head out**. Melody notation is shown for both heads. During solos, the chart switches to chord cells arranged in bars, using the same chord display as lick practice. The outro is not scored and never adds insertion windows. The pickup plays only on the way in, keeping every later return continuous from the last bar to bar 1.

Repeat markers determine which bars belong to each pass:

- If the chart's repeat markers outline the whole form — a repeat that runs the body twice with only a short tail afterwards, a second ending or a coda shorter than the pass it follows — the app treats **pass one as the opening head and pass two as your solo form**. The closing head follows the final pass, including its second ending.
- If the chart has no whole-form repeat, the app appends a second chorus of the changes for you to play over.
- An *internal* repeat is just a section played twice, not a form outline — `|: A :| B A` inside an AABA chart, or `|: A :| B` where the B after the repeat is as long as the A inside it (Autumn Leaves' 8-bar repeat under a 16-bar B). Those charts play the head through the whole form and then get an appended solo chorus.

Turn both **Head** and **Outro** off and you go straight to the changes, finishing after the last solo chorus.

## The three modes

### Suggest — cued practice

The top-ranked lick is **named on the chart** at every insertion point, ahead of time. Your job is to have it ready and play it when the band gets there. Across a session the app rotates through your eligible licks for each progression type rather than naming the same favourite every time, so a tune with four ii-Vs drills four different lines.

This is the mode to start in. It turns a tune into a set of prompts.

### Points — pick your lick and connect them

You choose which lick to play at the next window from a **Pick your lick** card — the five best-ranked candidates for it, each with the key you'll play it in and a badge: *Known* (you've passed it in that key), *Learning* (attempted there, or the key is unlocked but unplayed) or *New*. Points mode doesn't filter by readiness the way Suggest does, so a lick from your book that you haven't played in that key can turn up, badged *New*. Pick before the window opens; if you don't, the top one is scored. Then you earn points for how well you play it: **your score out of 100**, straight. The twist is the **connection bonus** — clear the pass bar (90%) on two windows *back to back* and the second one scores **double**.

That rewards the thing that's actually hard: not playing one good lick, but coming out of one and being ready for the next. The header keeps your running total, with the streak and a 🔥 once two in a row have landed (*240 pts · 3🔥*). The pick card belongs to Points at the Guided level: at Standard and Solo the chart never names a lick, so there is nothing to pick and any of your licks that fits the spot is scored. It also waits for the solo chorus — while the head plays there is nothing to pick yet, so the card for the first window appears when the melody ends, and the top-ranked lick stands if you leave it.

### Freestyle — take a solo

No cues, no windows, no scoring. The rhythm section plays the form and you blow over it. What the app does is **listen for licks it recognises**: whenever something you play matches a line from your book closely enough to be a genuine quote — not "reminiscent of", an actual match — a 👏 card pops up with the lick's name and how close the match was, and the status line keeps count (*Your solo — 3 known licks heard*).

The recognition pool is deliberately narrow: licks in your practice set, licks you have practice history on, and licks you wrote, recorded, or adopted. It won't celebrate a curated lick you've never seen — that would be noise, not feedback.

At the end you get a list of everything it heard, with the bar it landed in.

## Strictness

Strictness changes what the chart *tells* you about each insertion point. It never changes how the app listens or the grading scale: every level scores any octave, because nothing is demonstrated in tune practice, so there is no register to match, and moving a lick an octave to keep it on the horn is legitimate. The same score means the same thing at every level.

| Level | The band over each insertion point | What counts |
|---|---|---|
| **Guided** | Names the lick to play, ahead of time; the Points pick card | That lick |
| **Standard** | Names only the progression — a ii-V, a turnaround | Any of your licks that fits the spot: the take is scored against each and the best match is your result |
| **Solo** | Nothing — the bands are still drawn, unlabelled | Any of your licks that fits, as in Standard |

Guided is the app telling you what to play. Standard tells you what you're playing *over* and leaves the vocabulary to you. Solo tells you nothing: you have to hear the spot coming. All three listen identically — the same pipeline, the same pass bar.

On the bleed filter: it's on at every level, which is the forgiving choice if you practise on speakers. On headphones there's no bleed to filter.

## During the session

- **The drummer counts you in.** One bar on the cross-stick, every beat; above 150 BPM, two bars in the jazz count-off rhythm — two clicks on beats 1 and 3, then four on every beat of the second bar (a waltz: the downbeat, then one-two-three). No voice, only the stick. The drum kit loads with the band, so if it hasn't loaded (or failed to), the metronome's count-in bar counts you in instead (if the metronome is on). When the band is playing, the count replaces the metronome's count-in bar; with the band off and the metronome on, the click keeps time underneath the count. When the head opens on a **pickup**, the count runs on through the pickup bar, because the band only comes in after it: Black Orpheus's one-beat pickup gets beats 1 and 3, then every beat of the pickup bar, the pickup note landing on the 4. The playhead waits for the pickup's first printed beat rather than lighting it on beat 1 of its bar.
- The chart **follows the playhead** teleprompter-style — it slides inside its own frame rather than scrolling the page, so the status line and the pick card stay put — and the current bar is marked on it.
- Insertion points show as **coloured bands** on the chart, each in its progression's identity colour — the same colour that progression carries on your lick cards and in Side B's session header. A ii-V looks like a ii-V wherever you meet it; a single-chord lick's window looks like its chord (Minor, Major, Dominant; a half-diminished slot keeps its cadence's colour and is labelled *Diminished*). A band clears a bar after its window has passed, so the chart ahead of you stays clean; a later pass through the same bars labels it again.
- **Nothing prompts for a lick while the head or outro plays.** The melody sheet carries only the playhead — no bands, no lick names, no pick card — through the count-in, opening head and closing head; the solo choruses show the chord-bar grid and lick cues. A session without a head shows them from the count-in.
- The status line under the title tells you where you are: *Count-in…*, *Head — melody once through, then it's yours* (Head in red — you're listening), *Comping — insertion 3 of 6 coming up*, and then **Your turn — play the lick!** in brass when a window opens.
- The header also keeps the time elapsed and, in Points mode, your score; the **Stop** button stops the take whenever you want.

### The band plays the full jam

This is the only place the rhythm section gets to hear a *form*, and it uses it. Things you'll hear here and nowhere else in the app:

- **Crashes on section arrivals** — and about a third of the time the crash arrives *early*, on the and-of-4 of the previous bar, with the kick underneath it. That's the push a big-band drummer plays into a new section. When the crash doesn't fire, you'll sometimes get a ride-bell accent on the downbeat instead.
- **Setup figures on the last bar of a section** — snare triplets into the barline, the hard-bop hand-to-foot triplet, a ride-and-kick lean.
- **The long fill over a chorus turn** — a two-beat build rolling across the barline into the next chorus, with the downbeat crash landing on top of it.
- **The band builds.** The ensemble digs in over the first three choruses and then holds: the ride gets busier, the kick stops sitting out bars, the comping instrument plays denser figures in a higher register and takes fewer rests. Ballads are capped — they never dig in past the middle of that range.

None of this happens in Lick Practice, because a two-bar vamp has no form to mark.

## The report

**Take complete** in Suggest and Points compares your solo choruses beneath the tune's changes. Each insertion keeps its outcome symbol: **✓ Landed**, **× Unsuccessful**, or **○ Missed opening**. Unreached windows show **No take**; spots without a fitting lick show **No matching lick**.

Score colors use the same accuracy scale as Lick Practice: gold at 95% and above, silver at 85–94%, bronze at 70–84%, teal at 55–69%, and deep teal below 55%. Colors follow the original score before the displayed percentage is rounded. Unscored spots stay neutral, and a brass border marks your selection independently of its score.

Select a spot to compare its results across choruses. **Needs work** focuses on spots whose latest completed attempt was unsuccessful or missed. **Practice this spot** adds the selection to a retry queue; the footer starts practice for the selected spots, keeping the full tune backing. Points mode also shows your total and best streak. **Practice again** returns to setup; **Back to tune** takes you out.

Freestyle has no insertion points to report, so its take instead lists every lick the app recognised, with the bar it landed in and how close the match was.

Tune-practice takes are **not written into your progress history**. They don't move your adaptive level, don't touch per-lick key scores, and don't affect Side B unlocks. This is deliberate: this is the applying-it room, not the drilling room. Your streak and your levels come from the drilling rooms — Side A, Side B and Tricks.

## How to use it

- **Learn the tune first.** Read the head, hit Play on the tune page to hear the melody a few times, get the form in your ear. Practising licks over changes you can't hear is just typing.
- **Start in Suggest / Guided.** Let the app tell you what fits where. You'll notice quickly which spots you have vocabulary for and which you don't.
- **Move to Points when the spots stop surprising you.** The connection bonus is the honest test of whether the vocabulary is really available to you.
- **Finish in Freestyle.** Play the tune for real, and see which of your lines actually came out. What the app recognises is what you own.
- **Let it point you back to Side B.** An insertion point you keep fumbling is a lick that needs more key work — go drill it, then come back.

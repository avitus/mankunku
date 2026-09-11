# Playing Over Tunes

Side A trains your ear. Side B drills a line into your fingers in all 12 keys. **Tune practice** is the third thing — the one that actually connects them: the rhythm section plays a real song form, and at every spot in that form where your vocabulary fits, the app hands you the space.

In **Suggest** and **Points** it scores what you play there. **Freestyle** drops the windows entirely — no scoring, just a solo the app listens to for licks it recognises.

Open any tune from your book and hit **Practice licks**.

## What the app is doing

Before the session starts, Mankunku reads the tune's changes and looks for **progressions it knows** — short ii-Vs, long ii-Vs (major and minor), turnarounds, iii-VI-ii-V-I, minor/major/dominant vamps, and blues. Each one it finds becomes an **insertion point**: a window in the form, in a specific local key, where a lick tagged for that progression will land correctly.

So a tune in F that has a ii-V into Bb in bar 5 gives you an insertion point in Bb, and the app looks for licks that fit it: licks tagged for that progression, or whose category belongs to it. It knows which keys you've unlocked and which you've drilled, and ranks with that in mind — licks you've passed in that key first, then ones you're still learning there, then ones that would be new to you; within that, licks tagged for the progression and licks in your practice set come first. In **Suggest** mode it goes further and only names licks you already have in that key — played there, or unlocked there on Side B — at a practised tempo at or above the session's. It won't ask you to sight-transpose something you've never touched. (If nothing qualifies, the band on the chart names the progression instead, so you still know what you're blowing over.)

The setup screen tells you what it found before you start: *"6 insertion points: 3× Short ii-V-I (Maj), 2× Turnaround, 1× Blues."* If it finds nothing it says so — you can still play along, but there'll be nothing scored.

It also warns you if licks in your book can't be suggested because they have no progression tag, with a link to go fix them.

### Tricks in the mix

Licks aren't the only thing that can fill a window. Any [trick](./tricks.md) variant you've **starred** — the *Suggest in tunes* toggle on its page — joins the suggestion list too, and gets scored on fluency rather than exact reproduction when you play it.

Where they can appear is deliberately narrow:

- Only over **vamps and ii-V-Is** (major and minor, short and long). Never over a turnaround, a iii-VI-ii-V-I, or a blues.
- **Ranked below** licks tagged for that progression, at the same level of mastery — a ii-V-I lick you've passed in that key is named ahead of a trick you've also passed there.
- **A device gets re-rooted onto the chord it belongs on.** The app looks through the progression for a full bar whose chord quality suits the variant — the triad-pair family, or the enclosure's chord type — so an altered pair lands on the V of a long ii-V-I rather than on the tonic. If nothing in the progression fits, that variant is quietly skipped. Enclosures play a compact two-bar version of their figure here, sized to the window.

A trick played here earns points and counts toward your take, but it writes **nothing** back to the trick: no passes, no key unlocks, no tempo. That's the drill's job.

## The setup screen

Under a link back to the tune, the page is headed **Practice licks**, with a line on what's about to happen, a *How this works* link that runs the guided tour, and a docs link. Everything you set lives in one **Session** card, built from the same selector pads, rocker switch and knob as the [settings page](./user-guide.md#settings) — most labels carry a short explanation on hover:

| Control | What it does |
|---|---|
| **Mode** | *Suggest* — lick named for you; *Points* — you pick, streaks double; *Freestyle* — backing only, just solo. See [the three modes](#the-three-modes). Starts on Suggest. |
| **Strictness** | *Guided* — names the lick to play; *Standard* — names only the progression; *Solo* — no cues. How much the chart tells you about each insertion point — see [Strictness](#strictness). Starts on Standard. |
| **Head** | A rocker switch. ON plays the melody once through before your chorus ([the head rule](#the-head-rule)); OFF goes straight to the changes. On a chart with no melody it reads OFF and can't be switched on — there's no head to play. |
| **Key** | Twelve pads in your written pitch: the key the tune is played and charted in for this session. It starts in the tune's own key. |
| **Tempo** | A knob, 50–240 BPM in steps of 5 — drag, scroll, or use the arrow keys. It starts at your Settings tempo. In Suggest mode it also decides which licks can be named: only ones you already practise at this speed or faster. |
| **Backing** | Swing, Bossa Nova, Ballad, or Straight — see [The band](./user-guide.md#the-band). |

At the foot of the card, a readout says what the detector found (*6 insertion points: …*, or that there are none), with the warning about untagged licks under it when there are any.

Below the card sits **Start** — it reads *Setting up…* while the instrument loads — with a caption that says how the take will open: *Head first, then the chart clears for your licks*, *Straight to the changes*, or, on a chords-only chart, *This chart has no melody — straight to the changes*. If the microphone is refused you'll see *Microphone unavailable — check permissions and try again*; if the sounds fail to load, *Audio setup failed — check your connection and try again*.

Under that, the chart previews in the chosen key with the insertion points shaded in their progression colours, so you can see where in the form you'll be playing before you commit.

## The head rule

Jazz plays the head **once**, then everybody solos. The app follows that rule literally.

- If the chart's repeat markers outline the whole form — a repeat that runs the body twice with only a second ending or coda afterwards — the app treats **pass one as the head and pass two as your chorus**. The melody prints and plays on the first pass; on the second the staff clears and it's your turn over the same changes.
- If the chart has no whole-form repeat, the app appends a second chorus of the changes for you to play over.
- An *internal* repeat (say `|: A :| B A` inside an AABA chart) is just a section played twice, not a form outline — those charts play the head through the whole form and then get an appended solo chorus.

Turn **Head** off and you go straight to the changes.

## The three modes

### Suggest — cued practice

The top-ranked lick is **named on the chart** at every insertion point, ahead of time. Your job is to have it ready and play it when the band gets there. Across a session the app rotates through your eligible licks for each progression type rather than naming the same favourite every time, so a tune with four ii-Vs drills four different lines.

This is the mode to start in. It turns a tune into a set of prompts.

### Points — pick your lick and connect them

You choose which lick to play at the next window from a **Pick your lick** card — the five best-ranked candidates for it, each with the key you'll play it in and a badge: *Known* (you've passed it in that key), *Learning* (attempted there, or the key is unlocked but unplayed) or *New*. Points mode doesn't filter the way Suggest does, so new material can turn up. Pick before the window opens; if you don't, the top one is scored. Then you earn points for how well you play it: **your score out of 100**, straight. The twist is the **connection bonus** — clear the pass bar (90%) on two windows *back to back* and the second one scores **double**.

That rewards the thing that's actually hard: not playing one good lick, but coming out of one and being ready for the next. The header keeps your running total, with the streak and a 🔥 once two in a row have landed (*240 pts · 3🔥*). The pick card belongs to Guided: at Standard and Solo the chart never names a lick, so there is nothing to pick and any of your licks that fits the spot is scored.

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

- The chart **follows the playhead** teleprompter-style — it slides inside its own frame rather than scrolling the page, so the status line and the pick card stay put — and the current bar is marked on it.
- Insertion points show as **coloured bands** on the chart, each in its progression's identity colour — the same colour that progression carries on your lick cards and in Side B's session header. A ii-V looks like a ii-V wherever you meet it. A band clears a bar after its window has passed, so the chart ahead of you stays clean; a later pass through the same bars labels it again.
- The status line under the title tells you where you are: *Count-in…*, *Head — melody once through, then it's yours* (Head in red — you're listening), *Comping — insertion 3 of 6 coming up*, and then **Your turn — play the lick!** in brass when a window opens.
- The header also keeps the time elapsed and, in Points mode, your score; the **End** button stops the take whenever you want.

### The band plays the form, not a loop

This is the only place the rhythm section gets to hear a *form*, and it uses it. Things you'll hear here and nowhere else in the app:

- **Crashes on section arrivals** — and about a third of the time the crash arrives *early*, on the and-of-4 of the previous bar, with the kick underneath it. That's the push a big-band drummer plays into a new section. When the crash doesn't fire, you'll sometimes get a ride-bell accent on the downbeat instead.
- **Setup figures on the last bar of a section** — snare triplets into the barline, the hard-bop hand-to-foot triplet, a ride-and-kick lean.
- **The long fill over a chorus turn** — a two-beat build rolling across the barline into the next chorus, with the downbeat crash landing on top of it.
- **The band builds.** The ensemble digs in over the first three choruses and then holds: the ride gets busier, the kick stops sitting out bars, the comping instrument plays denser figures in a higher register and takes fewer rests. Ballads are capped — they never dig in past the middle of that range.

None of this happens in Lick Practice, because a two-bar vamp has no form to mark.

## The report

**Take complete** in Suggest and Points opens with how many of the insertion points you hit, then lists every one in the form: the bar it started in, the local key (in your written pitch), the progression, the lick that was scored, and the grade. Windows where you didn't play read **No take** — a skip, not a failure. Points mode adds the total and your best streak. **Practice again** returns you to the setup screen; **Back to tune** takes you out.

Freestyle has no insertion points to report, so its take instead lists every lick the app recognised, with the bar it landed in and how close the match was.

Tune-practice takes are **not written into your progress history**. They don't move your adaptive level, don't touch per-lick key scores, and don't affect Side B unlocks. This is deliberate: this is the applying-it room, not the drilling room. Your streak and your levels come from the drilling rooms — Side A, Side B and Tricks.

## How to use it

- **Learn the tune first.** Read the head, hit Play on the tune page to hear the melody a few times, get the form in your ear. Practising licks over changes you can't hear is just typing.
- **Start in Suggest / Guided.** Let the app tell you what fits where. You'll notice quickly which spots you have vocabulary for and which you don't.
- **Move to Points when the spots stop surprising you.** The connection bonus is the honest test of whether the vocabulary is really available to you.
- **Finish in Freestyle.** Play the tune for real, and see which of your lines actually came out. What the app recognises is what you own.
- **Let it point you back to Side B.** An insertion point you keep fumbling is a lick that needs more key work — go drill it, then come back.

# Playing Over Tunes

Side A trains your ear. Side B drills a line into your fingers in all 12 keys. **Tune practice** is the third thing — the one that actually connects them: the rhythm section plays a real song form, and at every spot in that form where your vocabulary fits, the app hands you the space.

In **Suggest** and **Points** it scores what you play there. **Freestyle** drops the windows entirely — no scoring, just a solo the app listens to for licks it recognises.

Open any tune from your book and hit **Practice licks**.

## What the app is doing

Before the session starts, Mankunku reads the tune's changes and looks for **progressions it knows** — short ii-Vs, long ii-Vs (major and minor), turnarounds, iii-VI-ii-V-I, minor/major/dominant vamps, and blues. Each one it finds becomes an **insertion point**: a window in the form, in a specific local key, where a lick tagged for that progression will land correctly.

So a tune in F that has a ii-V into Bb in bar 5 gives you an insertion point in Bb — and the app suggests licks from *your* practice set that you've already earned in Bb. It knows which keys you've unlocked and which you've drilled; suggestions are ranked with that mastery in mind, so it isn't asking you to sight-transpose something you've never played.

The setup screen tells you what it found before you start: *"6 insertion points: 3× Short ii-V-I (Maj), 2× Turnaround, 1× Blues."* If it finds nothing it says so — you can still play along, but there'll be nothing scored.

It also warns you if licks in your book can't be suggested because they have no progression tag, with a link to go fix them.

### Tricks in the mix

Licks aren't the only thing that can fill a window. Any [trick](./tricks.md) variant you've **starred** — the *Suggest in tunes* toggle on its page — joins the suggestion list too, and gets scored on fluency rather than exact reproduction when you play it.

Where they can appear is deliberately narrow:

- Only over **vamps and ii-V-Is** (major and minor, short and long). Never over a turnaround, a iii-VI-ii-V-I, or a blues.
- Always **ranked below** licks written for that progression, so a real ii-V-I lick is named first.
- **Triad pairs get re-rooted onto the chord they belong on.** The app looks through the progression for a full bar whose chord quality suits the pair — so an altered pair lands on the V of a long ii-V-I rather than on the tonic. If nothing in the progression fits, that pair is quietly skipped.

A trick played here earns points and counts toward your take, but it writes **nothing** back to the trick: no passes, no key unlocks, no tempo. That's the drill's job.

## The setup screen

| Setting | What it does |
|---|---|
| **Mode** | Suggest, Points, or Freestyle — see below. |
| **Strictness** | Guided, Standard, or Solo. Controls how much the app tells you and how strictly it listens. |
| **Head** | Play the melody once through before the practice chorus. Greyed out on charts with no melody. |
| **Key** | The written key you want to read the chart in. |
| **Tempo** | 50–240 BPM. |
| **Backing** | Swing, Bossa Nova, Ballad, or Straight — see [The band](./user-guide.md#the-band). |

Below the settings, the chart previews with the insertion points shaded in, so you can see where in the form you'll be playing before you commit.

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

You choose which lick to play at the next window from a pick card, then earn points for how well you play it: **your score out of 100**, straight. The twist is the **connection bonus** — clear the pass bar (90%) on two windows *back to back* and the second one scores **double**.

That rewards the thing that's actually hard: not playing one good lick, but coming out of one and being ready for the next. A running streak counter sits in the header with a 🔥 when it's live.

### Freestyle — take a solo

No cues, no windows, no scoring. The rhythm section plays the form and you blow over it. What the app does is **listen for licks it recognises**: whenever something you play matches a line from your book closely enough to be a genuine quote — not "reminiscent of", an actual match — you get applause and the lick's name on screen.

The recognition pool is deliberately narrow: licks in your practice set, licks you have practice history on, and licks you wrote, recorded, or adopted. It won't celebrate a curated lick you've never seen — that would be noise, not feedback.

At the end you get a list of everything it heard, with the bar it landed in.

## Strictness

Strictness changes what the app *shows* you and how strictly it *listens*. It never changes the grading scale — the same score means the same thing at every level.

| Level | Cues | Listening |
|---|---|---|
| **Guided** | Full — every insertion point labelled ahead of time | Octave-insensitive; bleed filter forced on |
| **Standard** | Reduced — cues appear on approach | Octave-insensitive; bleed filter forced on |
| **Solo** | None | Exact register required; bleed filter follows the app-wide setting (off by default) |

Guided and Standard match how continuous Side B sessions listen. Solo matches call-and-response strictness: play it in the right octave or it doesn't count.

On the bleed filter: Guided and Standard switch it on regardless, which is the forgiving choice if you practise on speakers. Solo defers to the internal app-wide flag, which is off unless changed — there is no user-facing control for it. Either way it only matters on speakers; on headphones there's no bleed to filter.

## During the session

- The chart **follows the playhead** teleprompter-style — it slides inside its own frame rather than scrolling the page, so the status line and the pick card stay put.
- Insertion points show as **coloured bands** on the chart, each in its progression's identity colour — the same colour that progression carries on your lick cards and in Side B's session header. A ii-V looks like a ii-V wherever you meet it.
- The status line tells you where you are: *Count-in…*, *Head — melody once through, then it's yours*, *Comping — insertion 3 of 6 coming up*, and then **Your turn — play the lick!** when a window opens.
- The **End** button stops the take whenever you want.

### The band plays the form, not a loop

This is the only place the rhythm section gets to hear a *form*, and it uses it. Things you'll hear here and nowhere else in the app:

- **Crashes on section arrivals** — and about a third of the time the crash arrives *early*, on the and-of-4 of the previous bar, with the kick underneath it. That's the push a big-band drummer plays into a new section. When the crash doesn't fire, you'll sometimes get a ride-bell accent on the downbeat instead.
- **Setup figures on the last bar of a section** — snare triplets into the barline, the hard-bop hand-to-foot triplet, a ride-and-kick lean.
- **The long fill over a chorus turn** — a two-beat build rolling across the barline into the next chorus, with the downbeat crash landing on top of it.
- **The band builds.** The ensemble digs in over the first three choruses and then holds: the ride gets busier, the kick stops sitting out bars, the comping instrument plays denser figures in a higher register and takes fewer rests. Ballads are capped — they never dig in past the middle of that range.

None of this happens in Lick Practice, because a two-bar vamp has no form to mark.

## The report

**Take complete** in Suggest and Points lists every insertion point in the form: the bar it started in, the local key (in your written pitch), the progression, the lick that was scored, and the grade. Windows where you didn't play read **No take** — a skip, not a failure. Points mode adds the total and your best streak.

Freestyle has no insertion points to report, so its take instead lists every lick the app recognised, with the bar it landed in and how close the match was.

Tune-practice takes are **not written into your progress history**. They don't move your adaptive level, don't touch per-lick key scores, and don't affect Side B unlocks. This is deliberate: this is the applying-it room, not the drilling room. Your streak and your levels come from Side A and Side B.

## How to use it

- **Learn the tune first.** Read the head, hit Play on the tune page a few times, get the form in your ear. Practising licks over changes you can't hear is just typing.
- **Start in Suggest / Guided.** Let the app tell you what fits where. You'll notice quickly which spots you have vocabulary for and which you don't.
- **Move to Points when the spots stop surprising you.** The connection bonus is the honest test of whether the vocabulary is really available to you.
- **Finish in Freestyle.** Play the tune for real, and see which of your lines actually came out. What the app recognises is what you own.
- **Let it point you back to Side B.** An insertion point you keep fumbling is a lick that needs more key work — go drill it, then come back.

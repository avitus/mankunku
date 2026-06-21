# How to Practice

Mankunku is a call-and-response app. The app plays you a phrase; you play it back; it scores your accuracy and either moves you on or hands you a retry. Around that loop are two main practice modes (Side A and Side B), a library, and a progress dashboard.

This page walks through the practice flow as it actually feels in the room — what to listen for, what to do with your horn in your hands, what each setting changes.

## The dashboard

When you open the app you land on the home page. It's the front cover of the LP. From here you can:

- Jump straight into **Side A** (Ear Training) or **Side B** (Lick Practice).
- See your **streak** — consecutive days you've practiced. Skip a day and it resets to 1; the longest streak you've ever held is preserved separately.
- See **today's key** — the key + scale rotating today. You can override this in Side A's settings.
- See your current **level** (1–100) on the active scale, plus the count of licks you've **tagged** for Side B.

If today is your first day, you won't have a streak or a level yet. Hit Side A and start.

## Side A — Ear Training

This is the call-and-response loop.

### The flow, beat by beat

1. **Pick up your horn.** Make sure the mic is hot — the bottom of the screen shows a green indicator and an input level meter when it's getting signal.
2. **Press play.** The app plays a phrase through your speakers (or headphones), with a metronome ticking underneath. Sheet music for the phrase appears above the transport bar, written in your instrument's key.
3. **Listen all the way through.** Don't start playing along. The phrase usually sits inside one or two bars; let the whole thing land in your ear before you reach for it.
4. **Play it back.** When the phrase finishes, the metronome keeps going so you have a beat to lean on. Play the phrase as you heard it. The app starts recording the moment your first note registers.
5. **Stop playing.** After about two seconds of silence, the app decides you're done.
6. **Read the score.** A grade lands on the screen — Perfect, Great, Good, Fair, or Try Again — with a per-note table showing which notes you got and how close your timing was. A liner-note caption underneath quotes the giants ("right in the pocket," "cookin'," "take it again from the top," and so on).
7. **Move on, or retry.** Above 70% counts as a pass: hit play and you'll get a new phrase. Below that, the same phrase replays so you can take another swing.

### What you can change in Side A settings

| Setting | What it does |
|---|---|
| **Daily Tonality** | Lock in today's key + scale, or override to any *unlocked* key + scale combination. Locked tonalities show a lock icon with the proficiency they require. The "Reset to daily" button restores the automatic pick. |
| **Category** | Filter the lick pool to one harmonic context — ii-V-I major, blues, bebop lines, ballad, and so on. Or leave it on "all" and let the app rotate. |
| **Difficulty** | 1–100, displayed as ten bands from Beginner to Virtuoso. Set it to a fixed value, or let the adaptive system steer. |
| **Tempo** | 40–300 BPM. Most players start in the 80–110 range. |
| **Source** | Curated (hand-written and combinatorial library), Generated (algorithmic, infinite variety), or Mixed. |
| **Bars** | 1–4 bars, applies only to generated phrases. |
| **Metronome** | On/off, plus a swing slider. Rhythm is 40% of your score, so practicing with the click on is usually the right move. |

### What's on screen while you're playing

- The **pitch meter** shows the note you're holding right now, how many cents flat or sharp, and a clarity dot that tells you the detector is locked on. If the dot's dim or jumping, your mic isn't picking up a clean signal — get closer to the bell, or check the room noise.
- The **mic status bar** shows input level. Stay out of the red.
- The **status text** tells you what to do: *Listen* while the phrase plays; *Your turn* once it ends; *Listening* once your first note hits and recording starts.

### Scale-aware filtering

Not every lick fits every scale. A 7-note major lick squashed into a 5-note pentatonic session would lose two of its notes and stop sounding like itself, so the app filters: in a pentatonic session you only see pentatonic licks; in a Lydian session you see Lydian-compatible licks; and so on. The note count for the active scale shows up in the header (e.g. "5 notes" for pentatonic, "7 notes" for major) so you know what palette you're drawing from.

If filtering would leave you with too few licks at your difficulty, the app widens to all licks at that difficulty — better to practice something than nothing.

## Side B — Lick Practice

This is the 12-key drill. It picks a lick from your **tagged** collection and runs it through every key over a backing track, scoring each pass.

### Setting it up

Before your first session, go to the **Library** and tap the star on a few licks you want to drill. Tagged licks become your Side B practice book. Each tagged lick also needs at least one **progression tag** (`prog:*`) — those are added automatically when the lick's category matches a progression (a ii-V-I lick gets `prog:ii-V-I-major`), and you can add or remove them by hand from the lick's detail page to drill the same line over a different progression.

When you open Side B, you choose:

- **Progression type** — what the backing track plays underneath. ii-V-I major or minor, dominant or major vamp, turnaround, rhythm changes, blues. Each lick's category determines which progressions it lands cleanly on by default.
- **Substitutions** — toggle to introduce tritone subs and chromatic approaches. Same lick, harder harmony.
- **Backing style** — swing for straight-ahead, bossa for Latin, ballad for slow with sustained comping, straight for rock/funk feel.
- **Practice mode** — *Continuous* plays the lick once as a demo in the first key, then you play it through all 12 keys back-to-back over a non-stop backing track. *Call & Response* skips the upfront demo and instead, in every key, the app plays the lick first and you echo it on the next cycle, alternating through all 12 keys. Both modes score every key the user plays.
- **Tempo** — starting BPM for this lick. After each lick, the tempo adjusts based on your average score across that lick's keys: +5 BPM at 95%+, +2 BPM at 85%+, -1 BPM at 70%+, and -3 BPM below.

Two start buttons sit at the bottom of the setup screen:

- **Start Session** runs licks tagged for the progression you picked above. It's the right choice when you want focused work on one harmonic context.
- **Start Daily Practice** ignores the picked progression and rotates across every progression you've tagged licks for, fitting the session into the same time budget. Each lick gets paired with whichever of its eligible progressions you've practiced least recently. Use it as your default daily warm-up so every line gets time on the clock.

### What happens during a session

The session opens with a **count-in**, then the backing track starts. You see:

- The current **lick name** and the **key** you're playing it in.
- A **chord chart** above the staff showing the progression cycle, with the active cell highlighted as the bars roll.
- A **key progress ring** showing how far you are through this lick's currently-unlocked keys.
- A **preview strip** of the next two or three keys coming up.
- A **session timer** with a progress bar.

You play the lick once per key, with no retries. After all of that lick's keys play through, two things happen:

1. **Tempo adjusts** based on your average score for the lick: +5 BPM at 95%+, +2 BPM at 85%+, -1 BPM at 70%+, and -3 BPM below.
2. **The next key may unlock.** New keys earn their way into the rotation only when both your average score is at least 90% *and* the most-recently-added key has been passed cleanly twice (≥ 80% per attempt). Tempo can keep climbing without the rotation growing — so you'll often speed up on the keys you have before the next one appears.

Once the session has cycled through every currently-unlocked key for the current lick, it moves to the next tagged lick. The session ends when the time budget runs out or every lick has had its turn.

### Why gradual unlocks

The 12-key cycle is the goal, not the start. A brand-new lick starts with just **one** key — its home key — and earns each next key in easiest-to-hardest order by accidental count, alternating sharps and flats from home. From C, that's: C, G (1♯), F (1♭), D (2♯), Bb (2♭), A (3♯), Eb (3♭), E (4♯), Ab (4♭), B (5♯), Db (5♭), F♯/G♭ (6). For other home keys, the same principle applies relative to the entry key.

This means new vocabulary stays musical from day one: you're consolidating the shapes that matter most before the rotation grows, and by the time you reach the trickiest keys you've already heard the line in every easier one.

### Why all 12 keys

The shortest answer: every jazz player you admire could play their vocabulary in any key. Coltrane drilled patterns through every key before recording *Giant Steps*. Practicing only in the comfortable keys means your fingers have memorized one shape; practicing in all 12 means you've actually heard the line.

The longer answer is in [The Daily Key](./architecture/tonality-system.md).

## The library

Every lick the app knows lives in the **Library**. About 250 of them — 163 hand-written and a few dozen generated by pairing scale patterns with rhythm templates — across nine categories. Plus your own user-recorded and step-entered licks, and any community-shared licks you've adopted.

### Browsing

- **Search** filters by name or tag.
- **Category** pills filter by harmonic context: Beginner Cells, ii-V-I Major, ii-V-I Minor, Blues, Bebop Lines, Pentatonic, Modal, Rhythm Changes, Ballad.
- **Difficulty** filter narrows to a band (Beginner, Easy, Medium, Hard, etc.).

### Lick detail

Tap a lick to see:

- Sheet music in your instrument's key.
- A **key selector** so you can preview the lick in any of the 12 keys before tagging it.
- Category, difficulty, bar count, and tags.
- A play button so you can hear it without dropping into a session.
- A **practice star** — tap to tag the lick for Side B.

## Progress

The Progress page is the back cover. It tells you what's been happening over time.

- **Calendar heatmap** — every day you practiced, lit by session count. Skipped days are dim.
- **Trend chart** — pitch complexity, rhythm complexity, and the resulting overall level, plotted over the rolling window.
- **Streak** — consecutive practice days, plus your longest run.
- **Category and key bars** — your average score per category and per key, so you can see which keys still need work.
- **Recent sessions** — last few attempts with phrase, key, tempo, score, and grade.

## Settings

The global Settings page controls things that aren't specific to a single session.

| Setting | What it does |
|---|---|
| **Instrument** | Soprano sax, tenor sax, alto sax, or trumpet. Affects transposition (sheet music in your key), playback timbre, and the pitch range the detector expects. |
| **Theme** | Dark (default) or light. |
| **Default tempo** | Starting BPM for new ear-training sessions. |
| **Metronome volume** and **swing** | The click's loudness and feel. Swing 0.5 is straight; 0.67 is triplet swing (most common); 0.8 is heavy. |
| **Bleed filter** | If your speakers are loud enough that the mic re-hears the playback, this drops the spurious notes. Leave it on unless you're investigating a scoring oddity. |
| **Highest note** | Caps how high licks can transpose. Set this to your real high note so the app doesn't push phrases above your range. |
| **Reset progress** | Destructive — wipes your local sessions and adaptive level. Cloud-synced data on the same account will resync if you stay signed in. |

## Adding your own licks

Two ways in.

- **Step entry** (`/entry`) — note by note, like writing on staff paper. Pick a duration, pick a pitch (with sharps/flats), and the cursor moves on. Add rests, set the bar count, save the phrase, and tag it for practice if you want to drill it.
- **Record** (`/record`) — play a phrase on your horn, the app transcribes the notes from the recording. Useful for capturing something you just figured out.

Either way, your lick joins the library alongside the curated ones and behaves the same way: it can be tagged for Side B, transposed to any key, played back, and scored.

## Tips that keep showing up

- **Start slow.** A clean Good at 80 BPM teaches your ear more than a stumbled Try Again at 140.
- **Listen, don't shadow.** Wait for the phrase to land before reaching for your horn — half of ear training is *receiving* the phrase, not playing it.
- **Use the metronome.** Rhythm is 40% of your score. The click is your friend.
- **Repeat the hard ones.** Try Again is a feature, not a punishment. The same phrase will replay until you pass.
- **All 12 keys.** The library lets you transpose any lick to any key — work through the cycle of fifths, even on Side A.
- **Watch your tuning.** The pitch meter shows you flat or sharp in real time. Fix the room temperature, fix the embouchure, fix your reed; the score will rise on its own.

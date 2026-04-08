# User Guide

Mankunku is a jazz ear training app that plays musical phrases and scores your attempt to play them back on your instrument.

## Getting Started

### First Launch

On your first visit, Mankunku walks you through three setup steps:

1. **Choose your instrument** — Tenor saxophone, alto saxophone, or trumpet. This determines transposition (the sheet music shows notes in your written key).
2. **Microphone access** — Grant mic permission so the app can listen to you play and score your accuracy. You can skip this and enable it later.
3. **Start practicing** — Jump to the practice page or explore the dashboard.

### Dashboard

The home page shows:
- **Quick Start** button to jump into practice
- **Stats row** — total sessions, average score, streak days
- **Level bar** — your proficiency level and progress
- **Recent sessions** — last few attempts with scores
- **Navigation grid** — links to Practice, Library, Progress, Settings, Scales

## Practice

### How It Works

1. **Configure** — Before your first session, visit Practice Settings to choose a category, difficulty, and tempo. The app automatically selects a **daily tonality** (key + scale) based on your level and the date. You can override this in settings.

2. **Listen** — Press the play button. The app plays a phrase through your speakers with an optional metronome. Follow along on the sheet music display.

3. **Play back** — After the phrase finishes, the metronome keeps going. Play the phrase back on your instrument. The app detects your notes in real-time via the microphone.

4. **Get scored** — When you stop playing (2 seconds of silence), the app scores your attempt:
   - **Pitch accuracy** (60% weight) — Did you play the right notes?
   - **Rhythm accuracy** (40% weight) — Were you in time?
   - **Grade** — Perfect (95%+), Great (85%+), Good (70%+), Fair (55%+), or Try Again

5. **Review** — The feedback panel shows your grade, pitch/rhythm breakdown, and a per-note comparison table. You can retry the same phrase or move to the next one.

### Practice Settings

Access via the gear icon on the practice page.

| Setting | Options | Description |
|---|---|---|
| Daily Tonality | Auto / Override | Today's key + scale. Auto-selected from unlocked tonalities; overridable. |
| Category | ii-V-I Major, Blues, Bebop, etc. | Musical style/context |
| Difficulty | 1–100 | Controls pitch complexity, rhythm, tempo range. Displayed as 10 color-coded bands (Beginner → Virtuoso). |
| Tempo | 40–300 BPM | Playback speed |
| Source | Curated / Generated / Mixed | Where phrases come from |
| Bars | 1–4 | Phrase length (generated only) |

### Daily Tonality System

Each day, the app selects a tonality (key + scale type) for your practice session. All licks are transposed to the daily key.

**Progressive unlocking:**
- **Keys** unlock in circle-of-fifths order: C → G → F → D → Bb → A → Eb → E → Ab → B → Db → Gb
- **Scale types** unlock progressively: Major Pentatonic → Major → Blues (all three free) → Dorian → Mixolydian → Minor → Lydian → Melodic Minor → Altered → Lydian Dominant → Bebop Dominant
- Unlocking is driven by proficiency — improving your per-scale and per-key proficiency levels unlocks more tonalities
- New keys combine with all unlocked scale types (cross-product)

**Override:** In settings, you can pick any unlocked tonality. Locked tonalities show a lock icon with the proficiency requirements needed. A "Reset to daily" button restores the automatic selection.

### Scale-Aware Lick Filtering

The practice session only shows licks that are compatible with the current scale type. A pentatonic lick can appear in a major session (pentatonic notes are a subset of major), but a 7-note major lick won't appear in a pentatonic session where it would get awkwardly snapped down to 5 notes.

The practice page displays the **note count** below the scale name (e.g., "5 notes" for pentatonic) to make the active scale's size clear, especially for beginners.

If scale filtering leaves very few licks at your difficulty level, the app automatically widens to all licks at that difficulty as a fallback.

### Transport Controls

- **Play/Stop** — Start or stop playback
- **Tempo slider** — Adjust BPM (disabled during playback)
- **Metronome toggle** — Turn the click track on/off

### Real-Time Feedback

While the mic is active, you see:
- **Pitch meter** — Shows the detected note name, cents deviation (tuning), and detection clarity
- **Mic status** — Green when active, with an input level meter

## Library

Browse the collection of ~250 jazz licks across 9 categories (163 hand-curated + ~86 combinatorial).

### Browsing

- **Search** — Type to filter by name or tags
- **Category filter** — Pill buttons for each category (Beginner Cells, ii-V-I Major, ii-V-I Minor, Blues, Bebop, Pentatonic, Modal, Rhythm Changes, Ballad)
- **Difficulty filter** — Filter by difficulty band (Beginner through Virtuoso)

### Lick Detail

Click a lick to see:
- Sheet music display
- Key transposition selector — hear and see the lick in any of the 12 keys
- Metadata: category, difficulty, bar count, tags
- Play button to hear the lick

## Progress

Track your improvement over time.

### Stats Overview

- **Total sessions** and **average score**
- **Streak** — consecutive days practiced
- **Level** — The adaptive level (1-100), calculated as the rounded average of pitch complexity and rhythm complexity.

### Adaptive Difficulty

The app shows your current difficulty level and its components:
- **Pitch complexity** and **rhythm complexity** are adjusted independently
- Each dimension advances when its accuracy window (last 25 attempts) averages ≥ 85%
- Below 50% over that window, the dimension retreats
- Minimum 10 attempts between changes per dimension

### Category Progress

Bar chart showing attempts and average scores per category (ii-V-I Major, Blues, etc.).

### Key Progress

How well you perform in each of the 12 keys.

### Session History

Scrollable list of recent sessions showing phrase, key, tempo, score, and grade.

### Reset

Destructive reset of all progress data. Use with caution.

## Settings

### Instrument

Choose between tenor sax, alto sax, and trumpet. Changing instruments affects:
- Sheet music transposition
- Playback sound
- Pitch detection range

### Theme

Toggle between dark mode (default) and light mode.

### Defaults

- **Default tempo** — Starting BPM for new sessions
- **Metronome volume** — 0–100%
- **Swing** — Swing ratio for metronome timing
- **Metronome enabled** — Default on/off state

### Reset Progress

Same destructive reset as the progress page.

## Scales Reference

View all 20 MVP scales organized by family:
- Major modes (Ionian, Dorian, Mixolydian, Aeolian, Lydian)
- Pentatonic (Minor, Major)
- Blues (Minor, Major)
- Bebop (Dominant, Dorian)
- Melodic Minor (Melodic Minor, Altered, Lydian Dominant, Locrian Natural 2)
- Harmonic Minor (Harmonic Minor, Phrygian Dominant)
- Symmetric (Half-Whole Diminished, Whole Tone, Whole-Half Diminished)

Each scale shows its intervals, degrees, chord applications, and target/avoid notes.

## Tips

- **Start slow** — Begin at level 1 with quarter notes and easy keys. Build up gradually.
- **Use the metronome** — Rhythm is 40% of your score. Practice with the click.
- **Listen before playing** — Pay attention during playback. Internalize the phrase before attempting it.
- **Repeat phrases** — Use "Try Again" to drill difficult phrases. Repetition builds muscle memory.
- **Practice in all keys** — The library lets you transpose any lick to any key. Work through the circle of fifths.
- **Check your tuning** — The pitch meter shows real-time intonation feedback. Aim for the center line.

# How the App Listens

The microphone is the most important piece of gear in this app. Everything Mankunku does — the scoring, the per-note timing, the level adjustments — flows from a single question, asked sixty times a second: *what note are you playing right now?* This page is about how the app answers that question, why it sometimes gets confused, and what you can do to give it the cleanest signal.

## What the microphone hears

Your computer's audio system hands the app a stream of sound: the air pressure your mic detected, sampled tens of thousands of times a second. The app pulls a small sliding window from that stream — about 85 milliseconds of recent audio — and asks: *is there a periodic waveform in this window, and if so, at what frequency?*

If you're playing a steady note on a horn, the answer is usually clear: the air column in your instrument vibrates at a fundamental frequency, your mic captures that vibration, and the algorithm picks it up. The frequency converts to a MIDI note (440 Hz is concert A4; an octave up is 880 Hz; one semitone up from 440 is about 466). The app rounds to the nearest note and also reports how many cents flat or sharp you are.

The algorithm Mankunku uses is called the **McLeod Pitch Method**. It's an autocorrelation technique — it asks how well each segment of audio matches a delayed copy of itself, and the delay that matches best corresponds to the period of the note. It's particularly good at single-instrument signals like a sax or a trumpet, which is why it's the right tool here.

Each frame, the app gets a frequency *and* a **clarity score** between 0 and 1. Clarity tells the app how confident it is — a clean, sustained note has clarity above 0.92; a noise burst, an attack transient, or two notes overlapping might score 0.5. Mankunku ignores any frame with clarity below 0.80, so room noise and embouchure adjustments don't trigger phantom notes.

## Detecting where each note begins

Knowing the pitch of every frame isn't enough — the app also needs to know when one note ends and the next one begins. A scale played fast on a horn might have notes lasting 100 ms each, with crisp attacks; a ballad has long notes connected by gradual transitions. Both need to be sliced into discrete events.

The app does this with an **onset detector** that runs alongside the pitch detector, on a separate audio thread for low latency. It listens for sudden energy spikes in the high-frequency content of the signal — note attacks have more high-frequency content than the sustain of a held note, so a ratio jump in that energy is a reliable cue that a new note has just started. The detector enforces a small dead time (about 60 ms) after each onset so that fast trills don't trigger one onset per cycle.

If the onset detector is unavailable (older browsers, some mobile devices), the app falls back to inferring onsets from gaps in the pitch stream — a stretch of silence followed by a clarity spike means a new note. It's slightly less accurate but works.

Once the app has both the pitch readings and the onset times, segmenting them into notes is straightforward: each onset starts a new note; each note's pitch is the median of all the pitch readings that fell inside its window (the median, not the mean, because a single octave glitch in one frame shouldn't change the answer); each note's duration runs to the next onset or until the player stops playing.

## Why the room matters

The pitch detector works best when it's clearly hearing one note at a time. Three things commonly degrade that:

- **Background noise.** A loud HVAC hum, a fan, traffic outside — these add broadband energy that drops the clarity score and confuses the autocorrelation. The app raises the clarity threshold to 0.80 specifically to filter out signals that aren't periodic enough to trust, which means in a noisy room the detector will simply *miss* notes rather than report wrong ones.
- **Speaker bleed.** If your speakers play the original phrase loudly enough that the mic re-hears it, the detector treats those notes as if you played them. The bleed filter (see below) helps, but headphones eliminate the problem entirely. Earbuds work fine for this purpose.
- **Multiple sources.** Two horns playing at once will trip up the pitch detector — it's designed for monophonic signals. So is most other pitch detection software; this is a fundamental limit of the autocorrelation technique, not a Mankunku-specific issue.

## The bleed filter

For people who can't or don't want to use headphones, the app runs a **bleed filter** between detection and scoring. When you're on Side B with a backing track playing through speakers, the filter knows what notes the backing track is currently playing and which onsets the app is generating. For each note your microphone detected, it asks:

- Is the backing track playing this same pitch class right now?
- Is the clarity below the threshold for "definitely you playing"?
- Did a backing-track event start within 50 ms of when this note was detected?

If yes to all three, the filter drops the note as bleed. If your clarity is high (≥ 0.92), the filter keeps the note even if the pitch matches — that's you playing the same note as the backing, which is musically correct.

The filter is conservative on purpose. False positives (dropping notes you actually played) are worse than false negatives (keeping a few bleed notes), so the threshold is biased toward keeping ambiguous notes.

You can toggle the bleed filter in Settings. The default is on. If you're using headphones, leaving it on is harmless — there's no bleed to filter, so the filter does nothing.

## Latency and reaction time

There's a small delay between you blowing a note and the app registering it: the microphone's sampling, the buffer that pitch detection works on, the screen refresh, and the speed of sound across the room all add up to typically 50–150 ms. This is **constant** — it's the same on every note — so the scorer subtracts the median delay across your matched notes and only judges your relative timing. You don't get docked for reaction time. (The math is in [How Scoring Works](./scoring-algorithm.md).)

What you *do* get docked for is timing variation between notes: rushing one note and dragging another. That's because the latency correction subtracts the median; what's left is your actual jitter relative to your own internal clock.

## Tuning feedback

While you're playing, the pitch meter shows three things:

- The note name (in your instrument's written pitch).
- A **cents** offset — how flat or sharp you are relative to the nearest note. ±5 cents is "in tune"; ±20 cents starts to sound off; ±50 cents is the edge between two notes.
- A clarity dot. Bright = locked on, dim = the detector isn't sure.

Cents readings are useful for long-tone practice and intonation checking. Bear in mind they're a snapshot of the current 85 ms window — vibrato and bends will swing the reading, which is correct behavior.

## What this means for getting clean scores

A few practical things:

- **Use headphones for Side A** if you can. It removes the speaker-bleed problem entirely.
- **Sit close to the mic** but not so close that you saturate the input. The level meter on the practice page should bounce around the middle of its range, not pin to the top.
- **Quiet the room** as much as is reasonable. Turn off the fan, close the window. The app handles a moderate room tone, but it's listening for the clean periodic signal of your horn — anything else is competition.
- **Watch the clarity dot.** If it's flickering during sustained notes, the detector is struggling. Move closer to the mic, or check whether something else is making sound in the room.
- **Don't overdrive.** Most laptop mics will distort if you blow too loud into them. The pitch detector handles distorted signals badly because the harmonics get mangled. If your level meter is pinning, back off.

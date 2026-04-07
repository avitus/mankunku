# Glossary

Terminology used throughout Mankunku's codebase and documentation.

## Jazz & Music Theory

| Term | Definition |
|---|---|
| **ii-V-I** | The most common jazz chord progression. In C major: Dm7 → G7 → Cmaj7 (the ii, V, and I chords of the key). |
| **Approach note** | A note (often chromatic) used to lead into a target note, creating forward motion. |
| **Bebop** | Jazz style from the 1940s characterized by fast tempos, complex harmony, and chromatic passing tones. Bebop scales add a chromatic passing tone to create 8-note scales. |
| **Chord tone** | A note that belongs to the current chord (root, 3rd, 5th, 7th). Target notes for strong beats. |
| **Chromatic** | Moving by half steps (semitones). Chromatic approach = approaching a note from a half step above or below. |
| **Circle of fifths** | Ordering of all 12 keys by ascending fifths: C, G, D, A, E, B, Gb, Db, Ab, Eb, Bb, F. |
| **Concert pitch** | The actual sounding pitch, as opposed to written pitch for transposing instruments. |
| **Diatonic** | Notes belonging to the current key's scale (no accidentals outside the key signature). |
| **Enclosure** | Surrounding a target note with notes above and below it before resolving to the target. |
| **Ghost note** | A note played very softly, often in parentheses in notation. Adds rhythmic texture. |
| **Leap** | An interval larger than a step (> 2 semitones). Leaps often require "recovery" — stepwise motion in the opposite direction. |
| **Lick** | A short melodic phrase that can be used in improvisation. Musicians build vocabularies of licks. |
| **Passing tone** | A non-chord tone that connects two chord tones by step. |
| **Pentatonic** | A 5-note scale. Minor pentatonic (1, b3, 4, 5, b7) is foundational in jazz and blues. |
| **Step** | An interval of 1 or 2 semitones (half step or whole step). |
| **Swing** | A rhythmic feel where pairs of eighth notes are played with a long-short pattern rather than evenly. |
| **Syncopation** | Emphasis on off-beats or weak beats, creating rhythmic tension. |
| **Target note** | A chord tone placed on a strong beat (beats 1 and 3 in 4/4 time). |
| **Transposing instrument** | An instrument whose written notes differ from concert pitch. Tenor sax is a Bb instrument: written C sounds as Bb (concert). |
| **Turnaround** | A chord progression that leads back to the beginning of a form (e.g. iii-VI-ii-V). |
| **Voice leading** | Smooth connection between notes by choosing the closest available pitch, often across chord changes. |

## Audio & Signal Processing

| Term | Definition |
|---|---|
| **AnalyserNode** | Web Audio API node that provides frequency and time-domain analysis data without modifying the signal. Used for pitch detection. |
| **AudioContext** | The Web Audio API's central object. Manages audio graph, scheduling, and output. Requires user gesture to start. |
| **AudioWorklet** | Web Audio API feature that allows custom audio processing on a separate thread, avoiding main-thread jitter. Used for onset detection. |
| **Clarity** | A confidence metric (0–1) from the pitch detector indicating how periodic the signal is. Higher clarity = more confident pitch reading. |
| **EMA** | Exponential Moving Average. Used in onset detection to maintain a running baseline of audio energy. |
| **FFT** | Fast Fourier Transform. Converts time-domain audio into frequency-domain data. The AnalyserNode uses fftSize=4096. |
| **GM (General MIDI)** | A standard mapping of instrument sounds to program numbers. smplr uses GM SoundFont files. |
| **HFC** | High-Frequency Content. A spectral feature that emphasizes transients (note attacks). Weighted sum of sample magnitudes. |
| **McLeod Pitch Method** | An autocorrelation-based pitch detection algorithm well-suited for monophonic instruments. Implemented by the Pitchy library. |
| **MIDI** | Musical Instrument Digital Interface. In Mankunku, MIDI note numbers represent pitches (60 = middle C, each integer = one semitone). |
| **Onset** | The moment a new note begins. Detected via energy changes in the audio signal. |
| **PPQ** | Pulses Per Quarter note. Tone.js uses PPQ for tick-based scheduling (default 192). |
| **RMS** | Root Mean Square. A measure of signal amplitude used for the input level meter. |
| **SoundFont** | A file format for instrument samples. smplr loads GM SoundFont files for playback. |
| **Transport** | Tone.js's central timeline/scheduler. Controls BPM, position, and event scheduling. |

## Application & Code

| Term | Definition |
|---|---|
| **ABC notation** | A text-based music notation format. Mankunku converts phrases to ABC strings, which abcjs renders to SVG. |
| **Adaptive state** | The algorithm's internal tracking of difficulty level, pitch/rhythm complexity, and recent scores. |
| **DetectedNote** | A note captured from the microphone: MIDI pitch, cents deviation, onset time, duration, clarity. |
| **Display level** | Cosmetic level derived from average per-scale proficiency (separate from content difficulty tier). |
| **Difficulty level** | Functional level (1–7) that controls what musical elements appear. Adjusted by the adaptive algorithm. |
| **DTW** | Dynamic Time Warping. An algorithm for aligning two sequences of different lengths. Used to match detected notes to expected notes. |
| **Fraction** | A `[numerator, denominator]` tuple representing note durations and offsets. Avoids floating-point errors. |
| **Grid anchoring** | Snapping detected note onsets to the Transport's beat grid so they can be compared to expected offsets. |
| **Latency correction** | Subtracting the median timing offset from all detected onsets to absorb constant human/system delay. |
| **NoteResult** | Per-note scoring output: expected note, detected note, pitch score, rhythm score, missed/extra flags. |
| **Phrase** | The core data type: a sequence of notes with harmony, key, time signature, difficulty, and category metadata. |
| **Rune** | Svelte 5's reactivity primitive. `$state`, `$derived`, `$effect`, `$props` are runes. |
| **Score** | The output of scoring an attempt: pitch/rhythm accuracy, overall percentage, grade, per-note results. |
| **Session** | A single practice attempt: play a phrase, record the response, get scored. |

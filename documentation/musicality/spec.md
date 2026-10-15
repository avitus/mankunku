# Jazz Rhythm Section Musicality Specification

## Purpose

This document is an implementation specification for improving the musicality of a generative jazz rhythm section consisting of:

- Piano
- Upright bass
- Drum set

The target style is primarily **acoustic swing / bebop / post-bop jazz in 4/4**, with a walking bass, ride-cymbal-based drum time, and interactive piano comping.

The objective is **not** to make each instrument independently more complicated. The objective is to make the rhythm section behave like three musicians listening to one another and supporting a soloist.

A successful implementation should produce accompaniment that:

1. Maintains convincing swing time.
2. Clearly communicates the form and harmony.
3. Avoids mechanical repetition.
4. Uses idiomatic rhythmic and harmonic vocabulary.
5. Responds to the soloist and to the other rhythm-section instruments.
6. Builds and releases energy over phrases, sections, and choruses.
7. Leaves space.
8. Produces variation while retaining stylistic coherence.

---

# 1. Core Design Principle

Treat accompaniment generation as a hierarchy:

```text
FORM
  ↓
SECTION / CHORUS ENERGY
  ↓
PHRASE INTENT
  ↓
INSTRUMENT ROLE
  ↓
DEVICE SELECTION
  ↓
NOTE / HIT GENERATION
```

Do not generate each beat independently.

The system should first decide **what the rhythm section is trying to do**, then decide **how each instrument contributes**.

Example:

```text
Chorus 2, bars 17–24
Energy: 0.62
Soloist density: medium-high
Intent: support + propel
Bass: continuous walking, modest chromaticism
Piano: sparse offbeat comping, mostly phrase-end responses
Drums: steady ride, hi-hat 2/4, light snare dialogue
```

The individual notes should emerge from this higher-level state.

---

# 2. Shared Musical State

All instruments should read from a common state object.

Suggested conceptual structure:

```python
class RhythmSectionState:
    tempo_bpm: float
    meter: str
    key_center: str

    bar_number: int
    beat_position: float
    section: str
    chorus_number: int

    chord:
        symbol: str
        root: str
        quality: str
        extensions: list[str]
        duration_beats: float

    next_chord:
        symbol: str
        root: str
        quality: str

    phrase:
        position: float          # 0.0 -> 1.0 through phrase
        bars_remaining: float
        boundary_strength: float

    energy: float               # 0.0 -> 1.0
    density: float              # 0.0 -> 1.0
    tension: float              # 0.0 -> 1.0

    soloist:
        active: bool
        density: float
        register: float
        rhythmic_activity: float
        phrase_started: bool
        phrase_ended: bool
        recent_motif: optional

    ensemble:
        recent_hits: list
        recent_silence: float
        recent_density: float
```

The exact implementation can differ, but the musical concepts should be represented explicitly.

---

# 3. Global Musical Rules

## 3.1 Phrase awareness

Musicians think in phrases, not isolated beats.

At minimum, track:

- 2-bar units
- 4-bar phrases
- 8-bar sections
- full form
- chorus boundaries

Increase the probability of transitional gestures near phrase endings.

Examples:

- Bass approaches the next root more strongly on beat 4.
- Drummer plays a small setup or fill.
- Pianist leaves space or plays a resolving response.
- All instruments may increase activity immediately before a section change.

Avoid placing equally strong gestures at every bar line.

---

## 3.2 Energy curve

Each chorus should have an energy contour.

Example:

```text
Chorus 1: 0.35 → 0.50
Chorus 2: 0.45 → 0.70
Chorus 3: 0.60 → 0.85
Final chorus: 0.55 → 0.75 → 0.40
```

Energy can influence:

- note density
- register
- dynamics
- chromaticism
- voicing size
- cymbal choice
- fill frequency
- accent strength
- degree of interaction

Do not equate energy only with loudness.

---

## 3.3 Density balancing

Instrument density should be partially anti-correlated.

If the soloist becomes dense:

- Piano should usually become sparser.
- Drums may maintain time but reduce commentary.
- Bass should remain stable and legible.

If the soloist leaves space:

- Piano or drums may answer.
- Bass may use a more melodic connection.
- Only one or two instruments should usually fill the space.

Avoid all three instruments reacting simultaneously.

---

## 3.4 Controlled randomness

Do not use uniform random selection.

Use weighted device selection based on:

```text
style
tempo
energy
phrase position
soloist activity
previous devices
harmonic context
instrument register
recent ensemble density
```

A useful pattern:

```python
probability(device) =
    base_style_weight
    * context_weight
    * phrase_weight
    * interaction_weight
    * repetition_penalty
```

Use random variation **within musical constraints**.

---

## 3.5 Repetition penalties

Track recently used devices.

Repeated use should reduce selection probability.

Example:

```python
if device_used_in_last_2_bars:
    weight *= 0.35

if device_used_in_last_4_bars:
    weight *= 0.65
```

Some foundational devices are exempt or only weakly penalized:

- walking quarter notes
- ride cymbal time
- hi-hat on 2 and 4
- guide-tone voice leading

---

# 4. Swing Timing Model

Swing should not be implemented as a rigid 2:1 eighth-note ratio.

The feel should vary with tempo.

General behavior:

- Slower tempos: more pronounced long-short swing.
- Medium tempos: moderate swing.
- Fast tempos: eighth notes become increasingly even.

A conceptual mapping:

```text
100 BPM → strong triplet-like swing
140 BPM → moderate swing
180 BPM → lighter swing
240 BPM → nearly even eighth notes
```

Also introduce small timing variation by instrument.

Suggested tendencies:

- Bass: centered or slightly behind the nominal beat.
- Ride cymbal: steady and authoritative.
- Piano: may sit slightly behind or ahead depending on phrase intent.
- Snare/bass-drum comping: freer placement around the pulse.

Do not independently jitter every note.

Timing variation should be correlated across phrases and instruments.

---

# 5. Piano Comping Engine

## 5.1 Primary role

The piano should:

1. Clarify harmony when necessary.
2. Provide rhythmic commentary.
3. Support rather than compete with the soloist.
4. create forward motion through anticipation and voice leading.
5. Leave significant silence.

Continuous chordal accompaniment is usually undesirable in modern swing.

---

# 6. Piano Rhythmic Devices

Implement the following as named reusable devices.

## Foundation

### P1. Four-to-the-bar

Quarter-note chords on all four beats.

Use primarily for:

- older swing styles
- deliberate stylistic contrast
- low-density passages
- introductions or shout sections

Avoid as default bebop comping.

---

### P2. Two-and-four

Chord attacks on beats 2 and 4.

Useful for:

- simple swing support
- low-intensity passages
- stylistic variation

---

### P3. Charleston

Canonical pattern:

```text
Beat:  1   2   3   4
Hit:   X      X&
```

Common representation:

- beat 1
- and-of-2

Allow displacement to other starting positions.

---

### P4. Reverse Charleston

Typical pattern:

- and-of-1
- beat 3

---

### P5. Offbeat jab

Single short chord on an upbeat.

Common targets:

- and-of-2
- and-of-4

---

### P6. Anticipation

Play an upcoming harmony before its nominal arrival.

Most commonly:

- and-of-4 before the next measure

Strengthen probability at:

- phrase boundaries
- section boundaries
- dominant-to-tonic motion

---

### P7. Delayed change

Retain previous harmony through beat 1, then change on beat 2 or later.

Use sparingly.

---

### P8. Dotted-quarter grouping

Repeat or develop an attack every three eighth notes.

Creates cross-rhythmic motion.

---

### P9. Quarter-note triplet

Three attacks over two beats.

Use more often at medium tempos than very fast tempos.

---

### P10. Three-over-four phrase

Repeat a three-beat or three-eighth-note grouping across the bar.

---

### P11. Sparse punctuation

One or two chord attacks across one or more bars.

This should be a **high-probability device**, especially behind active soloing.

---

### P12. Rhythmic motif

Generate a short rhythm and reuse it with small variation across 2–4 bars.

---

### P13. Rhythmic displacement

Repeat a recognizable pattern shifted to another beat or subdivision.

---

### P14. Long-short contrast

Alternate:

- sustained chord
- short stab

Do not make every chord the same duration.

---

### P15. Stop-time figure

Play isolated ensemble hits separated by silence.

Use only when implied by arrangement or high-level form logic.

---

# 7. Piano Voicing Devices

## P16. Shell voicing

Use combinations such as:

```text
root + 3rd + 7th
root + 7th + 3rd
```

Prefer when no bassist is present.

With upright bass, roots should generally be omitted.

---

## P17. Guide-tone voicing

Primary notes:

```text
3rd
7th
```

Optionally add:

```text
9th
13th
```

Guide-tone motion should be one of the strongest default constraints.

---

## P18. Rootless A/B voicings

Examples:

```text
3 5 7 9
7 9 3 5
```

Allow altered extensions according to chord function.

---

## P19. Two-note comping

Very sparse voicings using:

```text
3 + 7
7 + 3
```

or other characteristic intervals.

Excellent behind dense solo playing.

---

## P20. Three-note rootless voicing

Examples:

```text
3 7 9
7 3 13
```

---

## P21. Open voicing

Spread chord tones across a wider interval.

Increase probability when:

- soloist is in middle register
- ensemble energy is moderate
- sustained texture is desired

---

## P22. Closed voicing

Compact voicing for short, punchy accents.

---

## P23. Drop-2 voicing

Useful for broader comping textures and arranged figures.

---

## P24. Drop-3 voicing

Use less frequently than drop-2.

---

## P25. Quartal voicing

Construct primarily from fourths.

Increase probability for:

- modal harmony
- post-bop style
- static harmony

---

## P26. Upper-structure triad

Use triads above dominant or extended harmony.

Example conceptual mappings:

```text
D major over C7 → 9, #11, 13
Eb major over C7 → #9, 5, b7
Ab major over C7 → b13, root, #9
```

The harmony engine should validate tensions against stylistic context.

---

## P27. Triad over shell

Left hand:

```text
3 + 7
```

Right hand:

```text
upper-structure triad
```

---

## P28. Sixth-diminished movement

Alternate major/minor sixth voicings with related diminished voicings.

Increase probability for:

- older swing
- bebop
- block-chord textures

---

## P29. Locked-hands figure

Primarily for:

- arranged backgrounds
- melodic comping
- shout choruses

Low default probability behind an active soloist.

---

## P30. Cluster voicing

Use controlled seconds and upper extensions.

Increase probability for modern/post-bop styles.

---

# 8. Piano Voice-Leading Devices

These should strongly influence chord generation.

### P31. Common-tone retention

Retain common chord tones between adjacent harmonies.

---

### P32. Chromatic inner voice

Move one inner voice chromatically while preserving the harmonic frame.

---

### P33. Contrary motion

Move upper and lower voices in opposite directions.

---

### P34. Parallel planing

Move a voicing structure diatonically or chromatically.

Use selectively.

---

### P35. Guide-tone line

Create melodic motion through successive 3rds and 7ths.

This should be a core default behavior.

---

### P36. Top-note melody

Choose inversions so the upper note forms a coherent melodic contour.

---

### P37. Approach voicing

Approach a target voicing from:

- half step above
- half step below
- diminished approach

---

### P38. Voicing enclosure

Approach a target top note or voicing from above and below.

---

### P39. Voice exchange

Exchange pitches between internal voices.

---

# 9. Piano Harmonic Devices

### P40. Secondary dominant

Temporarily tonicize an upcoming chord.

---

### P41. Tritone substitution

Substitute dominant harmony a tritone away.

Probability should depend on:

- style
- harmonic rhythm
- whether bass is also implying substitution

Avoid harmonic clashes caused by uncoordinated reharmonization.

---

### P42. Diminished passing chord

Use between compatible harmonies.

---

### P43. Backdoor dominant

Use ♭VII7-type dominant approach into major tonic.

---

### P44. Side-slip

Move voicing a half step above or below target harmony and resolve.

Usually short duration.

---

### P45. Pedal point

Hold one note through changing harmony.

---

### P46. Constant structure

Move the same chord shape through different roots.

---

### P47. Suspension-resolution

Delay chord tones using:

- 9 → root
- 4 → 3
- 13 → 5

---

### P48. Altered dominant color

Choose among:

```text
b9
#9
#11
b13
```

according to melodic and harmonic context.

---

### P49. Harmonic simplification

Reduce dense chord changes to:

- guide tones
- shell
- broader tonal region

Use when the soloist is harmonically active.

---

# 10. Piano Interaction Devices

### P50. Call and response

Respond after soloist phrase endings.

Do not respond to every phrase.

---

### P51. Phrase-end fill

Increase activity after detected soloist rests.

---

### P52. Motif imitation

Borrow:

- rhythm
- contour
- repeated-note pattern

from recent solo material.

Exact pitch imitation is unnecessary.

---

### P53. Dynamic shadowing

Follow soloist intensity.

---

### P54. Register avoidance

Prefer a register outside the soloist's current register.

---

### P55. Drum dialogue

React to snare or bass-drum figures.

---

### P56. Density build

Increase:

- attack frequency
- voicing size
- register
- tension use

over a multi-bar phrase.

---

### P57. Withholding

Stop comping for a meaningful span.

This is a musical device, not a failure to generate.

---

### P58. Phrase launch

Use a pickup, anticipation, dominant color, or rhythmic stab before a new phrase.

---

# 11. Upright Bass Engine

## 11.1 Primary role

The bass should:

1. Make time feel stable.
2. Clarify the harmonic path.
3. Connect chords melodically.
4. create forward motion into important arrivals.
5. interact subtly without sacrificing pulse.

The bass should generally be the **most predictable rhythm-section instrument**.

Do not make walking lines excessively clever.

---

# 12. Bass Timekeeping Devices

### B1. Four-beat walking

One principal note per quarter-note beat.

This is the default swing texture.

---

### B2. Two-feel

Primarily beats 1 and 3.

Increase probability:

- melody chorus
- early chorus
- low-energy section
- sparse texture

---

### B3. Broken two

Combine half-note foundation with occasional quarter-note movement.

---

### B4. One-feel

One major attack per measure.

Rare in standard medium-tempo swing.

---

### B5. Two-to-four transition

Use a shift from two-feel to walking as an energy increase.

This should be treated as a structural device, not merely a local pattern.

---

### B6. Quarter-note anticipation

Reach the next harmony on beat 4.

---

### B7. Eighth-note anticipation

Use and-of-4 before an important arrival.

Use less frequently than quarter-note walking approaches.

---

### B8. Delayed arrival

Delay the expected root.

Use only occasionally.

---

### B9. Repeated-note propulsion

Repeat a pitch while retaining rhythmic momentum.

---

### B10. Triplet embellishment

Use quarter-note or eighth-note triplet figures selectively.

---

### B11. Three-over-four phrase

Low probability in ordinary walking.

Increase in modern/post-bop settings.

---

### B12. Pedal rhythm

Repeat a stable pitch under changing harmony.

Especially useful over:

- dominant pedals
- modal sections
- introductions
- vamps

---

### B13. Rhythmic omission

Occasionally omit or displace an expected attack.

Use rarely enough that the walking pulse remains clear.

---

# 13. Bass Walking-Line Devices

### B14. Root on beat 1

Strong default, but not mandatory.

Probability can depend on chord duration.

Example:

```text
1-bar chord: root on beat 1 often
2-beat chord: root or strong chord tone on arrival
repeated chord: root requirement decreases
```

---

### B15. Chord-tone outline

Use:

```text
1
3
5
7
```

as structural tones.

---

### B16. Scale connection

Use scale tones to connect targets.

---

### B17. Chromatic approach

Approach target from one semitone above or below.

Core walking-bass vocabulary.

---

### B18. Double chromatic approach

Use two chromatic notes leading toward an arrival.

---

### B19. Enclosure

Surround a target pitch from above and below.

---

### B20. Diatonic approach

Use adjacent scale tone into target.

---

### B21. Dominant approach

Approach a root from its fifth.

---

### B22. Leading-tone approach

Approach target from semitone below.

---

### B23. Upper-neighbor approach

Approach from whole step or half step above.

---

### B24. Root-fifth motion

Simple, strong traditional motion.

---

### B25. Root-third motion

Clearly states chord quality.

---

### B26. Root-seventh motion

Useful for dominant and ii–V voice-leading.

---

### B27. Arpeggio continuation

Continue through chord tones instead of always redirecting immediately.

---

### B28. Scalar continuation

Maintain stepwise direction across a chord boundary.

This helps walking lines feel melodic rather than chord-by-chord.

---

### B29. Directional line

Create an ascending or descending trajectory across multiple bars.

---

### B30. Wave contour

Alternate longer ascending and descending spans.

---

### B31. Sequence

Repeat an intervallic contour at a new pitch level.

---

### B32. Motivic walking

Reuse a recognizable small shape across nearby harmonies.

Use subtly.

---

### B33. Register shift

Move line into a different octave at natural phrase points.

---

### B34. Octave displacement

Move an expected note by an octave to improve contour.

---

### B35. Delayed root

Begin chord on:

- 3rd
- 5th
- 7th

then reach root later.

Higher probability on repeated harmonies.

---

### B36. Upper-extension target

Occasionally target:

```text
9
11
13
```

when stylistically appropriate.

---

### B37. Diminished connection

Use diminished chord tones as passing material.

---

### B38. Bebop-style chromatic connection

Place chord tones on strong beats and chromatic connectors on weaker positions.

---

# 14. Bass Harmonic Devices

### B39. Tritone-substitution implication

Use carefully.

If bass explicitly states the substitute root, piano should generally know about it.

---

### B40. Secondary-dominant implication

Outline temporary dominant movement into the next chord.

---

### B41. Backdoor approach

Use ♭VII7-derived connection into tonic.

---

### B42. Altered-dominant connection

Use altered notes primarily as passing tones unless style strongly supports them.

---

### B43. Side-slip

Short chromatic excursion followed by clear resolution.

Low default probability.

---

### B44. Harmonic generalization

Treat rapid changes as one broader tonal area.

---

### B45. Pedal point

Maintain one bass note under multiple chords.

---

### B46. Contrary melodic line

Move opposite the melody or piano top voice when musically useful.

---

# 15. Bass Articulation Devices

### B47. Short quarter note

Useful for older, buoyant swing.

---

### B48. Full-value quarter note

Useful for modern sustained walking.

---

### B49. 2-and-4 emphasis

Subtly shape quarter notes rather than making all attacks identical.

---

### B50. Ghost note

Very light muted or semipitched articulation.

---

### B51. Rake

Use physical string-crossing gesture into target note.

If the sound engine cannot represent this literally, approximate with articulation and timing.

---

### B52. Slide

Small expressive pitch transition.

Low frequency.

---

### B53. Open-string resonance

Use when instrument model supports it.

---

### B54. Dead note

Percussive muted attack.

Low frequency.

---

# 16. Bass Interaction Devices

### B55. Phrase-end activity

Allow slightly more melodic walking when the soloist rests.

---

### B56. Sparse support

Simplify chromaticism beneath very dense soloing.

---

### B57. Density increase

Increase:

- chromatic approaches
- register changes
- occasional eighth-note connections

as ensemble energy rises.

Do **not** increase density primarily by abandoning quarter-note walking.

---

### B58. Section marker

Use a clear approach, octave shift, pedal, or two-to-four transition around a section boundary.

---

### B59. Turnaround launch

Create particularly strong directional movement through the last two bars of a form.

---

# 17. Drum Engine

## 17.1 Primary role

The drummer should:

1. Establish the swing pulse.
2. Shape dynamics and energy.
3. interact with the soloist.
4. signal phrase and section boundaries.
5. create rhythmic tension without obscuring time.

The ride cymbal is normally the primary timekeeper.

The snare and bass drum should often behave as **commentary**, not as a repeated groove pattern.

---

# 18. Ride Cymbal Devices

### D1. Standard swing ride

Base pattern:

```text
1   2 & 3   4 &
```

Do not render this identically every bar.

Vary:

- skip-note placement
- velocity
- note length
- occasional omitted skips
- phrase shape

---

### D2. Quarter-note ride

Straight quarter notes.

Useful:

- very fast tempos
- sparse playing
- temporary simplification

---

### D3. Skip-beat variation

Move or omit the traditional skip note.

This should be a central anti-repetition mechanism.

---

### D4. Ride phrase

Create 2–4 bar cymbal motifs rather than independent bars.

---

### D5. Accent 2 and 4

Slightly emphasize swing backbeats.

---

### D6. Accent 1 and 3

Use selectively for older swing feel.

---

### D7. Ride bell

Increase probability with energy.

Avoid constant bell playing.

---

### D8. Crash ride

Use for high-energy or arranged sections.

---

### D9. Quarter-note triplet ride

Use as a short cross-rhythmic device.

---

### D10. Three-over-four ride phrase

Use sparingly.

---

### D11. Ride displacement

Shift a recognizable rhythm against the meter.

---

### D12. Broken ride time

Suggest the pulse with irregular attacks while maintaining internal time.

Use primarily for modern/post-bop contexts.

---

### D13. Sparse ride

Reduce cymbal density while keeping pulse implied.

---

### D14. Cymbal choke

Use for arranged accents or strong punctuation.

---

# 19. Hi-Hat Devices

### D15. Foot hi-hat on 2 and 4

Core swing behavior.

High default probability.

---

### D16. Splash hi-hat

Use for color and phrase transitions.

---

### D17. Barked hi-hat

Stronger foot accent.

Use sparingly.

---

### D18. Quarter-note hi-hat

Useful in quieter passages or brush-like textures.

---

### D19. Offbeat hi-hat

Occasional offbeat foot or stick accent.

---

### D20. Hi-hat ride texture

Move primary timekeeping from ride cymbal to hi-hat.

Useful for:

- lower dynamics
- introductions
- contrast between sections

---

# 20. Snare Comping Devices

### D21. Feathered comping

Very soft snare commentary underneath time.

---

### D22. Offbeat jab

Short accent on swung upbeat.

---

### D23. Charleston

Use classic Charleston rhythm on snare.

---

### D24. Reverse Charleston

Use displaced complementary rhythm.

---

### D25. Snare triplet

Short triplet comping figure.

---

### D26. Three-note cell

Repeat or transform a three-note rhythmic motif.

---

### D27. Rhythmic displacement

Move a familiar figure to a different beat.

---

### D28. Motivic comping

Develop one figure over multiple bars.

Core interaction device.

---

### D29. Call and response

Answer recent soloist or piano rhythm.

---

### D30. Phrase-end commentary

Increase probability after the soloist finishes a phrase.

---

### D31. Backbeat

Use only when stylistically appropriate.

---

### D32. Cross-stick

Use as timbral contrast.

---

### D33. Rimshot

Reserve for stronger accents.

---

### D34. Press roll

Useful for crescendos and transitions.

---

### D35. Ruff / drag

Grace-note articulation into an accent.

---

### D36. Flam

Broaden a strong accent.

---

### D37. Ghost notes

Very low-level connective snare notes.

---

# 21. Bass Drum Devices

### D38. Feather four

Very soft quarter notes.

Should sit below the perceptual level of obvious kick-drum groove playing.

---

### D39. Two-feel bass drum

Light beats 1 and 3.

---

### D40. Bass-drum comping

Irregular commentary.

---

### D41. Bomb

Strong accent placed unexpectedly.

Should be rare.

---

### D42. Anticipated bomb

Place just before a strong arrival.

---

### D43. Delayed bomb

Place shortly after expected arrival.

---

### D44. Bass-drum triplet

Short triplet figure.

---

### D45. Phrase punctuation

One strong hit around a phrase boundary.

---

### D46. Bass-drum/cymbal unison

Use for strong ensemble punctuation.

---

### D47. Bass-drum/snare dialogue

Alternate rhythmic figures between voices.

---

# 22. Tom and Orchestration Devices

### D48. Tom comping

Use toms as conversational voices, not just fills.

---

### D49. Melodic tom contour

Move across drums to create rising or falling shape.

---

### D50. Floor-tom punctuation

Low-frequency accent without full bass-drum impact.

---

### D51. Tom ostinato

Use in vamps, modal sections, or deliberate textural changes.

---

### D52. Cross-drum orchestration

Take one rhythmic motif and distribute it across:

- snare
- toms
- rims
- cymbals

---

### D53. Timbral substitution

Repeat rhythm while changing sound source.

---

# 23. Drum Coordination Devices

### D54. Ride + snare independence

Maintain time while improvising snare figures.

---

### D55. Ride + bass-drum independence

Maintain ride while adding kick commentary.

---

### D56. Three-limb comping

Example:

```text
ride = time
hi-hat = 2 and 4
snare = commentary
```

---

### D57. Four-limb independence

Use carefully; complexity should remain musically purposeful.

---

### D58. Unison orchestration

Play same rhythm across multiple limbs.

Use for stronger accents.

---

### D59. Split orchestration

Distribute one phrase among voices.

---

### D60. Interlocking figure

Alternate attacks across limbs to create composite rhythm.

---

### D61. Linear phrase

Only one limb attacks at a time.

---

### D62. Layered ostinato

Maintain stable pattern on some limbs while another improvises.

---

### D63. Metric implication

Suggest another pulse through grouping without actually changing meter or tempo.

Use at higher sophistication levels.

---

# 24. Drum Form Devices

### D64. Setup

Lead into an ensemble hit.

A setup should normally occur **before** the target, not simultaneously with it.

---

### D65. Catch

Reinforce an ensemble rhythmic accent.

---

### D66. Fill around figure

Connect ensemble hits with improvised material.

---

### D67. Section transition

Change one or more of:

- cymbal
- dynamics
- density
- register
- articulation

at formal boundaries.

---

### D68. Four-bar fill

Short phrase-boundary fill.

Do not automatically fill every four bars.

---

### D69. Eight-bar fill

Stronger formal marker.

---

### D70. Turnaround fill

Use final measure or two to launch next chorus.

---

### D71. Shout-chorus support

Increase orchestration and ensemble hits.

---

### D72. Dropout

Temporarily remove a drum voice or the full kit.

---

### D73. Re-entry

Return with a clear cymbal or setup gesture.

---

# 25. Drum Interaction Devices

### D74. Soloist imitation

Echo rhythm or contour.

---

### D75. Soloist provocation

Introduce a contrasting rhythmic idea.

Use less frequently than supportive responses.

---

### D76. Piano dialogue

Answer piano comping rather than doubling it.

---

### D77. Bass dialogue

React to bass accents or register shifts.

---

### D78. Dynamic shadowing

Follow soloist intensity.

---

### D79. Density build

Increase activity over several bars.

---

### D80. Density release

Reduce comping after a peak.

---

### D81. Register build

Move from lower drums toward cymbals.

---

### D82. Timbral build

Example:

```text
ride
→ stronger ride
→ bell
→ crash accents
→ full-kit orchestration
```

---

### D83. Silence

Leave deliberate gaps.

Silence must be explicitly modeled as a valid choice.

---

### D84. Phrase launch

Use a fill or accent to propel the next phrase.

---

### D85. Phrase cushioning

Reduce activity to let a melodic resolution land.

---

# 26. Ensemble Interaction Rules

This section is more important than the size of the device library.

## Rule 1: Do not fill every gap

When the soloist stops, assign a probability that:

```text
piano responds
drums respond
bass becomes melodic
nobody responds
```

The last option should have significant probability.

Example:

```text
nobody: 0.35
piano: 0.30
drums: 0.25
bass: 0.10
```

Values should vary with style and context.

---

## Rule 2: Avoid simultaneous commentary

If piano initiates an active comping response:

```text
drum commentary probability ↓
bass embellishment probability ↓
```

If drums launch a strong snare phrase:

```text
piano density probability ↓
```

This creates conversational turn-taking.

---

## Rule 3: Bass stability has priority

When interaction becomes complex:

```text
bass complexity ↓
```

The bass should generally preserve the harmonic and temporal foundation.

---

## Rule 4: Strong ensemble hits require coordination

If a high-level arrangement produces an accent:

```text
piano catches hit
drums catch/setup hit
bass may catch or strongly target hit
```

Do not independently generate competing accents at that moment.

---

## Rule 5: Piano and bass should coordinate reharmonization

If piano uses a strong harmonic substitution:

```text
tritone substitution
side-slip
secondary dominant
```

then either:

1. bass agrees,
2. bass remains harmonically neutral, or
3. the dissonance is intentionally marked as an advanced tension device.

Do not accidentally create incompatible roots.

---

## Rule 6: Phrase boundaries matter more than bar boundaries

A bar line alone should not cause a fill.

Strong transition probability should be tied to:

```text
phrase boundary strength
section boundary
chorus boundary
soloist phrase ending
harmonic arrival
```

---

# 27. Soloist Listening Model

If solo input is available, derive features over a moving window.

Useful features:

```python
SoloFeatures:
    note_density
    average_note_duration
    rest_duration
    register_center
    register_width
    dynamic_level
    syncopation
    triplet_activity
    repeated_rhythm
    phrase_length
    recent_phrase_end
    recent_phrase_start
```

The accompaniment does not need semantic understanding of the solo.

These relatively simple features can drive substantial musical improvement.

---

# 28. Response Logic

Example rules:

```python
if solo.note_density > 0.8:
    piano.density *= 0.45
    drums.comping_density *= 0.70
    bass.chromaticism *= 0.80
```

```python
if solo.rest_duration > 1.0 beats:
    enable_response_window = True
```

```python
if solo.recent_phrase_end and phrase.boundary_strength > 0.7:
    piano.response_probability += 0.20
    drums.response_probability += 0.20
```

```python
if solo.register_center == "middle":
    piano.preferred_register = "upper-middle or lower-middle"
```

```python
if ensemble.energy > 0.75:
    drums.ride_bell_probability += 0.15
    piano.voicing_size += 1
    bass.chromatic_approach_probability += 0.08
```

These numbers are examples, not fixed requirements.

---

# 29. Device Selection Architecture

Represent each device as structured metadata rather than hard-coded special cases.

Example:

```python
Device(
    id="piano_charleston",
    instrument="piano",
    category="rhythm",
    complexity=0.25,
    density=0.35,
    energy_range=(0.2, 0.8),
    tempo_range=(70, 240),
    phrase_positions=["any"],
    style_weights={
        "swing": 1.0,
        "bebop": 0.8,
        "post_bop": 0.6,
    },
    conflicts=[
        "piano_four_to_bar",
    ],
)
```

Also consider:

```python
requirements
preferred_context
incompatible_context
cooldown_bars
variation_generators
```

---

# 30. Device Families

Do not create hundreds of completely independent patterns.

Instead define **families** with parameterized variants.

Example:

```python
CharlestonDevice(
    offset=0.0,
    inversion=False,
    duration="short",
    velocity=0.65
)
```

Possible transformations:

```text
displace by beat
displace by eighth note
invert long/short durations
omit one attack
add pickup
repeat across bar line
answer with complementary rhythm
```

This will generate far more convincing variety than a giant flat pattern library.

---

# 31. Phrase-Level Planning

Before generating notes for a 4-bar phrase, choose an intent.

Example intentions:

```text
support
leave_space
build
release
answer
launch
simplify
intensify
mark_form
```

Then assign instrument behavior.

Example:

```yaml
intent: build

piano:
  density: rising
  rhythm: offbeat / anticipation
  voicing: 3-note → 4-note
  register: gradually rising

bass:
  feel: walking
  contour: ascending
  chromaticism: moderate
  target: strong arrival at bar 5

drums:
  ride: standard → more active
  snare: rising density
  bass_drum: one setup
  transition: short fill into bar 5
```

This is much more musical than independently sampling patterns for each bar.

---

# 32. Microtiming and Humanization

Avoid naive random jitter.

Use three layers:

## Layer 1: player placement

Persistent tendency for several measures.

Example:

```text
bass: +8 ms
piano: +12 ms
ride: -2 ms
```

These are conceptual and tempo-dependent.

---

## Layer 2: phrase movement

The ensemble may subtly lean forward into a phrase ending.

---

## Layer 3: articulation-specific variance

Examples:

- ghost notes may be looser
- strong ensemble hits should be tighter
- anticipations may lean forward
- sustained piano chords may sit slightly back

Humanization should be correlated, not white noise.

---

# 33. Velocity and Dynamics

Never use one velocity range for an instrument.

Velocity depends on function.

Example drum hierarchy:

```text
ghost note < feathered note < timekeeping note < comping accent < ensemble hit
```

Example piano hierarchy:

```text
background pad < ordinary comp < response < setup/accent
```

Example bass:

```text
ghost/dead note < ordinary walking note < phrase target/accent
```

Use phrase-level dynamic envelopes.

---

# 34. Register Management

## Piano

Avoid prolonged competition with the soloist.

Prefer:

```text
soloist low → piano middle/high
soloist middle → piano lower-middle or upper
soloist high → piano middle
```

Avoid excessive left-hand roots when upright bass is present.

---

## Bass

Keep most walking in a practical central register.

Use upper register as a phrase-level expressive event rather than random variation.

---

## Drums

Treat register as orchestration:

```text
bass drum / floor tom = low
snare / rack tom = middle
ride / crash / bell = high
```

Moving upward can contribute to an energy build.

---

# 35. Style Profiles

Implement style presets as weights, not completely separate engines.

## Swing

Higher weights:

```text
piano four-to-bar
two-feel bass
short bass articulation
hi-hat 2/4
simple ride
clear phrase boundaries
```

Lower weights:

```text
side-slipping
metric implication
dense quartal voicings
```

---

## Bebop

Higher weights:

```text
rootless piano
sparse offbeat comping
walking bass
chromatic bass approaches
ride cymbal
snare/bass-drum bombs
anticipations
guide-tone voice leading
```

---

## Hard bop

Increase:

```text
blues language
stronger backbeat possibility
piano rhythmic motifs
church/gospel-derived voicings
bass repetition
stronger drum interaction
```

---

## Post-bop

Increase:

```text
quartal voicings
side-slipping
metric implication
broken ride patterns
three-over-four figures
pedal points
greater rhythmic independence
```

---

# 36. Complexity Levels

Provide a global musical complexity parameter.

## Level 1 — Basic swing

Piano:

```text
shells
guide tones
Charleston
offbeat hits
```

Bass:

```text
roots
3rds
5ths
diatonic approaches
simple chromatic approaches
```

Drums:

```text
basic ride
hi-hat 2/4
minimal snare
feathered kick
```

---

## Level 2 — Idiomatic bebop

Add:

```text
rootless piano voicings
anticipations
motivic comping
bass enclosures
chromatic walking
snare comping
bass-drum bombs
phrase fills
```

---

## Level 3 — Advanced interaction

Add:

```text
soloist imitation
voice-leading plans
upper structures
three-over-four rhythms
bass directional sequences
drum orchestration
dynamic builds
```

---

## Level 4 — Post-bop

Add:

```text
quartal harmony
side-slipping
metric implication
broken time
pedal textures
higher rhythmic independence
```

Complexity should affect **available vocabulary**, not simply number of notes.

---

# 37. Anti-Patterns to Eliminate

These are common causes of machine-like accompaniment.

## Piano

Avoid:

- chord on every beat
- random chord attacks
- identical voicing every time a chord appears
- constant root-position harmony
- excessive roots when bass is present
- filling every soloist rest
- random high extensions without voice-leading logic
- same chord duration on every attack

---

## Bass

Avoid:

- root on every beat 1 without exception
- random scale notes
- excessive chromaticism
- large unexplained leaps
- eighth-note fills every bar
- identical 1–3–5–chromatic formulas
- rhythmic instability in ordinary walking
- reharmonizations that conflict with piano

---

## Drums

Avoid:

- identical ride pattern every bar
- snare hit generated independently every beat
- rock-like bass drum patterns in straight-ahead swing
- fill every four bars
- constant cymbal crashes
- simultaneous snare and bass-drum randomness
- excessive velocity variation
- independent microtiming jitter for every note

---

## Ensemble

Avoid:

- all instruments increasing density simultaneously
- all instruments responding to the same soloist gap
- random dynamics
- treating every bar as independent
- ignoring chorus/form position
- constant maximum complexity
- no silence
- no memory of prior patterns

---

# 38. Musical Memory

Maintain short-, medium-, and long-term memory.

## Short-term

Last:

```text
1–2 bars
```

Track:

- recent rhythms
- recent pitches
- device usage
- density
- soloist motif

---

## Medium-term

Last:

```text
4–16 bars
```

Track:

- phrase motifs
- register
- energy direction
- recently used fills
- comping density
- walking contour

---

## Long-term

Whole chorus / performance.

Track:

- chorus energy
- major texture changes
- previously reached climax
- device-family frequency
- structural contrasts

This allows the system to create development rather than endless novelty.

---

# 39. Variation Strategy

When reusing a motif, transform rather than replace it.

Possible transformations:

```text
repeat
displace
truncate
extend
invert rhythm
change orchestration
change register
change voicing
increase density
decrease density
answer
sequence
```

Example:

```text
Bar 1: piano Charleston
Bar 2: silence
Bar 3: displaced Charleston
Bar 4: shortened response
```

This sounds more intentional than four unrelated patterns.

---

# 40. Silence Model

Silence should be represented explicitly.

Example:

```python
class SilenceDevice:
    duration_beats: float
    reason: str
```

Possible reasons:

```text
soloist_dense
after_response
before_section
dynamic_release
avoid_overlap
phrase_resolution
```

The generator should be rewarded for appropriate silence.

---

# 41. Recommended Generation Pipeline

```text
1. Parse form and harmony
2. Analyze soloist, if available
3. Determine current energy
4. Determine phrase position
5. Select phrase-level intention
6. Assign roles to piano/bass/drums
7. Select device families
8. Generate instrument events
9. Resolve ensemble conflicts
10. Apply voice leading
11. Apply register rules
12. Apply articulation
13. Apply microtiming
14. Apply velocity/dynamics
15. Validate density and repetition
16. Render MIDI/audio
```

---

# 42. Ensemble Conflict Resolution

Run a post-generation validation pass.

Example checks:

```python
if piano.is_dense and drums.is_dense and solo.is_dense:
    reduce_one_accompaniment_voice()
```

```python
if piano.low_register_overlap(bass):
    revoice_piano_upward()
```

```python
if piano.strong_hit and drums.strong_hit:
    if not intentionally_coordinated:
        weaken_or_move_one_hit()
```

```python
if bass.substitution_conflicts(piano):
    resolve_harmonic_interpretation()
```

```python
if fills_in_last_8_bars > threshold:
    suppress_next_fill()
```

---

# 43. Initial Probability Recommendations

These are starting values only.

## Piano behind medium-density solo

Per bar:

```text
silence / nearly silent: 25%
one attack:              25%
two attacks:             30%
three attacks:           15%
four+ attacks:            5%
```

These probabilities should be conditioned by phrase state.

---

## Bass

Medium-tempo bebop:

```text
walking four:           85%
broken/two feel:        10%
other:                   5%
```

During melody chorus, increase two-feel substantially.

---

## Drums

Core time:

```text
ride active:            90%+
hi-hat 2/4:             75–95%
```

Per-bar commentary:

```text
minimal:                40%
light:                  35%
moderate:               20%
heavy:                   5%
```

Heavy commentary should cluster around meaningful high-energy moments.

---

# 44. Evaluation Framework

Do not evaluate musicality only with note-level correctness.

Create tests at several levels.

## Harmonic correctness

Measure:

- chord-tone compatibility
- tension validity
- bass/piano substitution compatibility
- voice-leading smoothness

---

## Rhythmic correctness

Measure:

- pulse stability
- swing subdivision consistency
- phrase-boundary behavior
- excessive repetition
- excessive syncopation

---

## Ensemble behavior

Measure:

```text
simultaneous density
register collision
response collision
fill frequency
silence frequency
coordinated accent accuracy
```

---

## Phrase behavior

Check whether:

- activity changes across phrases
- turnarounds feel directional
- section boundaries are marked selectively
- choruses have discernible energy shapes

---

# 45. Useful Automated Metrics

Implement metrics such as:

```text
Piano attacks per bar
Bass non-quarter-note rate
Bass root-on-beat-1 percentage
Bass chromatic-note percentage
Ride-pattern repetition rate
Snare attacks per bar
Bass-drum attacks per bar
Fill frequency
Average ensemble polyphonic density
Percentage of solo rests filled
Percentage of rests left empty
Register overlap
Repeated-device frequency
Exact-pattern repetition
```

These do not define musicality, but they are valuable regression indicators.

---

# 46. Musicality Regression Tests

Create deterministic seeds and store reference outputs.

Test situations:

## Test A — Medium swing

```text
Tempo: 140 BPM
Form: 32-bar AABA
Solo density: medium
Style: bebop
```

Expected:

- walking bass
- sparse piano
- steady ride
- modest interaction

---

## Test B — Dense soloist

Expected:

- piano density decreases
- drums simplify
- bass remains clear
- substantial accompaniment space

---

## Test C — Sparse soloist

Expected:

- occasional piano/drum responses
- not every gap filled
- bass becomes slightly more melodic

---

## Test D — Chorus build

Expected:

- energy rises gradually
- drum orchestration expands
- piano activity grows modestly
- bass remains rhythmically stable

---

## Test E — Section transition

Expected:

- stronger bass approach
- possible drum setup
- possible piano anticipation
- coordinated arrival

---

## Test F — Repeated harmony

Expected:

- bass varies contour
- piano varies inversion/rhythm
- drums avoid identical bar loops

---

# 47. Human Evaluation

Automated metrics are insufficient.

Create A/B listening tests.

Ask listeners:

```text
Which version swings more?
Which version sounds less repetitive?
Which rhythm section responds better to the soloist?
Which version leaves more appropriate space?
Which version sounds more like musicians playing together?
Which version better communicates the form?
Which version develops over time?
```

Compare one architectural change at a time.

---

# 48. Priority Implementation Roadmap

Do not begin by implementing all devices.

The largest gains should come from the following order.

## Phase 1 — Phrase awareness

Implement:

- 4/8-bar phrase positions
- section boundaries
- chorus boundaries
- phrase-level energy

This changes all later behavior.

---

## Phase 2 — Silence and density control

Implement:

- explicit silence device
- density target per instrument
- anti-correlation between piano/drums
- solo-density response

This is likely one of the highest-value musical improvements.

---

## Phase 3 — Bass walking quality

Implement:

- chord-tone targeting
- chromatic approach
- diatonic approach
- enclosures
- directional contours
- strong turnaround behavior

Prioritize melodic connection over exotic vocabulary.

---

## Phase 4 — Piano rhythmic vocabulary

Implement first:

```text
sparse punctuation
Charleston
reverse Charleston
offbeat jab
anticipation
rhythmic motif
displacement
phrase-end response
```

Do not prioritize advanced voicings before rhythmic comping feels convincing.

---

## Phase 5 — Piano voice leading

Implement:

```text
guide tones
common tones
rootless voicings
top-note contour
approach voicings
```

---

## Phase 6 — Drum ride variation

Implement:

```text
ride phrase generation
skip-beat variation
velocity hierarchy
hi-hat 2/4
```

The ride should stop sounding like a one-bar loop.

---

## Phase 7 — Drum commentary

Implement:

```text
snare offbeats
Charleston
motivic comping
phrase-end response
bass-drum bombs
setups
```

---

## Phase 8 — Ensemble interaction

Implement:

```text
response windows
turn-taking
density suppression
coordinated hits
soloist register awareness
```

This is where the rhythm section should begin to feel like an ensemble.

---

## Phase 9 — Structural energy

Implement:

```text
two-feel → four
ride → bell
voicing expansion
density build
dynamic release
dropout/re-entry
```

---

## Phase 10 — Advanced vocabulary

Only after the preceding phases sound convincing, add:

```text
side-slipping
upper structures
quartal voicings
metric implication
three-over-four
advanced drum orchestration
harmonic substitutions
```

Advanced vocabulary will not repair poor time, density, phrasing, or interaction.

---

# 49. Minimal High-Value Device Set

If implementation scope must be constrained, start with these.

## Piano

```text
silence
guide-tone voicing
rootless voicing
Charleston
reverse Charleston
offbeat jab
anticipation
rhythmic motif
phrase-end response
register avoidance
```

## Bass

```text
two-feel
walking four
root/chord-tone target
diatonic approach
chromatic approach
enclosure
directional contour
turnaround launch
```

## Drums

```text
standard ride
ride variation
hi-hat 2/4
feathered bass drum
offbeat snare
Charleston snare
motivic comping
phrase setup
short fill
silence
```

## Ensemble

```text
phrase awareness
density balancing
response windows
turn-taking
energy curve
repetition memory
coordinated accents
```

This relatively small vocabulary can produce a highly convincing rhythm section if the selection and interaction logic are good.

---

# 50. Definition of Done

The rhythm section should not be considered musically successful merely because all notes are legal.

A satisfactory result should make the following statements true:

- The bass establishes a reliable pulse and creates melodic forward motion.
- The piano frequently chooses not to play.
- Piano chord attacks feel rhythmically intentional rather than random.
- Piano voicings connect smoothly.
- The ride cymbal sounds like a developing phrase rather than a loop.
- Snare and bass-drum figures behave like commentary.
- Drum fills correlate with musical structure.
- The three instruments rarely become simultaneously busy without a deliberate reason.
- The accompaniment reacts to the soloist without parroting every phrase.
- Repeated choruses develop rather than merely regenerate.
- Important formal arrivals are prepared.
- Some gaps remain completely empty.
- The accompaniment has an audible energy contour.
- The performance sounds like three musicians listening to each other.

The core engineering principle is:

> **Generate intention first, devices second, and notes last.**

A smaller vocabulary with strong phrase logic, memory, interaction, and restraint will sound substantially more musical than a large vocabulary selected randomly.

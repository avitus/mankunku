# Ear Training melody loudness

The reference is the MTG tenor saxophone with its production velocity layers and expression. The violin uses FluidR3 GM and the trombone uses MusyngKite. Each Ear Training voice has a fixed amplitude trim on the Melody path. Note velocities, backing levels and the recorded tenor calibration retain their existing values.

## Measurement

Rendered the actual banks through the production Ear Training loader, note player and listening mixer in a sandboxed Chromium OfflineAudioContext at 48 kHz stereo. Melody was at unity, Master at 0.8 and backing and click were off. Each six-second segment used the same events across instruments. FFmpeg measured each segment separately in integrated LUFS. The trim offsets target the mean difference from tenor, with a second render to account for peaks that had reached output protection before attenuation.

At 110 BPM and swing 0.62 the four segments were Blue Note Climb, Blues Call down three semitones at reduced velocity (−14), Minor Pent Drop at increased velocity (+15), and Blue Note Climb down four semitones at increased velocity (+5). The tenor measured −33.64, −35.35, −32.16 and −34.00 LUFS respectively. Positive differences below mean louder than tenor.

| Voice | Mean difference before (LU) | Mean difference after (LU) | Largest absolute difference on one calibration call (LU) |
|---|---:|---:|---:|
| tenor-sax | +0.00 | +0.00 | 0.00 |
| alto-sax | +2.53 | +0.03 | 0.47 |
| soprano-sax | +6.27 | -0.04 | 1.22 |
| trumpet | +4.03 | +0.10 | 1.10 |
| piano | +13.37 | -0.04 | 1.94 |
| bass | +15.94 | +0.00 | 2.18 |
| guitar | +9.25 | +0.04 | 1.34 |
| trombone | +2.97 | -0.03 | 0.80 |
| flute | +4.67 | -0.03 | 0.34 |
| vibraphone | +4.37 | -0.03 | 1.72 |
| violin | +10.48 | -0.02 | 0.47 |
| voice | +9.40 | -0.01 | 1.39 |
| concert | +13.37 | -0.04 | 1.94 |
| tenor-sax-fallback | +8.45 | +0.04 | 0.71 |
| alto-sax-fallback | +10.10 | -0.00 | 0.98 |
| soprano-sax-fallback | +6.15 | +0.05 | 0.54 |

## Register check

BB King Bend was also rendered in its original register and transposed by −12, −5 and +4 semitones. Compare only transpositions within the selected instrument's playable range. In the original register the largest deviation was vibraphone at +2.52 LU. In the higher register it reached +4.18 LU. Across the four calibration calls the largest individual difference was the softer bass call at −2.18 LU. These measurements describe phrase loudness. Peaks and individual note levels vary with attack, sustain, velocity layer and pitch.

## Trumpet sustain

In Blue Note Climb the last half note is a concert C4 lasting 1.09 seconds. The upstream MusyngKite trumpet loop for C4 repeats frames 21120–21267 at 44.1 kHz, producing a 300 Hz fundamental about 0.48 seconds into the note. The encoded C4 itself sustains near 261.6 Hz.

The local trumpet loop map uses 44.1 kHz frame offsets for all 88 notes in the MIDI.js bank. For each note, the start search covered 0.7–1.2 seconds and the end search 2.3–2.9 seconds. Each pair was scored by the squared waveform difference between 512-frame windows centered on the boundaries, divided by the sum of their energies. The selected pair minimized the larger error across the decoded OGG and MP3 recordings. C4 now plays the original sample through frame 106272 and loops back to 48490 on longer holds.

With both encodings the corrected final C4 measured 260.8–262.1 Hz over the portion that previously buzzed. Separate 4.8-second C4 and G4 holds retained their pitch across multiple wraps. The trumpet row above includes the corrected sustain at the existing −4 dB trim.

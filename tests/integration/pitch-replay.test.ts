import { describe, it, expect } from 'vitest';
import { replayFromAudioBuffer } from '$lib/audio/replay';
import { segmentNotes, validateOnsets, resolveOnsets } from '$lib/audio/note-segmenter';
import { loadWavFixture, makeFakeAudioBuffer } from '../helpers/audio-fixtures';

/**
 * Regression tests for the user-reported non-determinism bug.
 *
 * The fixture is a real recording (converted from webm → 16-bit mono WAV)
 * of a "Sixth–Octave Lift" lick played on Bb tenor saxophone. The prompt
 * shows written B4 → D5, which for tenor sax (sounds a major 9th below
 * written) is concert A3 → C4 — MIDI 57 → 60. The recording's measured
 * fundamentals (~220 Hz, ~261 Hz) match this exactly: the user played
 * the lick correctly.
 *
 * Despite the clean performance the live app reported three different
 * answers across three replays of the same recording: (Gb4, D4),
 * (B4, missed), (B4, D5). Non-determinism, not a performance error.
 *
 * Gates:
 *   1. Replay is deterministic (same input → same output).
 *   2. Replay detects the two notes the user actually played (concert
 *      A3 + C4 = MIDI 57, 60). Requires Phase 4 algorithmic fixes:
 *      warmup median seed, per-onset octave reset, clarity-weighted
 *      pitch-class vote, short-note fallback, and pitch-change-based
 *      sub-segmentation to handle legato transitions with no HFC onset.
 */

function loadFixture() {
	const wav = loadWavFixture('recordings/2026-04-14-a4-c5-tenor-sax.wav');
	return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
}

describe('pitch replay regression: A4 → C5 lick', () => {
	it('is deterministic across repeated replays', async () => {
		const buffer = loadFixture();
		const a = await replayFromAudioBuffer(buffer);
		const b = await replayFromAudioBuffer(buffer);

		expect(a.readings.length).toBe(b.readings.length);
		expect(a.onsets).toEqual(b.onsets);
		for (let i = 0; i < a.readings.length; i++) {
			expect(a.readings[i]).toEqual(b.readings[i]);
		}
	});

	it('detects at least one onset', async () => {
		const buffer = loadFixture();
		const { onsets } = await replayFromAudioBuffer(buffer);
		expect(onsets.length).toBeGreaterThan(0);
	});

	it('detects the two notes the user actually played (A3, C4 concert)', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const validOnsets = validateOnsets(onsets, readings);
		const detected = segmentNotes(readings, validOnsets, duration);
		expect(detected.map((n) => n.midi)).toEqual([57, 60]);
	});
});

/**
 * Second regression recording: same lick (concert A3 → C4 on Bb tenor sax)
 * but captured with a noisy mic preamble. Pitchy locks onto ~82 Hz rumble
 * for the first 5 frames with clarity 1.00 before the user starts playing.
 *
 * Before the fix, resolveOnsets blindly prepended readings[0].time = 0.000
 * to the onset list, creating a spurious E2 (40) note covering the silence
 * that preceded the real phrase. The fix caps the prepend to a backward
 * window relative to the first real onset, so island noise bursts are
 * ignored.
 */
describe('pitch replay regression: noisy preamble does not produce a leading ghost note', () => {
	function loadFixture() {
		const wav = loadWavFixture('recordings/2026-04-14-a3-c4-tenor-noisefloor.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	it('is deterministic across repeated replays', async () => {
		const buffer = loadFixture();
		const a = await replayFromAudioBuffer(buffer);
		const b = await replayFromAudioBuffer(buffer);

		expect(a.readings.length).toBe(b.readings.length);
		expect(a.onsets).toEqual(b.onsets);
		for (let i = 0; i < a.readings.length; i++) {
			expect(a.readings[i]).toEqual(b.readings[i]);
		}
	});

	it('ignores the 82 Hz island at capture start', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(readings, resolved, duration);

		expect(detected.map((n) => n.midi)).toEqual([57, 60]);
		expect(detected[0].onsetTime).toBeGreaterThan(1.0); // real A3 starts ~1.37s
	});
});

/**
 * Third regression recording: "Upper Neighbor on Root" (C4 → D4 → C4) played
 * legato with the C4 attack starting at t=0. The HFC-ratio worklet needs a
 * silence-to-signal transition to fire, so it produces only ONE onset (1.355 s)
 * for the whole take — at the *third* C, where there's a brief decay before
 * the re-articulation.
 *
 * Before the fix, resolveOnsets prepended a single anchor at 0.867 s
 * (PREPEND_BACKWARD_WINDOW = 0.5 s before the first worklet onset). The
 * segmenter then discarded readings 0–47 (the entire first C and most of
 * the D), and reported the remaining D-tail as the "first" detected note.
 *
 * After the fix, we walk the pre-onset readings and prepend an onset at the
 * start of every stable pitch run, recovering the missed C and D attacks.
 */
describe('pitch replay regression: legato C-D-C recovers pre-worklet-onset notes', () => {
	function loadFixture() {
		const wav = loadWavFixture('recordings/2026-04-19-upper-neighbor-on-root.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	it('detects the C-D-C pitch sequence the user actually played', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(readings, resolved, duration);

		// Collapse adjacent-same pitch classes so any surviving McLeod
		// subharmonic glitch (Bug 2 — same pitch class, different octave)
		// inside the sustained final C doesn't break this assertion.
		const pcs = detected.map((n) => ((n.midi % 12) + 12) % 12);
		const distinctPcs = pcs.filter((pc, i, a) => i === 0 || pc !== a[i - 1]);
		expect(distinctPcs).toEqual([0, 2, 0]); // C, D, C
	});

	it('places the first detected note within the first ~150 ms', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(readings, resolved, duration);

		// The user's first C attack lands at ~t=0; allow a little slack for
		// the warmup window and the first stable-run anchor.
		expect(detected[0].onsetTime).toBeLessThan(0.15);
		expect(detected[0].midi).toBe(60);
	});

	it('detects exactly the three notes the user played, no ghosts', async () => {
		// Strict assertion for Bug 2: a McLeod subharmonic during the bend
		// at the end of the sustained final C used to leak through as a C3
		// ghost AND split the real C4 into two segments.
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(readings, resolved, duration);

		expect(detected.map((n) => n.midi)).toEqual([60, 62, 60]);
	});
});

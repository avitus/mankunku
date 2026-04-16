import { describe, it, expect } from 'vitest';
import { replayFromAudioBuffer } from '$lib/audio/replay.ts';
import { segmentNotes, validateOnsets } from '$lib/audio/note-segmenter.ts';
import { resolveOnsets } from '$lib/scoring/score-pipeline.ts';
import { loadWavFixture, makeFakeAudioBuffer } from '../helpers/audio-fixtures.ts';

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

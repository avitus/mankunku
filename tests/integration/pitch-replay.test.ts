import { describe, it, expect } from 'vitest';
import { replayFromAudioBuffer } from '$lib/audio/replay';
import {
	segmentNotes,
	validateOnsets,
	resolveOnsets,
	findReArticulations,
	getMetronomeBleedOnsets
} from '$lib/audio/note-segmenter';
import { runScorePipeline } from '$lib/scoring/score-pipeline';
import type { Phrase } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import { loadWavFixture, makeFakeAudioBuffer, type FakeAudioBuffer } from '../helpers/audio-fixtures';

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
		//
		// The detector now lifts that end-of-note subharmonic back to C4 at the
		// source (correctSubharmonic in pitch-frame.ts), so the C3 ghost is gone
		// — but the bend still drops a ~120 ms window of readings, and without
		// attack evidence the segmenter conservatively splits the surrounding
		// same-pitch C4 across that gap. The live path supplies worklet onsets,
		// so mergeSamePitchWithoutAttack rejoins the two halves (no attack at the
		// gap); replay the same way here to assert the production result.
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(readings, resolved, duration, undefined, undefined, undefined, onsets);

		expect(detected.map((n) => n.midi)).toEqual([60, 62, 60]);
	});
});

/**
 * Fourth regression recording: "Locrian Descent" played on Bb tenor sax in
 * concert F. Phrase as written: F D C C A G F F (8 eighth notes). The user
 * actually played F D C A G F F F — they dropped the second C and added one
 * extra F at the end. The live app reported a 49.4% score; the player's
 * actual performance, correctly segmented, should land in the ~73% range.
 *
 * This recording exercises three independent segmentation issues that the
 * earlier fixes left unaddressed:
 *
 *   - **D3 phantom inside the F4-D4 transition.** Pitchy returns the half-
 *     frequency for ~67ms at the D4 attack. The pre-onset Phase 4 octave-
 *     collapse drops it from becoming an onset, but the D3 readings still
 *     live inside the previous segment — fixed post-emit by the cross-
 *     segment ±12 collapse in segmentNotes.
 *   - **A3 lost as a 2-frame outlier.** The real A3 only kept 2 readings
 *     above the clarity threshold, and as the LAST run before the worklet
 *     onset its `gapAfter` was 0 (edge of the filtered preOnset array) —
 *     fixed by threading the upcoming worklet onset as `nextEventTime` into
 *     findStableRunStarts, plus a MIDI-aware ATTACK_DEDUP guard so the
 *     near-coincident A3 stable-run-start isn't merged into the worklet
 *     onset of the differently-pitched G3 attack.
 *   - **Trailing C7 phantom.** 3 reset-induced warmup readings at MIDI 81
 *     formed a stable run inside the final segment — fixed by rejecting
 *     all-warmup sub-segments in emitNote.
 */
describe('pitch replay regression: Locrian Descent (concert F, 2026-05-07)', () => {
	function loadFixture() {
		const wav = loadWavFixture('recordings/2026-05-07-locrian-descent.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// The expected phrase, transposed to chord-root F. 8 eighth notes
	// at sequential 1/8 offsets — the saved phrase data in the original
	// diagnostics export reduces to exactly these tuples.
	const expectedPhrase: Phrase = {
		id: 'fixture',
		name: 'Locrian Descent',
		timeSignature: [4, 4],
		key: 'F',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] }, // F
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }, // D
			{ pitch: 60, duration: [1, 8], offset: [1, 4] }, // C
			{ pitch: 60, duration: [1, 8], offset: [3, 8] }, // C
			{ pitch: 57, duration: [1, 8], offset: [1, 2] }, // A
			{ pitch: 55, duration: [1, 8], offset: [5, 8] }, // G
			{ pitch: 53, duration: [1, 8], offset: [3, 4] }, // F
			{ pitch: 53, duration: [1, 8], offset: [7, 8] }  // F
		],
		harmony: [],
		difficulty: { level: 20, pitchComplexity: 18, rhythmComplexity: 18, lengthBars: 1 },
		category: 'diminished-chord',
		tags: [],
		source: 'curated'
	};

	it('segments the recording into 8 notes matching what the player actually played', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(readings, resolved, duration);

		// Player's performance: F D C A G F F F (8 notes). MIDI:
		expect(detected.map((n) => n.midi)).toEqual([65, 62, 60, 57, 55, 53, 53, 53]);
	});

	it('scores the recording in the expected post-fix range (~73%)', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(readings, resolved, duration);

		// transportSeconds and tempo/swing match the saved alignment context.
		const result = runScorePipeline({
			detected,
			phrase: expectedPhrase,
			tempo: 100,
			transportSeconds: -0.964,
			swing: 0.65,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		// Saved score was 0.494. With all the segmenter fixes the player gets
		// ~5/8 pitch matches via DTW (in-order, three mismatches), and rhythm
		// aligns much better with 8 well-distributed onsets. Bounds allow for
		// DTW tie-break variation across small replay-vs-live timing shifts.
		expect(result.chosen.overall).toBeGreaterThan(0.65);
		expect(result.chosen.overall).toBeLessThan(0.78);
		expect(result.chosen.notesHit).toBeGreaterThanOrEqual(5);
	});
});

/**
 * Fifth regression recording: "Blues Curl Down" (concert F, 2026-05-20).
 * Three-note phrase Ab Ab F (quarter quarter half) played in-time on tenor
 * sax at 100 BPM with the metronome audible in the recording. The user
 * tongued the second Ab cleanly — there's a real envelope dip-and-rise at
 * t ≈ 0.55–0.62 s and a clarity dip-and-recovery at t ≈ 0.42–0.50 s — but
 * the soft attack didn't cross the worklet's 3× HFC ratio against the EMA
 * of the sustained first Ab, so the live segmenter saw only two notes
 * (one long Ab, one F) and the DTW marked the first expected Ab as
 * MISSED. The saved score was 0.580 ("fair"), pitch 2/3, rhythm 0.451.
 *
 * After the fix:
 *   - `findReArticulations` scans inside the same-MIDI run, finds the
 *     paired clarity + RMS dip, and emits a synthetic onset at the RMS
 *     recovery point (~0.6 s).
 *   - The segmenter splits the long Ab into two notes; the articulation
 *     onset is also passed as attack evidence so `mergeSamePitchWithoutAttack`
 *     doesn't collapse it.
 *   - DTW now aligns 3-to-3 with no missed notes; scorer no longer
 *     anchors to the bar grid (the median latency correction handles any
 *     constant offset on its own).
 */
describe('pitch replay regression: Blues Curl Down re-articulation (concert F, 2026-05-20)', () => {
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-05-20-blues-curl-down.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// Three-note phrase: Ab Ab F at offsets 0, 1/4, 1/2 (quarter quarter half).
	const expectedPhrase: Phrase = {
		id: 'fixture',
		name: 'Blues Curl Down',
		timeSignature: [4, 4],
		key: 'F',
		notes: [
			{ pitch: 56, duration: [1, 4], offset: [0, 1] }, // Ab
			{ pitch: 56, duration: [1, 4], offset: [1, 4] }, // Ab
			{ pitch: 53, duration: [1, 2], offset: [1, 2] }  // F
		],
		harmony: [],
		difficulty: { level: 20, pitchComplexity: 18, rhythmComplexity: 18, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};

	it('detects three onsets including the second-Ab re-articulation', async () => {
		const buffer = loadFixture();
		const { readings, onsets } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);

		// The re-articulation detector should add at least one onset that
		// the worklet missed.
		expect(articulationOnsets.length).toBeGreaterThan(0);
		expect(allOnsets.length).toBeGreaterThanOrEqual(3);

		// Expected attack times (±100 ms): 0, 0.6, 1.08 s.
		// The first onset is recovered by the stable-run prepend (user
		// attacked at recording start). The second is the new re-articulation
		// onset. The third is the Ab→F transition (pitch change).
		const target = [0.0, 0.6, 1.08];
		const matched = target.map((t) =>
			allOnsets.find((o) => Math.abs(o - t) < 0.1)
		);
		expect(matched.every((m) => m !== undefined)).toBe(true);
	});

	it('segments into three notes [Ab, Ab, F]', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);

		expect(detected.map((n) => n.midi)).toEqual([56, 56, 53]);
		// Middle note (second Ab) starts somewhere between 0.50 s and 0.70 s.
		expect(detected[1].onsetTime).toBeGreaterThan(0.45);
		expect(detected[1].onsetTime).toBeLessThan(0.75);
	});

	it('scores three matched notes with high overall', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);

		const result = runScorePipeline({
			detected,
			phrase: expectedPhrase,
			tempo: 100,
			transportSeconds: 0,
			swing: 0.65,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		// All three expected notes should be matched, none missed, no extras.
		for (const nr of result.chosen.noteResults) {
			expect(nr.missed).toBe(false);
			expect(nr.extra).toBe(false);
		}
		expect(result.chosen.notesHit).toBe(3);
		// Pitch is a perfect 3/3 and rhythm should be tight enough for a
		// passing overall — the user played in time with the metronome.
		expect(result.chosen.pitchAccuracy).toBe(1);
		expect(result.chosen.overall).toBeGreaterThan(0.85);
	});
});

/**
 * Sixth regression recording: "Blues Curl Up" (concert F, 2026-05-20). The
 * mirror image of Blues Curl Down — F quarter, Ab quarter, Ab half — and
 * the same failure mode in a different shape. Here `extractOnsetsFromReadings`
 * *did* produce a baseline onset at the second Ab attack (the clarity-dropout
 * gap was wide enough to register), but `mergeSamePitchWithoutAttack`
 * collapsed it back together because no worklet onset was nearby. The saved
 * score was 0.552 ("fair"), pitch 2/3, rhythm 0.381 with one MISS.
 *
 * This case exercises the second-half of the re-articulation fix: even when
 * a baseline boundary already exists, the articulation onsets emitted by
 * `findReArticulations` must reinforce it as attack evidence so the merge
 * pass doesn't undo the split.
 */
describe('pitch replay regression: Blues Curl Up re-articulation (concert F, 2026-05-20)', () => {
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-05-20-blues-curl-up.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	const expectedPhrase: Phrase = {
		id: 'fixture',
		name: 'Blues Curl Up',
		timeSignature: [4, 4],
		key: 'F',
		notes: [
			{ pitch: 53, duration: [1, 4], offset: [0, 1] }, // F
			{ pitch: 56, duration: [1, 4], offset: [1, 4] }, // Ab
			{ pitch: 56, duration: [1, 2], offset: [1, 2] }  // Ab
		],
		harmony: [],
		difficulty: { level: 20, pitchComplexity: 18, rhythmComplexity: 18, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};

	it('emits an articulation onset near the second-Ab attack', async () => {
		const buffer = loadFixture();
		const { readings, onsets } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);

		expect(articulationOnsets.length).toBeGreaterThan(0);
		// At least one articulation onset lands in the expected window for
		// the second Ab attack (beat 2 = 1.2 s; ±200 ms tolerance to absorb
		// the user's small lead and the algorithm's recovery-point pick).
		const nearSecondAb = articulationOnsets.some(
			(t) => Math.abs(t - 1.2) < 0.2
		);
		expect(nearSecondAb).toBe(true);
	});

	it('segments into three notes [F, Ab, Ab]', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);

		expect(detected.map((n) => n.midi)).toEqual([53, 56, 56]);
		// The second Ab starts somewhere between 1.05 s and 1.30 s — the
		// user attacked slightly ahead of beat 2 (real performance, not
		// quantized) and the detector picks up the recovery point.
		expect(detected[2].onsetTime).toBeGreaterThan(1.0);
		expect(detected[2].onsetTime).toBeLessThan(1.35);
	});

	it('scores three matched notes with high overall', async () => {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);

		const result = runScorePipeline({
			detected,
			phrase: expectedPhrase,
			tempo: 100,
			transportSeconds: 0,
			swing: 0.65,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		for (const nr of result.chosen.noteResults) {
			expect(nr.missed).toBe(false);
			expect(nr.extra).toBe(false);
		}
		expect(result.chosen.notesHit).toBe(3);
		expect(result.chosen.pitchAccuracy).toBe(1);
		expect(result.chosen.overall).toBeGreaterThan(0.85);
	});
});

/**
 * Seventh regression recording: "Blues Curl Up" (concert G, 2026-05-22). Same
 * phrase shape as the 2026-05-20 concert-F version — root quarter, ♭3 quarter,
 * ♭3 half — and same algorithmic failure mode (player tongues the second ♭3
 * cleanly, segmenter sees only two notes, scorer marks the third expected note
 * MISSED, saved score "fair" ≈ 0.64). The new wrinkle: the tongue stop is
 * clean enough that the pitch detector loses the signal entirely for
 * 130–220 ms around the boundary. The 2026-05-20 fix's findReArticulations
 * scans for a paired clarity-dip + RMS-dip pattern *inside the readings* —
 * but here the RMS dip happens during a stretch where the detector emits no
 * non-warmup readings, so the dip is invisible and findReArticulationsInSegment
 * bails on the RMS-drop test. Two takes captured back-to-back (sessionIds
 * 1779409504311 and 1779409492327) show the same failure.
 *
 * Fix direction: the same-MIDI reading-gap is itself attack evidence — a
 * sustained reed note doesn't lose pitch tracking for >50 ms except at a
 * tongue stop — so findReArticulations also emits an articulation onset at
 * the resumption of any same-MIDI run that contains a non-warmup time gap
 * above RE_ARTICULATION_READING_GAP.
 */
describe('pitch replay regression: Blues Curl Up dropout-gap re-articulation (concert G, 2026-05-22)', () => {
	const expectedPhrase: Phrase = {
		id: 'fixture',
		name: 'Blues Curl Up',
		timeSignature: [4, 4],
		key: 'G',
		notes: [
			{ pitch: 55, duration: [1, 4], offset: [0, 1] }, // G
			{ pitch: 58, duration: [1, 4], offset: [1, 4] }, // B♭
			{ pitch: 58, duration: [1, 2], offset: [1, 2] }  // B♭
		],
		harmony: [],
		difficulty: { level: 20, pitchComplexity: 18, rhythmComplexity: 18, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};

	const takes: { label: string; file: string }[] = [
		{ label: 'take A (session 1779409504311)', file: 'recordings/2026-05-22-blues-curl-up.wav' },
		{ label: 'take B (session 1779409492327)', file: 'recordings/2026-05-22-blues-curl-up-b.wav' }
	];

	for (const { label, file } of takes) {
		describe(label, () => {
			function loadFixture(): FakeAudioBuffer {
				const wav = loadWavFixture(file);
				return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
			}

			it('emits an articulation onset near the second-B♭ attack', async () => {
				const buffer = loadFixture();
				const { readings, onsets } = await replayFromAudioBuffer(buffer);
				const baseOnsets = resolveOnsets(onsets, readings);
				const articulationOnsets = findReArticulations(readings, baseOnsets);

				expect(articulationOnsets.length).toBeGreaterThan(0);
				// Re-articulation lands around beat 2 of the phrase (1.2 s nominal,
				// ±200 ms tolerance for the user's small lead and the detector's
				// recovery-point pick).
				const nearSecondBb = articulationOnsets.some(
					(t) => Math.abs(t - 1.2) < 0.2
				);
				expect(nearSecondBb).toBe(true);
			});

			it('segments into three notes [G, B♭, B♭]', async () => {
				const buffer = loadFixture();
				const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
				const baseOnsets = resolveOnsets(onsets, readings);
				const articulationOnsets = findReArticulations(readings, baseOnsets);
				const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
				const detected = segmentNotes(
					readings,
					allOnsets,
					duration,
					undefined,
					undefined,
					undefined,
					onsets,
					undefined,
					articulationOnsets
				);

				expect(detected.map((n) => n.midi)).toEqual([55, 58, 58]);
				// Third note (second B♭) starts somewhere between 1.0 s and 1.35 s.
				expect(detected[2].onsetTime).toBeGreaterThan(1.0);
				expect(detected[2].onsetTime).toBeLessThan(1.35);
			});

			it('scores three matched notes with high overall', async () => {
				const buffer = loadFixture();
				const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
				const baseOnsets = resolveOnsets(onsets, readings);
				const articulationOnsets = findReArticulations(readings, baseOnsets);
				const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
				const detected = segmentNotes(
					readings,
					allOnsets,
					duration,
					undefined,
					undefined,
					undefined,
					onsets,
					undefined,
					articulationOnsets
				);

				const result = runScorePipeline({
					detected,
					phrase: expectedPhrase,
					tempo: 100,
					transportSeconds: 0,
					swing: 0.65,
					bleedFilterEnabled: false,
					octaveInsensitive: false
				});

				for (const nr of result.chosen.noteResults) {
					expect(nr.missed).toBe(false);
					expect(nr.extra).toBe(false);
				}
				expect(result.chosen.notesHit).toBe(3);
				expect(result.chosen.pitchAccuracy).toBe(1);
				expect(result.chosen.overall).toBeGreaterThan(0.85);
			});
		});
	}
});

/**
 * Eighth regression recording: "Flat Five Chromatic Up" (concert G,
 * 2026-06-21). The app rendered bc-045_G as C4 C4 D4 (quarter quarter half);
 * the player tongued the two C4s in time on tenor sax at 100 BPM, no backing
 * track. The second attack was soft — the HFC worklet missed it — and across
 * the boundary the pitch detector dropped ~6 frames (a 100 ms reading gap at
 * t ≈ 0.33→0.43 s) while the RMS stepped UP ~2× on the re-attack without ever
 * dipping below the pre-gap level.
 *
 * That short-gap-with-rising-RMS shape fell between findReArticulations' two
 * passes: the bare-gap pass wanted a gap ≥ 150 ms (this one is 100 ms) and the
 * dip-and-rise pass wanted a measurable RMS dip (this one only rises). With no
 * articulation onset, mergeSamePitchWithoutAttack collapsed the two C4s into
 * one, the DTW marked the second expected note MISSED, and the saved score was
 * 0.62 ("fair"), pitch 2/3, rhythm 0.547.
 *
 * The fix gives the gap pass a corroborated lower tier: a gap ≥ the segmenter's
 * own 75 ms split threshold counts as a re-articulation when the RMS clearly
 * steps up across it (a re-attack a sustain dropout never produces).
 */
describe('pitch replay regression: Flat Five Chromatic Up short-gap re-articulation (concert G, 2026-06-21)', () => {
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-06-21-flat-five-chromatic-up.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// bc-045_G as the scorer saw it: a repeated C4 then D4.
	const expectedPhrase: Phrase = {
		id: 'bc-045_G',
		name: 'Flat Five Chromatic Up',
		timeSignature: [4, 4],
		key: 'G',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C4
			{ pitch: 60, duration: [1, 4], offset: [1, 4] }, // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }  // D4
		],
		harmony: [],
		difficulty: { level: 15, pitchComplexity: 16, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};

	// Mirror the production ear-training path: resolveOnsets →
	// findReArticulations → segmentNotes(..., articulationOnsets). No backing
	// track was used, so no bleed onsets.
	async function detectFromFixture() {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		return segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);
	}

	it('segments into three notes [C, C, D] instead of merging the two C4s', async () => {
		const detected = await detectFromFixture();

		expect(detected.map((n) => n.midi)).toEqual([60, 60, 62]);
		// Second C4 re-articulation lands in the 0.40–0.55 s window.
		expect(detected[1].onsetTime).toBeGreaterThan(0.35);
		expect(detected[1].onsetTime).toBeLessThan(0.6);
	});

	it('scores three matched notes with high overall', async () => {
		const detected = await detectFromFixture();

		const result = runScorePipeline({
			detected,
			phrase: expectedPhrase,
			tempo: 100,
			transportSeconds: 0,
			swing: 0.65,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		for (const nr of result.chosen.noteResults) {
			expect(nr.missed).toBe(false);
			expect(nr.extra).toBe(false);
		}
		expect(result.chosen.notesHit).toBe(3);
		expect(result.chosen.pitchAccuracy).toBe(1);
		expect(result.chosen.overall).toBeGreaterThan(0.85);
	});
});

/**
 * Sixth regression recording: "Blues Curl Up" (concert D, 2026-06-24). The
 * day's tonality (concert D) snapped the lick's E→F# blue note down to F, so
 * bc-041_D rendered as D F F (quarter quarter half); the player tongued the
 * two Fs in time on tenor sax at 100 BPM, no backing track.
 *
 * This is the SAME dead zone the Flat Five Chromatic Up fix targeted — a soft
 * re-attack the HFC worklet missed, leaving a short reading gap with RISING
 * RMS (no dip for the dip-and-rise scan, < 150 ms for the bare-gap tier) — but
 * with a WEAKER step-up: the pitch detector resumed on the new note's decay
 * shoulder (the attack peak fell inside the 117 ms reading gap), so the
 * measured rise across the gap is only ~1.26× rather than the flat-five ~2×.
 * The short-gap tier's 1.5× floor rejected it, mergeSamePitchWithoutAttack
 * collapsed the two Fs, the third expected note was marked MISSED, and the
 * saved score was 0.627 ("fair"), pitch 2/3.
 *
 * The fix adds the discriminating axis the ratio alone can't supply: a genuine
 * soft-tongue silence emits NO frames across the hole (the worklet missed it,
 * so the octave stabilizer never reset), whereas a stabilizer-reset artifact
 * (e.g. the C-D-C upper-neighbor fixture, whose final-C "gap" is bridged by
 * warmup frames and shows an even LARGER 1.27× rise) is warmup-bridged. Gating
 * the short-gap tier on a true reading-time silence lets the rise floor drop to
 * 1.2× to admit this re-attack without re-admitting the warmup-bridged glitch.
 */
describe('pitch replay regression: Blues Curl Up weak-step-up re-articulation (concert D, 2026-06-24)', () => {
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-06-24-blues-curl-up.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// bc-041_D as the scorer saw it after the tonality snap: D F F.
	const expectedPhrase: Phrase = {
		id: 'bc-041_D',
		name: 'Blues Curl Up',
		timeSignature: [4, 4],
		key: 'D',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }  // F
		],
		harmony: [],
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};

	// Mirror the production ear-training path: resolveOnsets →
	// findReArticulations → segmentNotes(..., articulationOnsets). No backing
	// track was used, so no bleed onsets.
	async function detectFromFixture() {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		return segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);
	}

	it('emits an articulation onset near the second-F attack', async () => {
		const buffer = loadFixture();
		const { readings, onsets } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);

		expect(articulationOnsets.length).toBeGreaterThan(0);
		// The re-attack lands around beat 2 of the phrase (~1.05 s), ±200 ms.
		const nearSecondF = articulationOnsets.some((t) => Math.abs(t - 1.05) < 0.2);
		expect(nearSecondF).toBe(true);
	});

	it('segments into three notes [D, F, F] instead of merging the two Fs', async () => {
		const detected = await detectFromFixture();

		expect(detected.map((n) => n.midi)).toEqual([62, 65, 65]);
		// Third note (second F) re-articulation lands in the 1.0–1.35 s window.
		expect(detected[2].onsetTime).toBeGreaterThan(1.0);
		expect(detected[2].onsetTime).toBeLessThan(1.35);
	});

	it('scores three matched notes with high overall', async () => {
		const detected = await detectFromFixture();

		const result = runScorePipeline({
			detected,
			phrase: expectedPhrase,
			tempo: 100,
			transportSeconds: 0,
			swing: 0.65,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		for (const nr of result.chosen.noteResults) {
			expect(nr.missed).toBe(false);
			expect(nr.extra).toBe(false);
		}
		expect(result.chosen.notesHit).toBe(3);
		expect(result.chosen.pitchAccuracy).toBe(1);
		expect(result.chosen.overall).toBeGreaterThan(0.85);
	});
});

/**
 * Ninth regression recording: "Blues Curl Down" (concert Bb, 2026-06-25).
 * The softest re-articulation seen so far. Phrase Db Db Bb (quarter quarter
 * half, bc-042_Bb) on tenor sax at 100 BPM, no backing track. The player
 * tongued the second Db with a *legato* tongue at t ≈ 0.47 s — the airflow
 * never stopped, so unlike every prior curl fixture there is NO reading gap
 * and NO envelope dip (rms actually rises across the attack), and the clarity
 * dip is only ~0.04 (under RE_ARTICULATION_CLARITY_DROP). The worklet's
 * amplitude-weighted HFC never moved (it fired only at the Db→Bb transition,
 * 1.09 s, plus three post-phrase key clicks), so the live segmenter saw two
 * notes (one long Db, one Bb) and the DTW marked the second Db MISSED. The
 * saved score was 0.631 ("fair"), pitch 2/3.
 *
 * What the prior passes can't see and the fix adds:
 *   - The re-attack injects a broadband high-frequency burst: the per-frame
 *     `hfRms` (RMS of the first-difference high-pass, captured in detectFrame)
 *     spikes ~0.012 → 0.067 (≈5.5×) at t ≈ 0.47 s while midiFloat dips
 *     61.1 → 60.94 (the reed resetting).
 *   - `findReArticulations`' HF-transient tier fires on that spike, gated on a
 *     coincident fundamental perturbation (≥0.1 st) so a superimposed key
 *     click — broadband but leaving the fundamental steady — is rejected.
 *   - The synthetic onset splits the long Db into two and reinforces the
 *     boundary as attack evidence, so DTW aligns 3-to-3.
 *
 * Because the fix lives in detectFrame (hfRms), only the WAV-replay path
 * exercises it — readings restored from the saved diagnostic JSON predate the
 * hfRms field and deliberately skip the HF tier.
 */
describe('pitch replay regression: Blues Curl Down legato-tongue re-articulation (concert Bb, 2026-06-25)', () => {
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-06-25-blues-curl-down.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// bc-042_Bb: Db Db Bb (the blue third tongued twice, curling down to root).
	const expectedPhrase: Phrase = {
		id: 'bc-042_Bb',
		name: 'Blues Curl Down',
		timeSignature: [4, 4],
		key: 'Bb',
		notes: [
			{ pitch: 61, duration: [1, 4], offset: [0, 1] }, // Db
			{ pitch: 61, duration: [1, 4], offset: [1, 4] }, // Db
			{ pitch: 58, duration: [1, 2], offset: [1, 2] }  // Bb
		],
		harmony: [],
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};

	// Mirror the production ear-training path. No backing track → no bleed onsets.
	async function detectFromFixture() {
		const buffer = loadFixture();
		const { readings, onsets, duration } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		return segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);
	}

	it('emits an HF-transient articulation onset near the second-Db attack', async () => {
		const buffer = loadFixture();
		const { readings, onsets } = await replayFromAudioBuffer(buffer);
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);

		expect(articulationOnsets.length).toBeGreaterThan(0);
		// The legato re-attack lands around beat 1 (~0.47 s), ±0.2 s.
		const nearSecondDb = articulationOnsets.some((t) => Math.abs(t - 0.47) < 0.2);
		expect(nearSecondDb).toBe(true);
	});

	it('segments into three notes [Db, Db, Bb] instead of merging the two Dbs', async () => {
		const detected = await detectFromFixture();

		expect(detected.map((n) => n.midi)).toEqual([61, 61, 58]);
		// Second Db re-articulation lands in the 0.35–0.65 s window.
		expect(detected[1].onsetTime).toBeGreaterThan(0.35);
		expect(detected[1].onsetTime).toBeLessThan(0.65);
	});

	it('scores three matched notes with high overall', async () => {
		const detected = await detectFromFixture();

		const result = runScorePipeline({
			detected,
			phrase: expectedPhrase,
			tempo: 100,
			transportSeconds: 0,
			swing: 0.65,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		for (const nr of result.chosen.noteResults) {
			expect(nr.missed).toBe(false);
			expect(nr.extra).toBe(false);
		}
		expect(result.chosen.notesHit).toBe(3);
		expect(result.chosen.pitchAccuracy).toBe(1);
		expect(result.chosen.overall).toBeGreaterThan(0.85);
	});
});

/**
 * Guard for the HF-transient pass against a McLeod octave artifact, on the
 * WAV-replay path (the JSON-fixture test for this recording exercises the
 * saved-readings path, which predates hfRms and never runs the HF tier).
 *
 * "Octave–Flat Seven Drop" (concert D, 2026-05-19): the true phrase collapses
 * to [D4, C4]. Mid-phrase, McLeod locks onto the C4's second harmonic for a
 * stretch, producing a spurious C5 (midi 72) run. That run is broadband AND
 * pitch-unstable (the detector flips ~0.33 st), so it clears the HF-spike and
 * pitch-perturbation gates — but it sits on a DECAYING envelope (post/pre rms
 * ≈ 0.61). Without the rms-sustain gate the HF pass emitted an articulation
 * onset at ~1.6 s, which blocked mergeOctaveBoundariesWithoutAttack and left
 * the C5 artifact uncollapsed ([62, 72, 72, 72, 60]). The energy-sustain
 * corroborator rejects it, so the octave collapse runs and the result is the
 * correct [D4, C4]. (A real re-attack adds energy; an artifact on a fading note
 * does not — see HF_RE_ARTICULATION_MIN_RMS_SUSTAIN.)
 */
describe('pitch replay regression: HF pass does not split a McLeod octave artifact (concert D, 2026-05-19)', () => {
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-05-19-octave-flat-seven-drop.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	it('emits no articulation onset inside the C5 artifact region (~1.1–2.0 s)', async () => {
		const { readings, onsets } = await replayFromAudioBuffer(loadFixture());
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);

		const insideArtifact = articulationOnsets.filter((t) => t > 1.1 && t < 2.0);
		expect(insideArtifact).toEqual([]);
	});

	it('collapses to [D4, C4] — the HF split no longer blocks the octave merge', async () => {
		const { readings, onsets, duration } = await replayFromAudioBuffer(loadFixture());
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			readings,
			allOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);

		expect(detected.map((n) => n.midi)).toEqual([62, 60]);
	});
});

describe('pitch replay regression: Fifth–Sixth Step subharmonic octave drop (concert Bb, 2026-06-30)', () => {
	// Real recording: the user played a clean F3 → G3 ("Fifth–Sixth Step" in
	// concert Bb) on tenor sax, in the correct octave. On the sustained first
	// note the McLeod detector locked onto the octave-DOWN subharmonic F2
	// (≈87.8 Hz) of the true F3 (≈175.6 Hz) — and because the subharmonic frames
	// carry HIGHER clarity, every downstream octave decision resolved note 1 to
	// the wrong lower octave (MIDI 41), scoring it "octave-low" though it was
	// played right (saved diagnostic: pitch 0.5, "try-again").
	//
	// The autocorrelation can't tell this subharmonic from a genuine low note,
	// nor from the OPPOSITE octave-up 2nd-harmonic lock the Octave–Flat Seven
	// Drop fixture relies on the segmenter to collapse DOWN — they are identical
	// at the MIDI/clarity/NSDF level. The SPECTRUM separates them: a subharmonic
	// has essentially no energy at the reported frequency (all the energy is an
	// octave up), whereas a real low note keeps a substantial fundamental. The
	// detector's correctSubharmonic (pitch-frame.ts) makes exactly that check
	// per frame and lifts note 1 back to F3.
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-06-30-fifth-sixth-step.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// bc-010_Bb rendered in the player's chosen register: concert F3 → G3.
	const phrase: Phrase = {
		id: 'bc-010_Bb',
		name: 'Fifth–Sixth Step',
		timeSignature: [4, 4],
		key: 'Bb',
		notes: [
			{ pitch: 53, duration: [1, 2], offset: [0, 1] }, // F3
			{ pitch: 55, duration: [1, 2], offset: [1, 2] } // G3
		],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	};

	it('detects the two notes in the octave the user actually played (F3, G3)', async () => {
		const { readings, onsets, duration } = await replayFromAudioBuffer(loadFixture());
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(
			readings,
			resolved,
			duration,
			undefined,
			undefined,
			undefined,
			onsets
		);

		// Pre-fix the detector reported the F2 subharmonic and this came out
		// [41, 55]; the subharmonic correction lifts note 1 to its true F3.
		expect(detected.map((n) => n.midi)).toEqual([53, 55]);
	});

	it('scores the correctly-played phrase as a full pitch match', async () => {
		const { readings, onsets, duration } = await replayFromAudioBuffer(loadFixture());
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(
			readings,
			resolved,
			duration,
			undefined,
			undefined,
			undefined,
			onsets
		);
		const result = runScorePipeline({
			detected,
			phrase,
			tempo: 100,
			transportSeconds: 0,
			swing: 0.65,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		// Saved diagnostic (pre-fix): pitch 0.5, notesHit 1, "try-again".
		expect(result.chosen.pitchAccuracy).toBeCloseTo(1, 5);
		expect(result.chosen.notesHit).toBe(2);
		expect(result.chosen.notesTotal).toBe(2);
	});
});

describe('pitch replay regression: Third–Fifth Rise masked-fundamental octave lift (concert C, 2026-07-14)', () => {
	// Real recording: the user played a clean E3 → G3 ("Third–Fifth Rise" in
	// concert C, rendered an octave below the canonical bc-005 register) on
	// tenor sax. Pitchy detected the E3 correctly (~165 Hz) on essentially
	// every frame — but the note's fundamental radiates almost nothing
	// (mag(f)/mag(2f) ≈ 0.02–0.06), which is INSIDE the band the 2026-06-30
	// subharmonic corrector treats as "no real energy at f ⇒ artifact". So
	// correctSubharmonic doubled every correctly-detected frame to E4
	// (MIDI 64) before it entered the MIDI stream, and the whole first note
	// scored octave-high (saved diagnostic: pitch 0.5, overall 0.66, "fair").
	//
	// This is the mirror-image failure of the Fifth–Sixth Step fixture above:
	// there the reported f was spectrally empty because it was a period-doubling
	// artifact; here it is spectrally empty because low tenor notes can mask
	// their own fundamental. The ODD harmonics break the tie — 3f/5f are
	// full-rank harmonics of a genuine low note (measured (3f+5f)/(2f+4f)
	// ≥ 0.26) but only weak period-doubling sidebands of an artifact (≤ 0.05).
	// correctSubharmonic now requires the odd-harmonic ratio to be low before
	// doubling; the Fifth–Sixth Step tests above pin the artifact side.
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-07-14-third-fifth-rise.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// bc-005_C rendered in the player's chosen register: concert E3 → G3.
	const phrase: Phrase = {
		id: 'bc-005_C',
		name: 'Third–Fifth Rise',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 52, duration: [1, 2], offset: [0, 1] }, // E3
			{ pitch: 55, duration: [1, 2], offset: [1, 2] } // G3
		],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	};

	it('detects the two notes in the octave the user actually played (E3, G3)', async () => {
		const { readings, onsets, duration } = await replayFromAudioBuffer(loadFixture());
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(
			readings,
			resolved,
			duration,
			undefined,
			undefined,
			undefined,
			onsets
		);

		// Pre-fix correctSubharmonic doubled the masked-fundamental E3 to E4
		// and this came out [64, 55]; the odd-harmonic gate keeps it at E3.
		expect(detected.map((n) => n.midi)).toEqual([52, 55]);
	});

	it('scores the correctly-played phrase as a full pitch match', async () => {
		const { readings, onsets, duration } = await replayFromAudioBuffer(loadFixture());
		const resolved = resolveOnsets(onsets, readings);
		const detected = segmentNotes(
			readings,
			resolved,
			duration,
			undefined,
			undefined,
			undefined,
			onsets
		);
		const result = runScorePipeline({
			detected,
			phrase,
			tempo: 105,
			transportSeconds: 0,
			swing: 0.6,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		// Saved diagnostic (pre-fix): pitch 0.5, notesHit 1, overall 0.66 "fair".
		expect(result.chosen.pitchAccuracy).toBeCloseTo(1, 5);
		expect(result.chosen.notesHit).toBe(2);
		expect(result.chosen.notesTotal).toBe(2);
	});
});

/**
 * Blue Monk tied final-note regression (concert C, 2026-07-23). End-to-end
 * companion to the readings-replay test in audio-processing-pipeline.test.ts.
 *
 * The "Blue Monk" head ends on a held E notated as an eighth-note E (offset
 * 7/8) TIED into a half-note E on the next downbeat. The player sustained a
 * single E across the tie, and — replaying the real audio through the
 * production detection path — segmentation captures it as ONE long E segment
 * (~4.9 s), exactly as the live app did (matches the saved diagnostic's
 * `detection.segmentedNotes`).
 *
 * Pre-fix the scorer treated the phrase as all nine notated notes, matched the
 * one detected E to the tied eighth, and marked the half-note continuation
 * MISSED — pitch 0.889 / overall 0.880 "great" with a red final note. Post-fix
 * scoreAttempt collapses tied same-pitch chains (see scorer.ts), so the eight
 * sounding notes all match and the whole chain — real audio → detection →
 * segmentation → scoring — grades "perfect". This guards the fix against a
 * future detection/segmentation change silently re-splitting the held note.
 */
describe('pitch replay regression: Blue Monk tied final note (concert C, 2026-07-23)', () => {
	function loadFixture(): FakeAudioBuffer {
		const wav = loadWavFixture('recordings/2026-07-23-blue-monk.wav');
		return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
	}

	// The Blue Monk head as the scorer saw it: G A G F# F g(low) E♭ E–E, the
	// last two E's joined by a tie.
	const expectedPhrase: Phrase = {
		id: 'blue-monk-tied-final-note',
		name: 'Blue Monk',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, offset: [0, 1], duration: [1, 8] },
			{ pitch: 69, offset: [1, 8], duration: [1, 8] },
			{ pitch: 67, offset: [1, 4], duration: [1, 8] },
			{ pitch: 66, offset: [3, 8], duration: [1, 8] },
			{ pitch: 65, offset: [1, 2], duration: [1, 8] },
			{ pitch: 55, offset: [5, 8], duration: [1, 8] },
			{ pitch: 63, offset: [3, 4], duration: [1, 8], spelling: 'flat' },
			{ pitch: 64, offset: [7, 8], duration: [1, 8], tied: true },
			{ pitch: 64, offset: [1, 1], duration: [1, 2] }
		],
		harmony: [],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 2 },
		category: 'blues',
		tags: [],
		source: 'user'
	};

	// Mirror the production replay path (diagnostics / ear-training):
	// resolveOnsets → findReArticulations → segmentNotes(..., worklet, artic).
	// No backing track was used, so no bleed onsets.
	async function detectFromFixture(): Promise<DetectedNote[]> {
		const { readings, onsets, duration } = await replayFromAudioBuffer(loadFixture());
		const baseOnsets = resolveOnsets(onsets, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets);
		const resolvedOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		return segmentNotes(
			readings,
			resolvedOnsets,
			duration,
			undefined,
			undefined,
			undefined,
			onsets,
			undefined,
			articulationOnsets
		);
	}

	it('captures the tied final E as a single sustained detected note', async () => {
		const detected = await detectFromFixture();

		// Reproduces the saved diagnostic's segmentation. The doubled 55 is a
		// pre-existing ~46 ms low-G blip at ~2.97 s (a detector artifact ahead of
		// the real low G) — orthogonal to the tie fix; it scores as a harmless
		// extra, never a miss.
		expect(detected.map((n) => n.midi)).toEqual([67, 69, 67, 66, 65, 55, 55, 63, 64]);

		// The crux: the tie is ONE detected E, held long — not two notes.
		expect(detected.filter((n) => n.midi === 64)).toHaveLength(1);
		const last = detected[detected.length - 1];
		expect(last.midi).toBe(64);
		expect(last.duration).toBeGreaterThan(2);
	});

	it('scores the tied final note as a hit end-to-end — "perfect"', async () => {
		const detected = await detectFromFixture();
		const result = runScorePipeline({
			detected,
			phrase: expectedPhrase,
			tempo: 54,
			transportSeconds: 0,
			swing: 0.6,
			bleedFilterEnabled: false,
			octaveInsensitive: false
		});

		// Eight sounding notes after the tie merge, all matched — no missed note.
		// (One extra: the benign low-G blip above, which doesn't affect scoring.)
		expect(result.chosen.noteResults.some((n) => n.missed)).toBe(false);
		expect(result.chosen.notesHit).toBe(8);
		expect(result.chosen.notesTotal).toBe(8);

		// Saved diagnostic (pre-fix): pitch 0.889 (final note missed), overall
		// 0.880 "great". Post-fix the whole chain grades "perfect".
		expect(result.chosen.pitchAccuracy).toBeCloseTo(1, 5);
		expect(result.chosen.rhythmAccuracy).toBeGreaterThan(0.9);
		expect(result.chosen.overall).toBeGreaterThan(0.95);
		expect(result.chosen.grade).toBe('perfect');
	});
});

/**
 * 2026-07-25 fixtures: three ear-training takes at 105 BPM (concert C, tenor
 * sax) with the metronome mixed into the recording, each mis-scored by a
 * different interaction of soft on-beat re-articulations and metronome
 * clicks. The clicks sit exactly on the beat grid in recording time (the
 * recorder mixes the metronome electrically, so scheduled time ≈ blob time):
 * root-frame 0.449 + k·0.5714 s, blue-note-step-up 0.080 + k·0.5714 s,
 * blue-step-down 0.387 + k·0.5714 s — reconstructed from the beat-spaced
 * worklet bleed onsets each recording captured. The representative
 * `recordingTransportSeconds` below reproduce those grids through
 * getMetronomeBleedOnsets, mirroring the production ear-training path
 * (metronome was on for all three takes).
 *
 * Three distinct root causes, all fixed at the detection layer:
 *
 *   1. Onset-guard provenance (root-frame): the 80 ms post-onset guard ate
 *      five of the six B♭ frames of a segment whose boundary was a
 *      PITCH-derived stable-run start (no amplitude attack to guard
 *      against), letting a McLeod C3 subharmonic glitch win the segment
 *      vote — the sandwich collapse then swallowed C–B♭–C into one long C.
 *      segmentNotes now guards only amplitude-derived boundaries.
 *
 *   2. Click-fabricated attack evidence (root-frame, blue-step-down): a
 *      click on a held note clears every HF-tier gate (hfRms spike, ~0.14 st
 *      McLeod perturbation, sustained energy) and can silence the pitch
 *      tracker for 150 ms+ on a decaying note (fabricating a bare-gap
 *      re-articulation). The HF tier now suppresses spikes inside a
 *      scheduled click's contamination window, and the bare-gap tier
 *      requires energy sustain across the hole (a real tongue stop ends in
 *      a fresh attack: the 2026-05-22 fixtures measure 0.94–0.97 post/pre;
 *      the click-on-decay counterexample measures 0.67).
 *
 *   3. Envelope aliasing (both blue-note fixtures): the soft on-beat tongue
 *      dips the raw envelope 30–45% for 20–30 ms, which the ~93 ms
 *      window-level RMS smooths down to a 17% wiggle — under every
 *      reading-level threshold. detectFrame now records `rmsMin` (min
 *      sliding ~11.6 ms sub-window RMS) and findReArticulations' envelope
 *      dip-recover pass detects the dip, corroborated by tongue noise
 *      (hfRms) or a reed-reset pitch perturbation — corroborators a
 *      metronome click (which only ADDS energy) cannot fake alongside a
 *      dip, and which a breath pulse on a held note (Blue Monk, ~4.0 s)
 *      lacks.
 */
describe('pitch replay regression: 2026-07-25 metronome-click / soft-tongue trio (concert C)', () => {
	const TEMPO = 105;
	const SWING = 0.6;
	const BEAT = 60 / TEMPO;

	interface TrioCase {
		name: string;
		file: string;
		/** Reproduces the observed click grid via getMetronomeBleedOnsets. */
		recordingTransportSeconds: number;
		phrase: Phrase;
		expectedMidis: number[];
		/** [index, minOnset, maxOnset] checks on recovered re-articulations */
		onsetWindows: [number, number, number][];
		/** Pre-fix saved score, for documentation/regression context */
		savedOverall: number;
	}

	const mkPhrase = (id: string, name: string, notes: Phrase['notes']): Phrase => ({
		id,
		name,
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: [],
		difficulty: { level: 14, pitchComplexity: 16, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: [],
		source: 'curated'
	});

	const cases: TrioCase[] = [
		{
			// blues-039 "Root Frame": C B♭ C G. Saved score 0.445 "try-again" on a
			// clean take — B♭ swallowed (cause 1), held G split by the click at
			// 2.74 s (cause 2/HF).
			name: 'root-frame',
			file: 'recordings/2026-07-25-root-frame.wav',
			recordingTransportSeconds: 16 * BEAT - 0.44875,
			phrase: mkPhrase('blues-039', 'Root Frame', [
				{ pitch: 60, duration: [1, 8], offset: [0, 1] },
				{ pitch: 58, duration: [1, 8], offset: [1, 8] },
				{ pitch: 60, duration: [1, 4], offset: [1, 4] },
				{ pitch: 67, duration: [3, 2], offset: [1, 2] }
			]),
			expectedMidis: [60, 58, 60, 67],
			onsetWindows: [[1, 0.25, 0.32]],
			savedOverall: 0.445
		},
		{
			// bbn-009_C "Blue Note Step-Up" after the day's tonality snapped the
			// F♯ blue note down to F: F F G. Saved score 0.655 "fair" — the two
			// tongued Fs merged (cause 3), second note MISSED.
			name: 'blue-note-step-up',
			file: 'recordings/2026-07-25-blue-note-step-up.wav',
			recordingTransportSeconds: 16 * BEAT - 0.0803,
			phrase: mkPhrase('bbn-009_C', 'Blue Note Step-Up', [
				{ pitch: 53, duration: [1, 4], offset: [0, 1] },
				{ pitch: 53, duration: [1, 4], offset: [1, 4] },
				{ pitch: 55, duration: [1, 2], offset: [1, 2] }
			]),
			expectedMidis: [53, 53, 55],
			onsetWindows: [[1, 0.6, 0.78]],
			savedOverall: 0.655
		},
		{
			// bbn-041 "Blue Step Down" after the same F♯→F snap: G F F E♭ C.
			// Saved score 0.634 "fair" — repeated-F merge (cause 3) plus the
			// held final C split by a click-induced 167 ms tracking hole
			// (cause 2/bare-gap), cascading DTW into two pitch mismatches.
			name: 'blue-step-down',
			file: 'recordings/2026-07-25-blue-step-down.wav',
			recordingTransportSeconds: 16 * BEAT - 0.3874,
			phrase: mkPhrase('bbn-041', 'Blue Step Down', [
				{ pitch: 67, duration: [1, 4], offset: [0, 1] },
				{ pitch: 65, duration: [1, 8], offset: [1, 4] },
				{ pitch: 65, duration: [1, 8], offset: [3, 8] },
				{ pitch: 63, duration: [1, 4], offset: [1, 2] },
				{ pitch: 60, duration: [1, 2], offset: [3, 4] }
			]),
			expectedMidis: [67, 65, 65, 63, 60],
			onsetWindows: [[2, 0.72, 0.9]],
			savedOverall: 0.634
		}
	];

	for (const c of cases) {
		describe(c.name, () => {
			function loadFixture(): FakeAudioBuffer {
				const wav = loadWavFixture(c.file);
				return makeFakeAudioBuffer(wav.channel, wav.sampleRate);
			}

			// Mirror the production ear-training path with metronome enabled:
			// resolveOnsets → bleed onsets → findReArticulations(…, bleed) →
			// segmentNotes(…, worklet, bleed, articulations).
			async function detectFromFixture(): Promise<DetectedNote[]> {
				const { readings, onsets, duration } = await replayFromAudioBuffer(loadFixture());
				const baseOnsets = resolveOnsets(onsets, readings);
				const bleedOnsets = getMetronomeBleedOnsets(
					c.recordingTransportSeconds,
					TEMPO,
					duration
				);
				const articulationOnsets = findReArticulations(readings, baseOnsets, bleedOnsets);
				const allOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
				return segmentNotes(
					readings,
					allOnsets,
					duration,
					undefined,
					undefined,
					undefined,
					onsets,
					bleedOnsets,
					articulationOnsets
				);
			}

			it('segments exactly the notes the user played — no merges, no click splits', async () => {
				const detected = await detectFromFixture();
				expect(detected.map((n) => n.midi)).toEqual(c.expectedMidis);
				for (const [idx, min, max] of c.onsetWindows) {
					expect(detected[idx].onsetTime).toBeGreaterThan(min);
					expect(detected[idx].onsetTime).toBeLessThan(max);
				}
			});

			it('scores every note as a hit with a high overall', async () => {
				const detected = await detectFromFixture();
				const result = runScorePipeline({
					detected,
					phrase: c.phrase,
					tempo: TEMPO,
					transportSeconds: 0,
					swing: SWING,
					bleedFilterEnabled: false,
					octaveInsensitive: false
				});

				for (const nr of result.chosen.noteResults) {
					expect(nr.missed).toBe(false);
					expect(nr.extra).toBe(false);
				}
				expect(result.chosen.notesHit).toBe(c.phrase.notes.length);
				expect(result.chosen.pitchAccuracy).toBeCloseTo(1, 5);
				// Every saved (pre-fix) score sat in the 0.44–0.66 band on what
				// were clean takes; post-fix all three clear 0.9.
				expect(result.chosen.overall).toBeGreaterThan(0.9);
				expect(result.chosen.overall).toBeGreaterThan(c.savedOverall);
			});
		});
	}
});

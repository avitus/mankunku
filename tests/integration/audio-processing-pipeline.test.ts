/**
 * Integration tests for the audio processing pipeline:
 * onset detection → note segmentation → quantization → scoring.
 *
 * All functions in this chain are pure — no mocking needed.
 * Synthetic PitchReading arrays simulate mic input at 60 fps.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createOnsetState,
	processOnsetFrame,
	SETTLE_FRAMES,
	MIN_ONSET_INTERVAL,
} from '$lib/audio/onset-core';
import {
	segmentNotes,
	validateOnsets,
	extractOnsetsFromReadings,
	resolveOnsets,
	getMetronomeBleedOnsets,
	findReArticulations
} from '$lib/audio/note-segmenter';
import { quantizeNotes, detectKey } from '$lib/audio/quantizer';
import { scoreAttempt } from '$lib/scoring/scorer';
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase, Note } from '$lib/types/music';

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Build a PitchReading array from a compact note description.
 * Each note produces `duration * fps` frames of constant pitch.
 */
function makeReadings(
	notes: { midi: number; startTime: number; duration: number }[],
	fps = 60
): PitchReading[] {
	const readings: PitchReading[] = [];
	for (const note of notes) {
		const frameCount = Math.round(note.duration * fps);
		for (let i = 0; i < frameCount; i++) {
			const time = note.startTime + i / fps;
			readings.push({
				midi: note.midi,
				midiFloat: note.midi,
				cents: 0,
				clarity: 0.95,
				time,
				frequency: 440 * Math.pow(2, (note.midi - 69) / 12),
				rms: 0.1,
			});
		}
	}
	return readings;
}

/**
 * Build a minimal Phrase for scoring tests.
 */
function makePhrase(
	notes: { pitch: number; offset: [number, number]; duration: [number, number] }[]
): Phrase {
	return {
		id: 'test',
		name: 'Test',
		category: 'blues',
		notes: notes.map((n) => ({
			pitch: n.pitch,
			offset: n.offset,
			duration: n.duration,
		})),
		key: 'C',
		harmony: [
			{
				chord: { root: 'C', quality: '7' as const },
				scaleId: 'major.mixolydian',
				startOffset: [0, 1] as [number, number],
				duration: [4, 4] as [number, number],
			},
		],
		difficulty: {
			level: 20,
			pitchComplexity: 20,
			rhythmComplexity: 20,
			lengthBars: 1,
		},
		source: 'curated' as const,
		tags: [],
		timeSignature: [4, 4] as [number, number],
	};
}

/**
 * Build a Float32Array representing a loud audio frame.
 * Amplitude controls the RMS energy; n is the frame size.
 */
function makeLoudFrame(n = 128, amplitude = 0.5): Float32Array {
	const buf = new Float32Array(n);
	// Produce a sawtooth-like signal so HFC (weighted by bin index) is high
	for (let i = 0; i < n; i++) {
		buf[i] = amplitude * ((i / n) * 2 - 1);
	}
	return buf;
}

/** Build a silent frame (all zeros). */
function makeSilentFrame(n = 128): Float32Array {
	return new Float32Array(n);
}

// ─── Onset Detection (onset-core) ─────────────────────────────────

describe('onset detection (onset-core)', () => {
	it('processOnsetFrame detects onset after silence', () => {
		const state = createOnsetState();
		// First, build up the EMA with loud frames through the settle window
		for (let i = 0; i < SETTLE_FRAMES + 2; i++) {
			processOnsetFrame(makeLoudFrame(128, 0.3), state, i * 0.003);
		}
		// Now feed silence to let the EMA decay — this is what makes the
		// next loud frame register as an onset (high ratio vs decayed EMA)
		for (let i = 0; i < 20; i++) {
			processOnsetFrame(makeSilentFrame(), state, 0.05 + i * 0.003);
		}
		// Loud frame after silence — HFC/smoothedEnergy ratio should spike
		const event = processOnsetFrame(makeLoudFrame(), state, 0.2);
		expect(event).not.toBeNull();
		expect(event!.onset).toBe(true);
		expect(event!.time).toBe(0.2);
	});

	it('processOnsetFrame respects SETTLE_FRAMES', () => {
		const state = createOnsetState();
		const events: ReturnType<typeof processOnsetFrame>[] = [];
		// Feed loud frames for exactly SETTLE_FRAMES — none should produce onset
		for (let i = 0; i < SETTLE_FRAMES; i++) {
			events.push(processOnsetFrame(makeLoudFrame(), state, i * 0.003));
		}
		// All within the settle window should return null
		expect(events.every((e) => e === null)).toBe(true);
		expect(state.frameCount).toBe(SETTLE_FRAMES);
	});

	it('processOnsetFrame respects MIN_ONSET_INTERVAL', () => {
		const state = createOnsetState();
		// Build up EMA through settle window with moderate signal
		for (let i = 0; i < SETTLE_FRAMES + 2; i++) {
			processOnsetFrame(makeLoudFrame(128, 0.3), state, i * 0.003);
		}
		// Decay EMA with silence so the next loud frame triggers an onset
		for (let i = 0; i < 20; i++) {
			processOnsetFrame(makeSilentFrame(), state, 0.050 + i * 0.003);
		}

		// First loud frame → onset
		const first = processOnsetFrame(makeLoudFrame(), state, 0.200);
		expect(first).not.toBeNull();

		// Decay EMA again so the next loud frame would trigger if not for interval
		for (let i = 0; i < 10; i++) {
			processOnsetFrame(makeSilentFrame(), state, 0.210 + i * 0.003);
		}

		// Second loud frame within MIN_ONSET_INTERVAL of first → suppressed
		const tooSoon = processOnsetFrame(
			makeLoudFrame(),
			state,
			0.200 + MIN_ONSET_INTERVAL * 0.5
		);
		expect(tooSoon).toBeNull();

		// Decay EMA again, then fire well past MIN_ONSET_INTERVAL
		for (let i = 0; i < 20; i++) {
			processOnsetFrame(makeSilentFrame(), state, 0.300 + i * 0.003);
		}
		const later = processOnsetFrame(
			makeLoudFrame(),
			state,
			0.200 + MIN_ONSET_INTERVAL + 0.10
		);
		expect(later).not.toBeNull();
	});
});

// ─── Note Segmentation ────────────────────────────────────────────

describe('note segmentation', () => {
	it('segmentNotes produces one note per onset boundary', () => {
		// 3 notes: C4 for 300ms, E4 for 300ms, G4 for 300ms
		const readings = makeReadings([
			{ midi: 60, startTime: 0.0, duration: 0.3 },
			{ midi: 64, startTime: 0.3, duration: 0.3 },
			{ midi: 67, startTime: 0.6, duration: 0.3 },
		]);
		const onsets = [0.0, 0.3, 0.6];
		const recordingDuration = 0.9;

		const notes = segmentNotes(readings, onsets, recordingDuration);

		expect(notes).toHaveLength(3);
		expect(notes[0].midi).toBe(60);
		expect(notes[1].midi).toBe(64);
		expect(notes[2].midi).toBe(67);
		// Durations should roughly match the segment boundaries
		expect(notes[0].duration).toBeCloseTo(0.3, 1);
		expect(notes[1].duration).toBeCloseTo(0.3, 1);
		expect(notes[2].duration).toBeCloseTo(0.3, 1);
	});

	it('segmentNotes handles legato pitch change', () => {
		// One onset at 0.0, but pitch changes from C4 to E4 mid-segment
		// Each sub-pitch needs enough frames to trigger splitByPitchChange
		const readings = makeReadings([
			{ midi: 60, startTime: 0.0, duration: 0.3 },
			{ midi: 64, startTime: 0.3, duration: 0.3 },
		]);
		const onsets = [0.0]; // Single onset — no amplitude boundary
		const recordingDuration = 0.6;

		const notes = segmentNotes(readings, onsets, recordingDuration);

		// The legato pitch change should produce 2 sub-segment notes
		expect(notes.length).toBe(2);
		expect(notes[0].midi).toBe(60);
		expect(notes[1].midi).toBe(64);
	});

	it('validateOnsets filters onsets without nearby pitch readings', () => {
		const readings = makeReadings([
			{ midi: 60, startTime: 0.5, duration: 0.3 },
		]);
		// Onset at 0.0 has no readings within the 0.15s window
		// Onset at 0.5 has readings starting right at 0.5
		const onsets = [0.0, 0.5];

		const validated = validateOnsets(onsets, readings);

		expect(validated).toContain(0.5);
		expect(validated).not.toContain(0.0);
		expect(validated).toHaveLength(1);
	});
});

// ─── Quantization ─────────────────────────────────────────────────

describe('quantization', () => {
	it('quantizeNotes converts quarter-note timings to correct fractions', () => {
		// 4 notes at exact 0.5s intervals at 120 BPM (beat = 0.5s)
		const detected: DetectedNote[] = [
			{ midi: 60, cents: 0, onsetTime: 0.0, duration: 0.45, clarity: 0.95 },
			{ midi: 64, cents: 0, onsetTime: 0.5, duration: 0.45, clarity: 0.95 },
			{ midi: 67, cents: 0, onsetTime: 1.0, duration: 0.45, clarity: 0.95 },
			{ midi: 72, cents: 0, onsetTime: 1.5, duration: 0.45, clarity: 0.95 },
		];
		const tempo = 120;
		const timeSignature: [number, number] = [4, 4];

		const quantized = quantizeNotes(detected, tempo, timeSignature);

		// Filter out rests
		const pitched = quantized.filter((n) => n.pitch !== null);
		expect(pitched).toHaveLength(4);

		// At 120 BPM: whole note = 2s, beat = 0.5s = quarter note
		// Expected offsets: 0/1, 1/4, 1/2, 3/4 (fractions of whole note)
		expect(pitched[0].offset).toEqual([0, 1]);
		expect(pitched[1].offset).toEqual([1, 4]);
		expect(pitched[2].offset).toEqual([1, 2]);
		expect(pitched[3].offset).toEqual([3, 4]);

		// Each note duration should be a quarter note [1,4]
		for (const note of pitched) {
			expect(note.duration).toEqual([1, 4]);
		}
	});

	it('quantizeNotes extends note duration to fill gap before next note', () => {
		// 2 notes with a gap between them — the quantizer fills the gap by
		// extending the first note's duration to reach the second note's
		// grid position (no rest is inserted between consecutive non-skipped notes)
		const detected: DetectedNote[] = [
			{ midi: 60, cents: 0, onsetTime: 0.0, duration: 0.25, clarity: 0.95 },
			{ midi: 64, cents: 0, onsetTime: 1.5, duration: 0.25, clarity: 0.95 },
		];
		const tempo = 120;
		const timeSignature: [number, number] = [4, 4];

		const quantized = quantizeNotes(detected, tempo, timeSignature);
		const pitched = quantized.filter((n) => n.pitch !== null);
		expect(pitched).toHaveLength(2);
		expect(pitched[0].pitch).toBe(60);
		expect(pitched[1].pitch).toBe(64);

		// First note at grid 0, second at grid 36 (3/4 of whole note)
		// First note's duration should span the full gap: [3,4]
		expect(pitched[0].offset).toEqual([0, 1]);
		expect(pitched[0].duration).toEqual([3, 4]);
		expect(pitched[1].offset).toEqual([3, 4]);
	});

	it('detectKey returns most frequent pitch class', () => {
		const detected: DetectedNote[] = [
			{ midi: 60, cents: 0, onsetTime: 0.0, duration: 0.5, clarity: 0.95 }, // C
			{ midi: 64, cents: 0, onsetTime: 0.5, duration: 0.5, clarity: 0.95 }, // E
			{ midi: 60, cents: 0, onsetTime: 1.0, duration: 0.5, clarity: 0.95 }, // C
			{ midi: 67, cents: 0, onsetTime: 1.5, duration: 0.5, clarity: 0.95 }, // G
			{ midi: 72, cents: 0, onsetTime: 2.0, duration: 0.5, clarity: 0.95 }, // C (octave)
		];

		// C appears 3 times (MIDI 60 twice + 72 once), E once, G once
		expect(detectKey(detected)).toBe('C');
	});

	it('detectKey returns correct key for non-C dominant pitch', () => {
		const detected: DetectedNote[] = [
			{ midi: 69, cents: 0, onsetTime: 0.0, duration: 0.5, clarity: 0.95 }, // A
			{ midi: 69, cents: 0, onsetTime: 0.5, duration: 0.5, clarity: 0.95 }, // A
			{ midi: 73, cents: 0, onsetTime: 1.0, duration: 0.5, clarity: 0.95 }, // Db
			{ midi: 64, cents: 0, onsetTime: 1.5, duration: 0.5, clarity: 0.95 }, // E
		];

		expect(detectKey(detected)).toBe('A');
	});
});

// ─── Full Audio Processing Pipeline ───────────────────────────────

describe('full audio processing pipeline', () => {
	const tempo = 120;
	// At 120 BPM: beat = 0.5s, bar = 2.0s

	// A simple 4-note phrase: C4 E4 G4 C5, one beat each
	const phrase = makePhrase([
		{ pitch: 60, offset: [0, 1], duration: [1, 4] },
		{ pitch: 64, offset: [1, 4], duration: [1, 4] },
		{ pitch: 67, offset: [1, 2], duration: [1, 4] },
		{ pitch: 72, offset: [3, 4], duration: [1, 4] },
	]);

	it('perfect playback scores > 0.85', () => {
		// Build readings matching the phrase perfectly at 120 BPM
		const readings = makeReadings([
			{ midi: 60, startTime: 0.0, duration: 0.45 },
			{ midi: 64, startTime: 0.5, duration: 0.45 },
			{ midi: 67, startTime: 1.0, duration: 0.45 },
			{ midi: 72, startTime: 1.5, duration: 0.45 },
		]);

		// Extract onsets from the readings (simulates the fallback path)
		const onsets = extractOnsetsFromReadings(readings);
		expect(onsets.length).toBeGreaterThanOrEqual(4);

		// Segment into DetectedNote[]
		const phraseDuration = 2.0;
		const detected = segmentNotes(readings, onsets, phraseDuration);
		expect(detected.length).toBeGreaterThanOrEqual(4);

		// Verify segmented notes have correct pitches
		const pitches = detected.map((d) => d.midi);
		expect(pitches).toContain(60);
		expect(pitches).toContain(64);
		expect(pitches).toContain(67);
		expect(pitches).toContain(72);

		// Score the attempt
		const score = scoreAttempt(phrase, detected, tempo, 0, 0.5);

		expect(score.overall).toBeGreaterThan(0.85);
		expect(score.pitchAccuracy).toBeGreaterThan(0.85);
		expect(score.rhythmAccuracy).toBeGreaterThan(0.7);
		expect(score.notesTotal).toBe(4);
	});

	it('shifted timing reduces rhythm score', () => {
		// All notes shifted +200ms late
		const shift = 0.2;
		const readings = makeReadings([
			{ midi: 60, startTime: 0.0 + shift, duration: 0.45 },
			{ midi: 64, startTime: 0.5 + shift, duration: 0.45 },
			{ midi: 67, startTime: 1.0 + shift, duration: 0.45 },
			{ midi: 72, startTime: 1.5 + shift, duration: 0.45 },
		]);

		const onsets = extractOnsetsFromReadings(readings);
		const phraseDuration = 2.2;
		const detected = segmentNotes(readings, onsets, phraseDuration);

		// Also score a "perfect" version for comparison
		const perfectReadings = makeReadings([
			{ midi: 60, startTime: 0.0, duration: 0.45 },
			{ midi: 64, startTime: 0.5, duration: 0.45 },
			{ midi: 67, startTime: 1.0, duration: 0.45 },
			{ midi: 72, startTime: 1.5, duration: 0.45 },
		]);
		const perfectOnsets = extractOnsetsFromReadings(perfectReadings);
		const perfectDetected = segmentNotes(perfectReadings, perfectOnsets, 2.0);

		const shiftedScore = scoreAttempt(phrase, detected, tempo, 0, 0.5);
		const perfectScore = scoreAttempt(phrase, perfectDetected, tempo, 0, 0.5);

		// Pitch should remain high (correct notes)
		expect(shiftedScore.pitchAccuracy).toBeGreaterThan(0.7);

		// The latency correction in scorer absorbs constant offsets, so the
		// shifted version should still score reasonably. But compared to
		// perfect timing it should be equal or somewhat worse.
		expect(shiftedScore.overall).toBeGreaterThan(0);
		expect(perfectScore.overall).toBeGreaterThanOrEqual(shiftedScore.overall - 0.05);
	});

	it('wrong pitches reduce pitch score', () => {
		// Correct timing but every pitch is one semitone sharp
		const readings = makeReadings([
			{ midi: 61, startTime: 0.0, duration: 0.45 },  // expected 60
			{ midi: 65, startTime: 0.5, duration: 0.45 },  // expected 64
			{ midi: 68, startTime: 1.0, duration: 0.45 },  // expected 67
			{ midi: 73, startTime: 1.5, duration: 0.45 },  // expected 72
		]);

		const onsets = extractOnsetsFromReadings(readings);
		const phraseDuration = 2.0;
		const detected = segmentNotes(readings, onsets, phraseDuration);

		const score = scoreAttempt(phrase, detected, tempo, 0, 0.5);

		// Pitch score should be low (all wrong notes)
		expect(score.pitchAccuracy).toBeLessThan(0.3);
		// Rhythm should still be decent (timing is correct)
		expect(score.rhythmAccuracy).toBeGreaterThan(score.pitchAccuracy);
		// Overall should reflect the bad pitch
		expect(score.overall).toBeLessThan(0.5);
	});

	it('onset extraction into segmentation preserves note count', () => {
		// Verify the onset → segmentation chain preserves note boundaries
		// when readings have clear gaps between notes
		const readings = makeReadings([
			{ midi: 60, startTime: 0.0, duration: 0.2 },
			// 0.15s gap (> GAP_THRESHOLD of 0.1s)
			{ midi: 64, startTime: 0.35, duration: 0.2 },
			// 0.15s gap
			{ midi: 67, startTime: 0.7, duration: 0.2 },
		]);

		const onsets = extractOnsetsFromReadings(readings);
		// Should have 3 onsets: first reading + 2 gap-based
		expect(onsets.length).toBe(3);

		const detected = segmentNotes(readings, onsets, 1.0);
		expect(detected.length).toBe(3);
		expect(detected.map((d) => d.midi)).toEqual([60, 64, 67]);
	});

	it('quantization after segmentation produces valid Note fractions', () => {
		// Full chain: readings → onsets → segment → quantize
		const readings = makeReadings([
			{ midi: 60, startTime: 0.0, duration: 0.45 },
			{ midi: 64, startTime: 0.5, duration: 0.45 },
			{ midi: 67, startTime: 1.0, duration: 0.45 },
		]);

		const onsets = extractOnsetsFromReadings(readings);
		const detected = segmentNotes(readings, onsets, 1.5);
		const quantized = quantizeNotes(detected, tempo, [4, 4]);

		const pitched = quantized.filter((n) => n.pitch !== null);
		expect(pitched.length).toBeGreaterThanOrEqual(3);

		// All fractions should have positive denominators
		for (const note of quantized) {
			expect(note.offset[1]).toBeGreaterThan(0);
			expect(note.duration[1]).toBeGreaterThan(0);
			expect(note.duration[0]).toBeGreaterThan(0);
		}
	});
});

// ─── Fixture regression: Pent 5-3-2-1 half-then-eighths ──────────────
// Real recording from 2026-05-13. The pitch tracker briefly sub-harmonic
// glitches during the held D and drops readings during the held G. Before
// the attack-evidence merge, the segmenter produced 6 notes for a 4-note
// phrase; the DTW scored the wrong pairing and overall came back at 0.80
// "good" instead of "excellent". With workletOnsets threaded into
// segmentNotes the splits collapse and scoring lands above 0.95.

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PentFixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadPentFixture(): PentFixture {
	const path = resolve(
		__dirname,
		'..',
		'fixtures',
		'recordings',
		'2026-05-13-pent-5-3-2-1-half-then-eighths.json'
	);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Pent 5-3-2-1 half-then-eighths regression (attack-evidence merge)', () => {
	// G concert pentatonic: G=55, A=57, B=59, D=62. "Half then Eighths" rhythm:
	// D (half, beat 0) → B (eighth, beat 2) → A (eighth, beat 2.5) → G (quarter, beat 3).
	const phrase: Phrase = {
		id: 'cmb-sp-pent-run-down-4_rp-4-half-eighths_G',
		name: 'Pent 5-3-2-1 / Half Then Eighths',
		category: 'pentatonic',
		key: 'G',
		harmony: [
			{
				chord: { root: 'G', quality: 'maj7' as const },
				scaleId: 'major.ionian',
				startOffset: [0, 1] as [number, number],
				duration: [4, 4] as [number, number],
			},
		],
		notes: [
			{ pitch: 62, offset: [0, 1], duration: [1, 2] },
			{ pitch: 59, offset: [1, 2], duration: [1, 8] },
			{ pitch: 57, offset: [5, 8], duration: [1, 8] },
			{ pitch: 55, offset: [3, 4], duration: [1, 4] },
		],
		difficulty: {
			level: 20,
			pitchComplexity: 20,
			rhythmComplexity: 20,
			lengthBars: 1,
		},
		source: 'curated' as const,
		tags: [],
		timeSignature: [4, 4] as [number, number],
	};

	it('without workletOnsets the segmenter emits the buggy 6-note split', () => {
		const fx = loadPentFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(fx.detection.readings, onsets, fx.audio.duration);

		// Sanity check that the fixture still reproduces the original failure:
		// at least one same-MIDI consecutive pair (the spurious split) appears.
		const samePitchSplits = detected.filter(
			(n, i) => i > 0 && n.midi === detected[i - 1].midi
		);
		expect(samePitchSplits.length).toBeGreaterThan(0);
	});

	it('with workletOnsets the segmenter yields the 4 notes the user actually played', () => {
		const fx = loadPentFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets
		);

		expect(detected.map((n) => n.midi)).toEqual([62, 59, 57, 55]);
	});

	it('score climbs from "good" to "excellent" once the spurious splits are merged', () => {
		const fx = loadPentFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets
		);

		const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);

		expect(score.pitchAccuracy).toBeCloseTo(1, 5);
		expect(score.rhythmAccuracy).toBeGreaterThan(0.9);
		expect(score.overall).toBeGreaterThan(0.95);
		expect(score.notesHit).toBe(4);
		expect(score.notesTotal).toBe(4);
	});
});

// ─── Flat Seven–Octave metronome-bleed regression ─────────────────
//
// Real recording exported as a diagnostic on 2026-05-19. The user played
// a clean C4 → D4 (Flat Seven–Octave in concert D) with the metronome
// ticking. The HFC onset worklet falsely fired on the metronome click at
// recording-time 1.019 s (≈ 92 ms after the beat at 0.927 s — the
// fingerprint of mic-captured bleed), splitting the held C into two
// segments. Pre-fix, the resulting 3-segment input confused DTW into
// matching the second C with the first expected note, dropping the
// rhythm score to 0.154 / overall 0.66 ("fair") on what was actually a
// clean performance.
//
// Post-fix: `mergeSamePitchWithoutAttack` recognises the worklet onset
// as bleed when `bleedOnsets` is supplied and collapses the split.

interface FlatSevenOctaveFixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadFlatSevenOctaveFixture(): FlatSevenOctaveFixture {
	const path = resolve(
		__dirname,
		'..',
		'fixtures',
		'recordings',
		'2026-05-19-flat-seven-octave.json'
	);
	return JSON.parse(readFileSync(path, 'utf8'));
}

// ─── Octave–Flat Seven Drop octave-artifact regression ──────────────
//
// Real recording exported as a diagnostic on 2026-05-19. The user played
// a clean D4 → C4 ("Octave–Flat Seven Drop" in concert D — drop from the
// root octave to flat-7). The McLeod-based pitch detector unstably
// flipped between the C4 fundamental (263 Hz) and its second harmonic
// (526 Hz / C5) during the held-C4 portion — visible in the JSON
// `readings`, where many frames in the middle segment carry midi=72 but
// frequency≈263 Hz, the octave-stabilizer's lock overriding the raw
// detector pick.
//
// The current segmenter sees three notes: [D4, C5, C4]. DTW matches the
// C5 as "extra" and pulls the C4 in to fill the second expected slot,
// but the C4 onset (1.97s) is 767 ms later than expected (1.2s), so
// the rhythm score drops to 0.47 → overall 0.79 ("good") on what was
// actually a clean performance that should grade ≥ "great".
//
// The post-fix behaviour is detection of [D4, C4] — the intermediate
// C5 segment is collapsed into the C4 neighbour because its raw
// frequencies show frames pulled to the C4 fundamental, evidence the
// upper octave is a McLeod second-harmonic lock rather than a real
// pitch. The fix lives in `mergeOctaveBoundariesWithoutAttack`
// (note-segmenter.ts): an adjacent ±12 pair with no real attack at the
// boundary AND ≥ MIN_LOWER_FUNDAMENTAL_FRAMES lower-fundamental raw
// frames in the upper segment collapses to the lower MIDI. See the
// regression tests below for the exact behaviour.

interface OctaveDropFixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadOctaveDropFixture(): OctaveDropFixture {
	const path = resolve(
		__dirname,
		'..',
		'fixtures',
		'recordings',
		'2026-05-19-octave-flat-seven-drop.json'
	);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Octave–Flat Seven Drop octave-artifact regression', () => {
	// bc-016_D rendered in the player's chosen register: D4 → C4.
	const phrase: Phrase = {
		id: 'bc-016_D',
		name: 'Octave–Flat Seven Drop',
		timeSignature: [4, 4],
		key: 'D',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }
		],
		harmony: [],
		difficulty: { level: 6, pitchComplexity: 11, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: [],
		source: 'curated'
	};

	// Baseline: without workletOnsets, neither the same-pitch nor the
	// octave-boundary merge fires. The raw segmenter emits the three
	// fragmented C5 sub-segments produced by McLeod's stabilizer flipping
	// between fundamental and harmonic, plus the brief mid-segment C4
	// already collapsed by cross-segment ±12. This locks in the raw
	// pipeline shape as a baseline distinct from the merge passes.
	it('without workletOnsets the segmenter emits fragmented C5 + tail C4', () => {
		const fx = loadOctaveDropFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration
		);

		expect(detected.map((n) => n.midi)).toEqual([62, 72, 72, 72, 60]);
	});

	// Post-fix behaviour: the McLeod octave-lock detection in segmentNotes
	// (mergeOctaveBoundariesWithoutAttack) recognises that the upper-octave
	// segment's raw frequencies contain frames pulled toward the lower
	// fundamental — proof the C5 is the second-harmonic lock, not a real
	// note. Verified by ear from
	// `tests/fixtures/recordings/2026-05-19-octave-flat-seven-drop.wav`:
	// the upper-octave C5 is not acoustically present in the recording.
	it('segmenter collapses the McLeod C5 artifact when worklet onsets are supplied', () => {
		const fx = loadOctaveDropFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets
		);
		expect(detected.map((n) => n.midi)).toEqual([62, 60]);
	});

	it('score climbs to "great" once the C5 artifact is collapsed', () => {
		const fx = loadOctaveDropFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets
		);
		const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);
		// Saved diagnostic (pre-fix): pitch 1.0, rhythm 0.47, overall 0.79.
		// Post-fix: two notes with much smaller per-note offsets after
		// latency correction; overall well into the "great" range.
		expect(score.pitchAccuracy).toBeCloseTo(1, 5);
		expect(score.rhythmAccuracy).toBeGreaterThan(0.8);
		expect(score.overall).toBeGreaterThan(0.9);
		expect(score.notesHit).toBe(2);
		expect(score.notesTotal).toBe(2);
	});
});

describe('Flat Seven–Octave metronome-bleed regression', () => {
	// bc-015_D rendered into the player's chosen register: C4 → D4.
	const phrase: Phrase = {
		id: 'bc-015_D',
		name: 'Flat Seven–Octave',
		timeSignature: [4, 4],
		key: 'D',
		notes: [
			{ pitch: 60, duration: [3, 4], offset: [0, 1] },
			{ pitch: 62, duration: [1, 4], offset: [3, 4] }
		],
		harmony: [],
		difficulty: { level: 11, pitchComplexity: 11, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: [],
		source: 'curated'
	};

	// `recordingTransportSeconds` isn't in the diagnostic export, but it can
	// be reconstructed from the saved alignment: the worklet onsets sit
	// ~92 ms after recording-time 0.927, 1.527, … so the Transport beat
	// grid is offset by 0.273 s from the recording. A representative
	// value that produces this offset is 6.273.
	const recordingTransportSeconds = 6.273;

	it('without bleedOnsets the segmenter emits the buggy 3-note split', () => {
		const fx = loadFlatSevenOctaveFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets
		);

		// The held C survives as two consecutive same-MIDI segments.
		expect(detected.map((n) => n.midi)).toEqual([60, 60, 62]);
	});

	it('with bleedOnsets the segmenter yields the 2 notes the user actually played', () => {
		const fx = loadFlatSevenOctaveFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const bleedOnsets = getMetronomeBleedOnsets(
			recordingTransportSeconds,
			fx.context.tempo,
			fx.audio.duration
		);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets,
			bleedOnsets
		);

		expect(detected.map((n) => n.midi)).toEqual([60, 62]);
		// First note now spans the full held C.
		expect(detected[0].onsetTime).toBeCloseTo(0.0833, 3);
		expect(detected[0].duration).toBeGreaterThan(1.4);
		expect(detected[1].onsetTime).toBeCloseTo(1.6, 3);
	});

	it('score climbs from "fair" to "great" once the bleed-induced split is merged', () => {
		const fx = loadFlatSevenOctaveFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const bleedOnsets = getMetronomeBleedOnsets(
			recordingTransportSeconds,
			fx.context.tempo,
			fx.audio.duration
		);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets,
			bleedOnsets
		);

		const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);

		// Saved diagnostic score (pre-fix): pitch 1.0, rhythm 0.154, overall 0.66.
		// Post-fix: pitch unchanged, rhythm well above the prior value, overall
		// passes the "good"+ threshold. Bounds tolerate small DTW tie-break
		// variation across replays.
		expect(score.pitchAccuracy).toBeCloseTo(1, 5);
		expect(score.rhythmAccuracy).toBeGreaterThan(0.7);
		expect(score.overall).toBeGreaterThan(0.85);
		expect(score.notesHit).toBe(2);
		expect(score.notesTotal).toBe(2);
	});
});

// ─── Fifth–Sixth Step subharmonic octave-drop: why the fix is upstream ──
//
// Real recording exported as a diagnostic on 2026-06-30. The user played a
// clean F3 → G3 ("Fifth–Sixth Step" rendered in concert Bb) on tenor sax, in
// the correct octave. On the sustained first note the McLeod detector locked
// onto the octave-DOWN subharmonic F2 (≈87.8 Hz, the doubled period of the true
// F3 ≈175.6 Hz). Critically the subharmonic frames carry HIGHER clarity (~0.99)
// than the true fundamental (~0.91) — an autocorrelation property — so every
// downstream octave decision resolves the note to the WRONG lower octave (MIDI
// 41), and the scorer correctly penalises an "octave-low" note that was in fact
// played right.
//
// This block documents WHY the fix can't live in the segmenter. By the time the
// saved `readings` exist the frequency field already says ≈87.8 Hz, and that is
// LOCALLY INDISTINGUISHABLE from a genuine low note (and from the opposite
// octave-UP 2nd-harmonic lock that the Octave–Flat Seven Drop fixture relies on
// the segmenter to collapse DOWN). The disambiguating evidence — that there is
// no real spectral energy at 87.8 Hz — only survives in the raw audio. So the
// fix is `correctSubharmonic` in pitch-frame.ts, applied per frame during
// detection; the behavioural regression that proves it lives in
// pitch-replay.test.ts (WAV replay), which re-runs detection on the real audio.

interface FifthSixthStepFixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadFifthSixthStepFixture(): FifthSixthStepFixture {
	const path = resolve(
		__dirname,
		'..',
		'fixtures',
		'recordings',
		'2026-06-30-fifth-sixth-step.json'
	);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Fifth–Sixth Step subharmonic octave-drop (root cause)', () => {
	// The raw detector flicker is real and present in the saved readings:
	// the first note's frames carry both the true F3 (53) and the subharmonic
	// F2 (41), and the F2 frames have higher mean clarity. This documents the
	// cause independent of the fix.
	it('the saved readings contain a higher-clarity F2 subharmonic of the true F3', () => {
		const fx = loadFifthSixthStepFixture();
		const note1 = fx.detection.readings.filter((r) => r.time >= 0.5 && r.time < 1.0507);
		const f3 = note1.filter((r) => r.midi === 53);
		const f2 = note1.filter((r) => r.midi === 41);
		expect(f3.length).toBeGreaterThan(0);
		expect(f2.length).toBeGreaterThan(0);
		const meanClarity = (rs: PitchReading[]) =>
			rs.reduce((s, r) => s + r.clarity, 0) / rs.length;
		// The subharmonic is the higher-clarity one — exactly why a naive
		// clarity vote picks the wrong octave.
		expect(meanClarity(f2)).toBeGreaterThan(meanClarity(f3));
	});

	it('segmenting the already-corrupted readings cannot recover the octave (→ [41, 55])', () => {
		// Replaying the SAVED readings (whose frequency field is already the
		// subharmonic) reproduces the bug: the segmenter resolves note 1 to F2.
		// This is the floor the detector-level fix has to clear — it is why
		// correctSubharmonic runs during detection, on the raw audio, rather
		// than here. See pitch-replay.test.ts for the post-fix [53, 55].
		const fx = loadFifthSixthStepFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets
		);
		expect(detected.map((n) => n.midi)).toEqual([41, 55]);
	});
});

// ─── Third–Fifth Rise masked-fundamental octave lift: the mirror image ──
//
// Real recording exported as a diagnostic on 2026-07-14. The user played a
// clean E3 → G3 ("Third–Fifth Rise" in concert C) on tenor sax and Pitchy
// detected the E3 correctly (~165 Hz) on every frame. But this genuine low
// note radiates almost no fundamental — mag(f)/mag(2f) ≈ 0.02–0.06, inside
// the band correctSubharmonic's original single-ratio rule read as "no real
// energy at f ⇒ period-doubling artifact" — so the corrector doubled every
// frame to E4 (MIDI 64) during detection. The saved readings below are
// therefore already corrupted at the source, exactly like the Fifth–Sixth
// Step fixture above but in the opposite direction: there the spectrum said
// "artifact" and was right; here it said "artifact" and was wrong. The
// disambiguating evidence (real odd harmonics at 3f/5f) only survives in the
// raw audio, so the fix lives in correctSubharmonic's odd-harmonic gate and
// the behavioural regression lives in pitch-replay.test.ts (WAV replay).

interface ThirdFifthRiseFixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadThirdFifthRiseFixture(): ThirdFifthRiseFixture {
	const path = resolve(
		__dirname,
		'..',
		'fixtures',
		'recordings',
		'2026-07-14-third-fifth-rise.json'
	);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Third–Fifth Rise masked-fundamental octave lift (root cause)', () => {
	// Unlike the Fifth–Sixth Step flicker, the corruption here is total: the
	// corrector rewrote every note-1 frame, so the saved readings contain no
	// trace of the true E3. This documents why no downstream vote or merge
	// could recover the octave.
	it('the saved readings carry the doubled E4 on every note-1 frame', () => {
		const fx = loadThirdFifthRiseFixture();
		const note1 = fx.detection.readings.filter((r) => r.time < 1.0);
		expect(note1.length).toBeGreaterThan(0);
		expect(note1.every((r) => r.midi === 64)).toBe(true);
	});

	it('segmenting the already-corrupted readings cannot recover the octave (→ [64, 55])', () => {
		// Replaying the SAVED readings (whose frequency field was already
		// doubled to ≈330 Hz at detection time) reproduces the bug: note 1
		// resolves to E4. This is the floor the detector-level fix has to
		// clear — see pitch-replay.test.ts for the post-fix [52, 55].
		const fx = loadThirdFifthRiseFixture();
		const onsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const detected = segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets
		);
		expect(detected.map((n) => n.midi)).toEqual([64, 55]);
	});
});

// ─── Blues Curl Up dropout-gap regression (concert G, 2026-05-22) ──────
//
// Two takes of a clean G–B♭–B♭ Blues Curl Up where the player tongued the
// second B♭ so cleanly that the pitch detector lost the signal for
// 130–220 ms across the boundary. The 2026-05-20 findReArticulations fix
// requires a paired clarity dip + RMS dip inside the readings; here the
// RMS dip happens during a stretch where no non-warmup readings are
// emitted, so the algorithm can't see it.
//
// This JSON-fixture test isolates the algorithm from the WAV-replay
// pipeline: it runs findReArticulations directly on the readings the
// diagnostic captured. The companion WAV-based tests live in
// tests/integration/pitch-replay.test.ts.

interface BluesCurlUpFixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadBluesCurlUpFixture(file: string): BluesCurlUpFixture {
	const path = resolve(__dirname, '..', 'fixtures', 'recordings', file);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Blues Curl Up dropout-gap re-articulation (concert G, 2026-05-22)', () => {
	const takes: { label: string; file: string }[] = [
		{ label: 'take A', file: '2026-05-22-blues-curl-up.json' },
		{ label: 'take B', file: '2026-05-22-blues-curl-up-b.json' }
	];

	for (const { label, file } of takes) {
		it(`${label}: findReArticulations emits an onset near the second-B♭ attack`, () => {
			const fx = loadBluesCurlUpFixture(file);
			const baseOnsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
			const articulationOnsets = findReArticulations(fx.detection.readings, baseOnsets);

			expect(articulationOnsets.length).toBeGreaterThan(0);
			const nearSecondBb = articulationOnsets.some((t) => Math.abs(t - 1.1) < 0.2);
			expect(nearSecondBb).toBe(true);
		});

		// End-to-end [G, B♭, B♭] recovery is covered by the WAV-based tests
		// in pitch-replay.test.ts; this file only asserts the algorithm
		// emits the right boundary so the merge step has evidence to keep.
	}
});

// ─── Flat Five Chromatic Up short-gap re-articulation (concert G, 2026-06-21) ──
//
// The player tongued two C4 quarter-notes — the "C, C, D" the app rendered
// for bc-045_G — but the second attack was soft. The HFC worklet missed it,
// the pitch detector dropped ~6 frames across the boundary (a 100 ms reading
// gap at 0.33→0.43 s), and the RMS stepped UP ~2× on the re-attack without
// ever dipping below the pre-gap level. That falls between findReArticulations'
// two passes — the bare-gap pass wants a gap ≥ 150 ms, the dip-and-rise pass
// wants a measurable RMS dip — so the boundary that splitOnReadingGaps created
// had no attack evidence, mergeSamePitchWithoutAttack collapsed the two C's
// into one, the scorer marked the second note MISSED, and the saved score fell
// to 0.62 ("fair") on an otherwise correct performance.
//
// The fix gives the gap pass a corroborated lower tier: a gap ≥ the segmenter's
// own split threshold (75 ms) counts as a re-articulation when the RMS clearly
// steps up across it (a re-attack), which a sustain dropout never does.

interface FlatFiveChromaticFixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadFlatFiveChromaticFixture(): FlatFiveChromaticFixture {
	const path = resolve(
		__dirname,
		'..',
		'fixtures',
		'recordings',
		'2026-06-21-flat-five-chromatic-up.json'
	);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Flat Five Chromatic Up short-gap re-articulation (concert G, 2026-06-21)', () => {
	// bc-045_G as the scorer saw it: a repeated C4 then D4.
	const phrase: Phrase = {
		id: 'bc-045_G',
		name: 'Flat Five Chromatic Up',
		timeSignature: [4, 4],
		key: 'G',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }
		],
		harmony: [],
		difficulty: { level: 15, pitchComplexity: 16, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};

	// Mirror the production ear-training path: resolveOnsets → findReArticulations
	// → segmentNotes(..., articulationOnsets). No backing track was used, so no
	// bleed onsets. (context.backingTrackUsed === false in the diagnostic.)
	function runPipeline(fx: FlatFiveChromaticFixture): DetectedNote[] {
		const baseOnsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const articulationOnsets = findReArticulations(fx.detection.readings, baseOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		return segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets,
			undefined,
			articulationOnsets
		);
	}

	it('findReArticulations emits an onset near the second-C attack (~0.42 s)', () => {
		const fx = loadFlatFiveChromaticFixture();
		const baseOnsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const articulationOnsets = findReArticulations(fx.detection.readings, baseOnsets);

		const nearSecondC = articulationOnsets.some((t) => Math.abs(t - 0.42) < 0.1);
		expect(nearSecondC).toBe(true);
	});

	it('segments the held region into two C notes + a D instead of merging', () => {
		const detected = runPipeline(loadFlatFiveChromaticFixture());
		expect(detected.map((n) => n.midi)).toEqual([60, 60, 62]);
	});

	it('score climbs from "fair" to "great" once the merged C is split', () => {
		const fx = loadFlatFiveChromaticFixture();
		const detected = runPipeline(fx);
		const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);

		// Saved diagnostic (pre-fix): pitch 0.667, rhythm 0.547, overall 0.62,
		// second note MISSED. Post-fix all three notes match.
		expect(score.notesHit).toBe(3);
		expect(score.notesTotal).toBe(3);
		expect(score.pitchAccuracy).toBeCloseTo(1, 5);
		expect(score.overall).toBeGreaterThan(0.85);
	});
});

// ─── Blue Monk tied final-note regression (concert C, 2026-07-23) ──────
//
// Real recording exported as a diagnostic on 2026-07-23. The user played the
// "Blue Monk" head cleanly on tenor sax. The phrase ends on a held E — notated
// as an eighth-note E (offset 7/8) TIED into a half-note E (downbeat of the
// next bar). The player correctly sustained a single E across the tie, and the
// pitch tracker captured it as one long E segment (the last savedDetectedNote,
// ~4.8 s long).
//
// Pre-fix the scorer treated the phrase as all NINE notated notes, so the DTW
// matched the one detected E to the tied eighth and marked the half-note
// continuation MISSED (pitch 0, rhythm 0). Saved diagnostic: pitch 0.889,
// rhythm 0.866, overall 0.880 ("great") — the final note showing red is the
// "the last note is cut off / the tie isn't accounted for" the user reported.
//
// Post-fix scoreAttempt collapses tied same-pitch chains with the same
// extractSoundingNotes walk playback uses, so the phrase has EIGHT sounding
// notes, the sustained E matches once, and the score climbs to "perfect".

interface BlueMonkFixture {
	context: { tempo: number; swing: number };
	scoring: { savedDetectedNotes: DetectedNote[] };
}

function loadBlueMonkFixture(): BlueMonkFixture {
	const path = resolve(
		__dirname,
		'..',
		'fixtures',
		'recordings',
		'2026-07-23-blue-monk.json'
	);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Blue Monk tied final-note regression (concert C, 2026-07-23)', () => {
	// The Blue Monk head as the scorer saw it, reconstructed from the
	// diagnostic's saved noteResults (the notated phrase, before tie-merging):
	// G A G F# F g(low) E♭ E–E, the last two E's joined by a tie.
	const phrase: Phrase = {
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

	it('the notated tie is one held note the pitch tracker captured as a single long E', () => {
		// Nine notated notes; the last two same-pitch E's joined by a tie.
		expect(phrase.notes).toHaveLength(9);
		expect(phrase.notes[7].tied).toBe(true);
		expect(phrase.notes[7].pitch).toBe(64);
		expect(phrase.notes[8].pitch).toBe(64);

		// The player sustained that E, so segmentation produced ONE long E at
		// the end, not two — the detection side already did the right thing.
		const detected = loadBlueMonkFixture().scoring.savedDetectedNotes;
		expect(detected.map((n) => n.midi)).toEqual([67, 69, 67, 66, 65, 55, 63, 64]);
		expect(detected[detected.length - 1].duration).toBeGreaterThan(2);
	});

	it('scores the tied final note as a hit, climbing from "great" to "perfect"', () => {
		const fx = loadBlueMonkFixture();
		const score = scoreAttempt(
			phrase,
			fx.scoring.savedDetectedNotes,
			fx.context.tempo,
			0,
			fx.context.swing
		);

		// Eight sounding notes after the tie merge, all matched — no missed note.
		expect(score.notesTotal).toBe(8);
		expect(score.notesHit).toBe(8);
		expect(score.noteResults.some((r) => r.missed)).toBe(false);

		// Saved diagnostic (pre-fix): pitch 0.889 (final note missed), rhythm
		// 0.866, overall 0.880 "great". Post-fix pitch is perfect and overall
		// clears the 0.95 "perfect" threshold.
		expect(score.pitchAccuracy).toBeCloseTo(1, 5);
		expect(score.rhythmAccuracy).toBeGreaterThan(0.9);
		expect(score.overall).toBeGreaterThan(0.95);
		expect(score.grade).toBe('perfect');
	});

	it('only merges when the notes are TIED — a re-articulated repeat still needs two hits', () => {
		// Guard against a naive "merge any repeated pitch" fix: if the same two
		// E's were NOT tied (two separately-tongued notes), a single held note
		// should still leave the second one MISSED — the same contract the Flat
		// Five Chromatic Up case relies on for its two tongued C's.
		const untied: Phrase = {
			...phrase,
			notes: phrase.notes.map((n, i) => (i === 7 ? { ...n, tied: false } : n))
		};
		const fx = loadBlueMonkFixture();
		const score = scoreAttempt(
			untied,
			fx.scoring.savedDetectedNotes,
			fx.context.tempo,
			0,
			fx.context.swing
		);

		expect(score.notesTotal).toBe(9);
		expect(score.noteResults.some((r) => r.missed)).toBe(true);
		expect(score.pitchAccuracy).toBeLessThan(1);
	});
});

// ─── 2026-07-25 metronome-click / soft-tongue trio (concert C, 105 BPM) ────
//
// Saved-readings companions to the WAV end-to-end tests in
// pitch-replay.test.ts (see the block comment there for the full story).
// Three same-day ear-training takes with the metronome mixed into the
// recording; each was mis-scored by a different mechanism. What is
// recoverable from the SAVED readings differs per mechanism:
//
//   - root-frame is FULLY recoverable: the onset-guard provenance fix and
//     the HF tier's scheduled-click suppression both operate on data the
//     diagnostic already carries (readings + worklet onsets + click grid).
//   - blue-step-down's click-split C is recoverable (the bare-gap energy
//     gate uses reading-level rms), but its merged F–F pair is NOT: the
//     tongue's 20 ms envelope dip only survives in `rmsMin`, which these
//     pre-fix readings don't carry. Score climbs 0.634 → ~0.78, one MISS.
//   - blue-note-step-up is NOT recoverable at all from saved readings for
//     the same reason — the fix lives in detectFrame (rmsMin), so only the
//     WAV path exercises it. The JSON test pins that floor, exactly like
//     the Fifth–Sixth Step subharmonic fixtures.

interface Trio20260725Fixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadTrio20260725Fixture(name: string): Trio20260725Fixture {
	const path = resolve(__dirname, '..', 'fixtures', 'recordings', `2026-07-25-${name}.json`);
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('2026-07-25 trio: saved-readings replay (concert C, 105 BPM)', () => {
	const BEAT = 60 / 105;

	function runSavedPipeline(
		name: string,
		recordingTransportSeconds: number | null
	): DetectedNote[] {
		const fx = loadTrio20260725Fixture(name);
		const baseOnsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const bleedOnsets =
			recordingTransportSeconds === null
				? undefined
				: getMetronomeBleedOnsets(
						recordingTransportSeconds,
						fx.context.tempo,
						fx.audio.duration
					);
		const articulationOnsets = findReArticulations(
			fx.detection.readings,
			baseOnsets,
			bleedOnsets
		);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		return segmentNotes(
			fx.detection.readings,
			onsets,
			fx.audio.duration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets,
			bleedOnsets,
			articulationOnsets
		);
	}

	describe('root-frame (blues-039: C B♭ C G)', () => {
		// blues-039 as saved: the B♭ vanished into a guard-eaten segment (a
		// McLeod C3 subharmonic won the vote and the sandwich collapse merged
		// C–"C3"–C), and the HF tier split the held G on the click at 2.74 s.
		// Saved score: 0.445 "try-again". Both causes are visible — and fixed —
		// at the saved-readings level.
		const phrase: Phrase = {
			id: 'blues-039',
			name: 'Root Frame',
			timeSignature: [4, 4],
			key: 'C',
			notes: [
				{ pitch: 60, duration: [1, 8], offset: [0, 1] },
				{ pitch: 58, duration: [1, 8], offset: [1, 8] },
				{ pitch: 60, duration: [1, 4], offset: [1, 4] },
				{ pitch: 67, duration: [3, 2], offset: [1, 2] }
			],
			harmony: [],
			difficulty: { level: 18, pitchComplexity: 16, rhythmComplexity: 22, lengthBars: 2 },
			category: 'blues',
			tags: [],
			source: 'curated'
		};
		// Clicks observed at 0.449 + k·BEAT in recording time.
		const rts = 16 * BEAT - 0.44875;

		it('without the click schedule the HF tier still splits the held G', () => {
			const detected = runSavedPipeline('root-frame', null);
			expect(detected.map((n) => n.midi)).toEqual([60, 58, 60, 67, 67]);
		});

		it('recovers the B♭ and keeps the held G whole with the click schedule', () => {
			const detected = runSavedPipeline('root-frame', rts);
			expect(detected.map((n) => n.midi)).toEqual([60, 58, 60, 67]);
		});

		it('scores the clean take as such (saved: 0.445 "try-again")', () => {
			const fx = loadTrio20260725Fixture('root-frame');
			const detected = runSavedPipeline('root-frame', rts);
			const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);
			expect(score.pitchAccuracy).toBeCloseTo(1, 5);
			expect(score.notesHit).toBe(4);
			expect(score.overall).toBeGreaterThan(0.9);
		});
	});

	describe('blue-step-down (bbn-041 snapped: G F F E♭ C)', () => {
		// Saved score 0.634 "fair": the final C was split by a click-induced
		// 167 ms tracking hole (post/pre rms 0.67, still falling — no attack),
		// cascading DTW into two pitch mismatches on top of the merged F pair.
		// The bare-gap energy gate repairs the C from saved readings alone; the
		// F–F merge needs rmsMin and stays (see pitch-replay.test.ts).
		const phrase: Phrase = {
			id: 'bbn-041',
			name: 'Blue Step Down',
			timeSignature: [4, 4],
			key: 'C',
			notes: [
				{ pitch: 67, duration: [1, 4], offset: [0, 1] },
				{ pitch: 65, duration: [1, 8], offset: [1, 4] },
				{ pitch: 65, duration: [1, 8], offset: [3, 8] },
				{ pitch: 63, duration: [1, 4], offset: [1, 2] },
				{ pitch: 60, duration: [1, 2], offset: [3, 4] }
			],
			harmony: [],
			difficulty: { level: 14, pitchComplexity: 18, rhythmComplexity: 10, lengthBars: 2 },
			category: 'blues',
			tags: [],
			source: 'curated'
		};
		// Clicks observed at 0.387 + k·BEAT in recording time.
		const rts = 16 * BEAT - 0.3874;

		it('keeps the held final C whole (no articulation from the click hole)', () => {
			const detected = runSavedPipeline('blue-step-down', rts);
			expect(detected.map((n) => n.midi)).toEqual([67, 65, 63, 60]);
			// The C spans from its attack to the end of the phrase window.
			const c = detected[detected.length - 1];
			expect(c.onsetTime).toBeCloseTo(1.617, 2);
			expect(c.duration).toBeGreaterThan(1.5);
		});

		it('scores 4/5 with one honest MISS (saved: 0.634 with two pitch mismatches)', () => {
			const fx = loadTrio20260725Fixture('blue-step-down');
			const detected = runSavedPipeline('blue-step-down', rts);
			const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);
			expect(score.pitchAccuracy).toBeCloseTo(0.8, 5);
			expect(score.notesHit).toBe(4);
			expect(score.overall).toBeGreaterThan(0.7);
		});
	});

	describe('blue-note-step-up (bbn-009_C snapped: F F G)', () => {
		it('saved readings cannot recover the F–F split — the fix is upstream in detectFrame', () => {
			// The tongue's evidence is a 25 ms envelope dip that only rmsMin
			// (absent from these pre-fix readings) preserves; every
			// reading-level signal stays under threshold (rms dip 17%,
			// perturbation 0.035 st, gap 50 ms). This pins the floor the
			// WAV-replay test clears — same pattern as the Fifth–Sixth Step
			// subharmonic fixture.
			const detected = runSavedPipeline('blue-note-step-up', 16 * BEAT - 0.0803);
			expect(detected.map((n) => n.midi)).toEqual([53, 55]);
		});
	});
});

// ─── Pent 1-3-2-5 latency-shifted final note (concert F, 2026-07-28) ─────
//
// A clean F A G C take (dotted quarter + eighths, 105 BPM) whose final C was
// dropped before scoring: the ear-training live/rescore paths passed the
// notional PHRASE duration (4 beats = 2.286 s) as segmentNotes'
// `recordingDuration`, but the user's reaction latency (~0.59 s, absorbed
// later by the scorer's median correction) pushed the C's attack to 2.32 s —
// past the bound — so the segmenter clipped the G and discarded the C. Saved
// score: 0.737 ("good", pitch 3/4) with the last note MISSED. The fix passes
// the true capture length; the second test pins the pre-fix failure shape.

interface Pent1325Fixture {
	context: { tempo: number; swing: number };
	audio: { duration: number };
	detection: {
		rawWorkletOnsets: number[];
		readings: PitchReading[];
	};
}

function loadPent1325Fixture(): Pent1325Fixture {
	const path = resolve(__dirname, '..', 'fixtures', 'recordings', '2026-07-28-pent-1-3-2-5.json');
	return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Pent 1-3-2-5 latency-shifted final note (concert F, 2026-07-28)', () => {
	const BEAT = 60 / 105;
	// Metronome clicks observed at 0.0135 + k·BEAT in recording time.
	const rts = 16 * BEAT - 0.01346;

	const phrase: Phrase = {
		id: 'cmb-sp-pent-skip_rp-4-dotted_F',
		name: 'Pent 1-3-2-5 / Dotted Quarter + Eighths',
		timeSignature: [4, 4],
		key: 'F',
		notes: [
			{ pitch: 53, duration: [3, 8], offset: [0, 1] }, // F
			{ pitch: 57, duration: [1, 8], offset: [3, 8] }, // A
			{ pitch: 55, duration: [1, 4], offset: [1, 2] }, // G
			{ pitch: 60, duration: [1, 4], offset: [3, 4] } // C
		],
		harmony: [],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 12, lengthBars: 1 },
		category: 'pentatonic',
		tags: [],
		source: 'curated'
	};

	function runSavedPipeline(segmentationDuration: number): DetectedNote[] {
		const fx = loadPent1325Fixture();
		const baseOnsets = resolveOnsets(fx.detection.rawWorkletOnsets, fx.detection.readings);
		const bleedOnsets = getMetronomeBleedOnsets(rts, fx.context.tempo, segmentationDuration);
		const articulationOnsets = findReArticulations(
			fx.detection.readings,
			baseOnsets,
			bleedOnsets
		);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		return segmentNotes(
			fx.detection.readings,
			onsets,
			segmentationDuration,
			undefined,
			undefined,
			undefined,
			fx.detection.rawWorkletOnsets,
			bleedOnsets,
			articulationOnsets
		);
	}

	it('keeps the final C when segmenting over the full capture', () => {
		const fx = loadPent1325Fixture();
		const detected = runSavedPipeline(fx.audio.duration);
		expect(detected.map((n) => n.midi)).toEqual([53, 57, 55, 60]);
		// The C's attack sits past the notional 4-beat phrase end.
		expect(detected[3].onsetTime).toBeGreaterThan(4 * BEAT);
	});

	it('sanity: bounding segmentation at the phrase length reproduces the truncation', () => {
		const detected = runSavedPipeline(4 * BEAT);
		expect(detected.map((n) => n.midi)).toEqual([53, 57, 55]);
	});

	it('scores 4/4 from saved readings (saved: 0.737 with the final C MISSED)', () => {
		const fx = loadPent1325Fixture();
		const detected = runSavedPipeline(fx.audio.duration);
		const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);
		expect(score.pitchAccuracy).toBeCloseTo(1, 5);
		expect(score.notesHit).toBe(4);
		expect(score.overall).toBeGreaterThan(0.9);
	});
});

// ─── 2026-08-10 "Pent 1-2-3-5 / Eighth Run + Hold" ───────────────────────────
//
// Concert C major pentatonic run C-D-E-G on Bb tenor, 105 BPM, swing 0.6,
// metronome on, no backing track. The performance was correct; the saved score
// was 0.522 ("try-again") with one note of four hit.
//
// Two independent defects stacked:
//
//   1. The capture was armed by the user's first note, so it began 190 ms into
//      that note — the WAV opens mid-C at RMS 0.039 with no attack transient.
//      The C never formed a note. (Fixed in the capture layer; this fixture's
//      readings still start mid-C, because that is what was recorded.)
//
//   2. The metronome click at 0.856 s wiped McLeod clarity for 167 ms on the
//      HELD final G. The bare-gap tier read post/pre RMS at ~0.85 — right on
//      RE_ARTICULATION_GAP_SUSTAIN's floor, between the 0.67 decaying-note
//      counterexample it was cut against and the 0.94/0.97 of real tongue
//      stops — and manufactured a re-articulation at 1.08 s, splitting the
//      held G in two.
//
// Defect 2 is what made defect 1 catastrophic rather than merely costly: the
// phantom G restored the detected count to four, so DTW found a clean 1:1
// diagonal shifted one position (60→62, 62→64, 64→67) and a single missed note
// became three wrong ones. With the split repaired the same take scores 0.742.
describe('2026-08-10 pent run: a metronome click must not split the held G', () => {
	interface PentRunFixture {
		context: { tempo: number; swing: number; transportSeconds: number };
		detection: { rawWorkletOnsets: number[]; readings: PitchReading[] };
	}

	function loadPentRunFixture(): PentRunFixture {
		const path = resolve(
			__dirname,
			'..',
			'fixtures',
			'recordings',
			'2026-08-10-pent-1-2-3-5-eighth-run-hold.json'
		);
		return JSON.parse(readFileSync(path, 'utf8'));
	}

	/** The ear-training path, metronome on: bleed evidence reaches both stages. */
	function runPipeline(fx: PentRunFixture) {
		const readings = fx.detection.readings;
		const worklet = fx.detection.rawWorkletOnsets;
		const duration = readings[readings.length - 1].time + 0.1;
		const bleedOnsets = getMetronomeBleedOnsets(
			fx.context.transportSeconds,
			fx.context.tempo,
			duration
		);
		const baseOnsets = resolveOnsets(worklet, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets, bleedOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			readings,
			onsets,
			duration,
			undefined,
			undefined,
			undefined,
			worklet,
			bleedOnsets,
			articulationOnsets
		);
		return { detected, articulationOnsets, bleedOnsets, duration };
	}

	it('the worklet onsets are all metronome clicks, one beat apart', () => {
		const fx = loadPentRunFixture();
		const beat = 60 / fx.context.tempo;
		const raw = fx.detection.rawWorkletOnsets;

		for (let i = 1; i < raw.length; i++) {
			const beats = (raw[i] - raw[i - 1]) / beat;
			expect(Math.abs(beats - Math.round(beats))).toBeLessThan(0.02);
		}
	});

	it('no re-articulation is manufactured inside the click-wiped gap', () => {
		const { articulationOnsets } = runPipeline(loadPentRunFixture());

		// The gap runs 0.850 → 1.017; the phantom landed at 1.08.
		expect(articulationOnsets.filter((t) => t > 0.85 && t < 1.2)).toEqual([]);
	});

	it('the held G stays one note', () => {
		const { detected, duration } = runPipeline(loadPentRunFixture());

		// Still missing the C the capture never recorded — that is defect 1, and
		// this fixture predates the fix for it — but D, E and a single held G.
		expect(detected.map((n) => n.midi)).toEqual([62, 64, 67]);

		// The G runs unbroken from its attack to the end of the readings, across
		// the click at 0.856 that used to cut it in two. (These are the LIVE
		// readings, which stop at ~1.98 s; the diagnostic's saved note is longer
		// because it came from the replay pass over the full 3.47 s blob.)
		const heldG = detected[detected.length - 1];
		expect(heldG.onsetTime).toBeCloseTo(0.733, 2);
		expect(heldG.onsetTime + heldG.duration).toBeCloseTo(duration, 2);
	});

	it('scores as one missed note rather than three wrong ones', () => {
		const fx = loadPentRunFixture();
		const { detected } = runPipeline(fx);
		const phrase: Phrase = {
			id: 'cmb-sp-pent-run-4_rp-4-eighths-hold',
			name: 'Pent 1-2-3-5 / Eighth Run + Hold',
			key: 'C',
			timeSignature: [4, 4],
			notes: [
				{ pitch: 60, offset: [0, 1], duration: [1, 8] },
				{ pitch: 62, offset: [1, 8], duration: [1, 8] },
				{ pitch: 64, offset: [1, 4], duration: [1, 8] },
				{ pitch: 67, offset: [3, 8], duration: [5, 8] }
			],
			harmony: [],
			difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
			category: 'pentatonic',
			tags: [],
			source: 'curated'
		};

		const score = scoreAttempt(phrase, detected, fx.context.tempo, 0, fx.context.swing);

		// Saved diagnostic: pitch 0.250, overall 0.522, 1 of 4 hit — the whole
		// line aligned one position off. D, E and G now match where they should.
		expect(score.pitchAccuracy).toBeCloseTo(0.75, 5);
		expect(score.notesHit).toBe(3);
		expect(score.overall).toBeGreaterThan(0.70);
		expect(score.noteResults[0].missed).toBe(true);
		expect(score.noteResults[1].detected?.midi).toBe(62);
		expect(score.noteResults[2].detected?.midi).toBe(64);
		expect(score.noteResults[3].detected?.midi).toBe(67);
	});
});

// ─── 2026-08-11 tongued same-pitch pairs ─────────────────────────────────────
//
// Two ear-training takes from the same session (concert G, 105 BPM, swing 0.6,
// metronome on, no backing track) where a subtle same-pitch re-articulation
// merged and the second note was scored MISSED. These replay the SAVED live
// readings — the trim-consistent export shipped in #223, so `transportSeconds`
// describes the untrimmed blob and `captureTrimSeconds` must be added back to
// phase the click grid. The WAV twins in pitch-replay.test.ts pin the
// authoritative blob-rescore path; these pin the same evidence class on the
// saved-readings path.
describe('2026-08-11 tongued same-pitch pairs: saved-readings replay', () => {
	interface TonguedPairFixture {
		context: { tempo: number; swing: number; transportSeconds: number };
		audio: { duration: number; captureTrimSeconds: number };
		detection: { rawWorkletOnsets: number[]; readings: PitchReading[] };
	}

	function loadTake(file: string): TonguedPairFixture {
		const path = resolve(__dirname, '..', 'fixtures', 'recordings', file);
		return JSON.parse(readFileSync(path, 'utf8'));
	}

	/** The ear-training path, metronome on: bleed evidence reaches both stages. */
	function runPipeline(fx: TonguedPairFixture) {
		const readings = fx.detection.readings;
		const worklet = fx.detection.rawWorkletOnsets;
		const duration = fx.audio.duration;
		const bleedOnsets = getMetronomeBleedOnsets(
			fx.context.transportSeconds + fx.audio.captureTrimSeconds,
			fx.context.tempo,
			duration
		);
		const baseOnsets = resolveOnsets(worklet, readings);
		const articulationOnsets = findReArticulations(readings, baseOnsets, bleedOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			readings,
			onsets,
			duration,
			undefined,
			undefined,
			undefined,
			worklet,
			bleedOnsets,
			articulationOnsets
		);
		return { detected, articulationOnsets };
	}

	// "Curl to the Floor" (bbn-019_G): D4, C4 C4 (swung eighths), Bb3, G3. The
	// tongue stop's band-floor collapse precedes the hfRms spike (tracking was
	// blanked through the attack), and a click 219 ms before the spike put it
	// inside the HF suppression window — bandFloorDips' pre-span stop-and-
	// recover shape is what rescues it. Saved score 0.747 with the second C4
	// MISSED; the merged C4 was a single 0.55 s note at 0.900.
	it('Curl to the Floor: the tongued C4 eighth pair splits despite the adjacent click', () => {
		const { detected, articulationOnsets } = runPipeline(
			loadTake('2026-08-11-curl-to-the-floor.json')
		);

		expect(articulationOnsets.some((t) => t > 1.28 && t < 1.42)).toBe(true);
		expect(detected.map((n) => n.midi)).toEqual([62, 60, 60, 58, 55]);
		expect(detected[1].onsetTime).toBeCloseTo(0.9, 1);
		expect(detected[2].onsetTime).toBeGreaterThan(1.28);
		expect(detected[2].onsetTime).toBeLessThan(1.42);
	});

	// "Blue Note Climb" (bbn-001_G): C4, C4, D4 halves. The soft on-beat
	// tongue leaves a 133 ms tracking hole, stretched past the bare-gap floor
	// only by the warmup frames findSameMidiRuns skips, and the post-gap
	// energy holds 1.19× — under the 1.2 step-up the short-gap tier would
	// demand if the gap ever measured below 150 ms. Scored 0.666 by a stale
	// pre-#223 client with the second C4 MISSED; current code must keep it
	// split at the bare-gap articulation.
	it('Blue Note Climb: the tongued C4 half pair splits at the bare-gap articulation', () => {
		const { detected, articulationOnsets } = runPipeline(
			loadTake('2026-08-11-blue-note-climb.json')
		);

		expect(articulationOnsets.some((t) => t > 1.4 && t < 1.6)).toBe(true);
		expect(detected.map((n) => n.midi)).toEqual([60, 60, 62]);
		expect(detected[1].onsetTime).toBeGreaterThan(1.4);
		expect(detected[1].onsetTime).toBeLessThan(1.6);
	});
});

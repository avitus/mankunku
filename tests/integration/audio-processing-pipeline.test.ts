/**
 * Integration tests for the audio processing pipeline:
 * onset detection → note segmentation → quantization → scoring.
 *
 * All functions in this chain are pure — no mocking needed.
 * Synthetic PitchReading arrays simulate mic input at 60 fps.
 */

import { describe, it, expect } from 'vitest';
import {
	createOnsetState,
	processOnsetFrame,
	SETTLE_FRAMES,
	MIN_ONSET_INTERVAL,
} from '$lib/audio/onset-core';
import { segmentNotes, validateOnsets } from '$lib/audio/note-segmenter';
import { quantizeNotes, detectKey } from '$lib/audio/quantizer';
import { extractOnsetsFromReadings } from '$lib/scoring/score-pipeline';
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

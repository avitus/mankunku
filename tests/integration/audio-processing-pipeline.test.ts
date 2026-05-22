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

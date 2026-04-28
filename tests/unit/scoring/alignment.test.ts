import { describe, it, expect } from 'vitest';
import { alignNotes } from '$lib/scoring/alignment';
import type { Note, Fraction } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';

function makeNote(pitch: number | null, offset: Fraction, duration: Fraction = [1, 8]): Note {
	return { pitch, offset, duration };
}

function makeDetected(midi: number, onsetTime: number, cents: number = 0): DetectedNote {
	return { midi, cents, onsetTime, duration: 0.3, clarity: 0.9 };
}

const TEMPO = 120; // 1 beat = 0.5s

describe('alignNotes', () => {
	it('returns empty array when no expected notes', () => {
		const detected = [makeDetected(60, 0)];
		expect(alignNotes([], detected, TEMPO)).toEqual([]);
	});

	it('returns all-missed pairs when no detected notes', () => {
		const expected = [
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8])
		];
		const pairs = alignNotes(expected, [], TEMPO);
		expect(pairs).toHaveLength(2);
		expect(pairs.every(p => p.detectedIndex === null)).toBe(true);
		expect(pairs.every(p => p.cost === 2.0)).toBe(true);
	});

	it('filters out rests from expected notes', () => {
		const expected = [
			makeNote(null, [0, 1]),   // rest — should be excluded
			makeNote(60, [1, 8])
		];
		const detected = [makeDetected(60, 0.25)];
		const pairs = alignNotes(expected, detected, TEMPO);
		// Only 1 expected note after filtering rests
		const matched = pairs.filter(p => p.expectedIndex !== null);
		expect(matched).toHaveLength(1);
	});

	it('matches notes with correct pitch and timing at low cost', () => {
		const expected = [
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [1, 4])
		];
		// At 120 BPM: beat 0 = 0s, beat 0.5 = 0.25s, beat 1 = 0.5s
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(64, 0.5)
		];
		const pairs = alignNotes(expected, detected, TEMPO);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(3);
		// Perfect match should have near-zero cost
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('marks missed notes when fewer detected than expected', () => {
		const expected = [
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [1, 4])
		];
		const detected = [makeDetected(60, 0)];
		const pairs = alignNotes(expected, detected, TEMPO);
		const missed = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex === null);
		expect(missed.length).toBeGreaterThanOrEqual(2);
	});

	it('marks extra notes when more detected than expected', () => {
		const expected = [makeNote(60, [0, 1])];
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(64, 0.5)
		];
		const pairs = alignNotes(expected, detected, TEMPO);
		const extra = pairs.filter(p => p.expectedIndex === null && p.detectedIndex !== null);
		expect(extra.length).toBeGreaterThanOrEqual(2);
	});

	it('assigns higher cost for wrong pitch', () => {
		const expected = [makeNote(60, [0, 1])];
		// Correct pitch
		const correctPairs = alignNotes(expected, [makeDetected(60, 0)], TEMPO);
		// Wrong pitch (2 semitones off → cost capped at 1.0)
		const wrongPairs = alignNotes(expected, [makeDetected(62, 0)], TEMPO);

		const correctCost = correctPairs.find(p => p.expectedIndex === 0)!.cost;
		const wrongCost = wrongPairs.find(p => p.expectedIndex === 0)!.cost;
		expect(wrongCost).toBeGreaterThan(correctCost);
	});

	it('assigns higher cost for timing offset', () => {
		const expected = [makeNote(60, [0, 1])];
		// On time
		const onTimePairs = alignNotes(expected, [makeDetected(60, 0)], TEMPO);
		// Late by half a beat (0.25s at 120 BPM)
		const latePairs = alignNotes(expected, [makeDetected(60, 0.25)], TEMPO);

		const onTimeCost = onTimePairs.find(p => p.expectedIndex === 0)!.cost;
		const lateCost = latePairs.find(p => p.expectedIndex === 0)!.cost;
		expect(lateCost).toBeGreaterThan(onTimeCost);
	});

	it('applies swing offset to off-beat 8th notes', () => {
		// Note at offset [1,8] = beat 0.5 (an off-beat 8th)
		const expected = [makeNote(60, [1, 8])];
		const swing = 0.67;
		// With swing 0.67, the off-beat 8th shifts by (0.67-0.5)*beatDuration
		const beatDuration = 60 / TEMPO; // 0.5s
		const swungOnset = 0.5 * beatDuration + (swing - 0.5) * beatDuration;
		// Detect at the swung position
		const detected = [makeDetected(60, swungOnset)];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		expect(matched!.cost).toBeCloseTo(0, 1);
	});

	it('does NOT shift triplet 8ths when swing > 0.5 (matches playback contract)', () => {
		// Triplet 8ths inside beat 1: offsets [0,12], [1,12], [2,12]
		// → beats 0, 1/3, 2/3 (none of which equal n + 1/2)
		const swing = 0.67;
		const beatDuration = 60 / TEMPO;
		const expected = [
			makeNote(60, [0, 12]),
			makeNote(62, [1, 12]),
			makeNote(64, [2, 12])
		];
		// Detected at the *unswung* positions — exactly 1/3 beat apart.
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, (1 / 3) * beatDuration),
			makeDetected(64, (2 / 3) * beatDuration)
		];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(3);
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('beat-4 triplet pickup (major-chord-pickup-001) scores zero cost at swing 0.67', () => {
		// Replicates the exact pickup pattern from src/lib/data/licks/major-chord.ts
		// (offsets [3,4], [5,6], [11,12]) — the lick whose timing the user reported as broken.
		const swing = 0.67;
		const beatDuration = 60 / TEMPO;
		const expected = [
			makeNote(55, [3, 4]),    // beat 3.0
			makeNote(57, [5, 6]),    // beat 10/3
			makeNote(59, [11, 12])   // beat 11/3
		];
		const detected = [
			makeDetected(55, 3.0 * beatDuration),
			makeDetected(57, (10 / 3) * beatDuration),
			makeDetected(59, (11 / 3) * beatDuration)
		];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(3);
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('mixed phrase: swings 8th off-beats, leaves triplets and downbeats unchanged', () => {
		// Beat 0 downbeat | beat 0.5 off-beat 8th | triplet at beats 1+1/3, 1+2/3
		const swing = 0.67;
		const beatDuration = 60 / TEMPO;
		const swungOffBeat = 0.5 + (swing - 0.5);    // 0.67 beats
		const expected = [
			makeNote(60, [0, 1]),   // downbeat
			makeNote(62, [1, 8]),   // off-beat 8th — should be swung
			makeNote(64, [4, 12]),  // triplet 8n at 4/3 beats — should NOT be swung
			makeNote(65, [5, 12])   // triplet 8n at 5/3 beats — should NOT be swung
		];
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, swungOffBeat * beatDuration),
			makeDetected(64, (4 / 3) * beatDuration),
			makeDetected(65, (5 / 3) * beatDuration)
		];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(4);
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('treats octave-off as pitch-matched when octaveInsensitive=true', () => {
		const expected = [makeNote(60, [0, 1])]; // C4
		// Detected C5 (one octave up) at the same time
		const pairs = alignNotes(expected, [makeDetected(72, 0)], TEMPO, 0.5, true);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		// Cost should be rhythm-only (zero here) since pitch distance collapses to 0
		expect(matched!.cost).toBeCloseTo(0, 1);
	});

	it('still penalizes wrong pitch class when octaveInsensitive=true', () => {
		const expected = [makeNote(60, [0, 1])]; // C4
		// C#5 → pitch class 1 vs expected 0 → cyclic distance 1 → cost 0.5
		const pairs = alignNotes(expected, [makeDetected(73, 0)], TEMPO, 0.5, true);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		expect(matched!.cost).toBeCloseTo(0.5, 1);
	});

	it('caps pitch-class distance at tritone (cyclic distance 6 → cost 1.0)', () => {
		const expected = [makeNote(60, [0, 1])]; // C4
		// F#5 (MIDI 78) → pitch class 6 → cyclic distance 6 → cost capped at 1.0
		const pairs = alignNotes(expected, [makeDetected(78, 0)], TEMPO, 0.5, true);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		expect(matched!.cost).toBeCloseTo(1.0, 1);
	});
});

import { describe, it, expect } from 'vitest';
import { alignNotes } from '$lib/scoring/alignment.ts';
import type { Note, Fraction } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

function makeNote(pitch: number | null, offset: Fraction, duration: Fraction = [1, 8]): Note {
	return { pitch, offset, duration };
}

function makeDetected(midi: number, onsetTime: number, cents = 0): DetectedNote {
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
});

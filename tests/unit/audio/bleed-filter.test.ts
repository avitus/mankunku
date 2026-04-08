import { describe, it, expect } from 'vitest';
import { filterBleed } from '$lib/audio/bleed-filter.ts';
import { buildSchedule } from '$lib/audio/backing-track-schedule.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

function note(midi: number, onsetTime: number, clarity: number, duration = 0.4): DetectedNote {
	return { midi, cents: 0, onsetTime, duration, clarity };
}

// Schedule: bass E2 (40) at beat 1 (0.5s), comp C4+E4 (60,64) at beat 2 (1.0s)
const PPQ = 480;
const TEMPO = 120;
const TICK_OFFSET = 480;
const schedule = buildSchedule(
	[{ time: '0i', midi: 40, duration: 0.5 }],
	[{ time: '480i', notes: [60, 64], duration: 0.3 }],
	TICK_OFFSET, PPQ, TEMPO
);

// Recording starts at Transport time 0.5s (= beat 1)
const RECORDING_TRANSPORT = 0.5;

describe('filterBleed', () => {
	it('keeps notes that do not match any backing track pitch', () => {
		const detected = [note(67, 0.0, 0.85)]; // G4 — not in schedule
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(1);
		expect(filtered).toHaveLength(0);
	});

	it('filters low-clarity notes matching backing track pitch', () => {
		// Bass E2 (40) active at transport 0.5s = recording onset 0.0s
		const detected = [note(40, 0.0, 0.83)];
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(0);
		expect(filtered).toHaveLength(1);
	});

	it('keeps high-clarity notes even when matching backing track', () => {
		// User playing same pitch as bass, but with strong signal
		const detected = [note(40, 0.0, 0.95)];
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(1);
		expect(filtered).toHaveLength(0);
	});

	it('filters octave-aliased bleed (detected octave above bass)', () => {
		// Bass is E2 (40), detector locks onto E3 (52) — octave alias
		const detected = [note(52, 0.0, 0.83)];
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(0);
		expect(filtered).toHaveLength(1);
	});

	it('filters borderline clarity with onset coincidence', () => {
		// Comp starts at transport 1.0s = recording onset 0.5s
		// Clarity 0.90 is between floor (0.88) and ceiling (0.92)
		const detected = [note(60, 0.5, 0.90)];
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(0);
		expect(filtered).toHaveLength(1);
	});

	it('keeps borderline clarity without onset coincidence', () => {
		// Same pitch as comp but offset in time (0.2s into the note, not at start)
		const detected = [note(60, 0.7, 0.90)];
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(1);
		expect(filtered).toHaveLength(0);
	});

	it('handles mixed real and bleed notes', () => {
		const detected = [
			note(40, 0.0, 0.83),  // bleed: bass match, low clarity
			note(67, 0.2, 0.94),  // real: no match
			note(60, 0.5, 0.85),  // bleed: comp match, low clarity
			note(72, 0.8, 0.96),  // real: no match
		];
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(2);
		expect(kept.map(n => n.midi)).toEqual([67, 72]);
		expect(filtered).toHaveLength(2);
		expect(filtered.map(n => n.midi)).toEqual([40, 60]);
	});

	it('respects custom clarity floor', () => {
		// With default floor (0.88) this would be kept; with higher floor it's filtered
		const detected = [note(40, 0.0, 0.90)];
		const { kept, filtered } = filterBleed(detected, schedule, RECORDING_TRANSPORT, 0.91);
		expect(filtered).toHaveLength(1);
	});

	it('returns all notes when schedule is empty', () => {
		const emptySchedule = buildSchedule([], [], TICK_OFFSET, PPQ, TEMPO);
		const detected = [note(40, 0.0, 0.83), note(60, 0.5, 0.85)];
		const { kept, filtered } = filterBleed(detected, emptySchedule, RECORDING_TRANSPORT);
		expect(kept).toHaveLength(2);
		expect(filtered).toHaveLength(0);
	});
});

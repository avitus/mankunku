import { describe, it, expect } from 'vitest';
import { buildSchedule } from '$lib/audio/backing-track-schedule';

// Helper: create a bass event at a given tick
function bass(ticks: number, midi: number, duration: number = 0.5) {
	return { time: `${ticks}i`, midi, duration };
}

// Helper: create a comp event at a given tick
function comp(ticks: number, notes: number[], duration: number = 0.3) {
	return { time: `${ticks}i`, notes, duration };
}

// At 120 BPM, PPQ 480: one beat = 0.5s, one tick = 0.5/480 s ≈ 0.001042s
const PPQ = 480;
const TEMPO = 120;
const TICK_OFFSET = 480; // 1-bar count-in at 4/4

describe('buildSchedule', () => {
	it('converts bass events from ticks to seconds', () => {
		const schedule = buildSchedule(
			[bass(0, 40)],
			[],
			TICK_OFFSET, PPQ, TEMPO
		);

		expect(schedule.notes).toHaveLength(1);
		// tick 0 + offset 480 = 480 ticks = 1 beat = 0.5s at 120 BPM
		expect(schedule.notes[0].startSeconds).toBeCloseTo(0.5, 4);
		expect(schedule.notes[0].midi).toBe(40);
		expect(schedule.notes[0].source).toBe('bass');
	});

	it('expands comp events into individual notes', () => {
		const schedule = buildSchedule(
			[],
			[comp(0, [60, 64, 67])],
			TICK_OFFSET, PPQ, TEMPO
		);

		expect(schedule.notes).toHaveLength(3);
		expect(schedule.notes.map(n => n.midi).sort()).toEqual([60, 64, 67]);
		schedule.notes.forEach(n => expect(n.source).toBe('comp'));
	});

	it('sorts notes by startSeconds', () => {
		const schedule = buildSchedule(
			[bass(960, 40), bass(0, 43)],
			[comp(480, [60])],
			TICK_OFFSET, PPQ, TEMPO
		);

		const starts = schedule.notes.map(n => n.startSeconds);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});

	it('returns empty schedule for empty events', () => {
		const schedule = buildSchedule([], [], TICK_OFFSET, PPQ, TEMPO);
		expect(schedule.notes).toHaveLength(0);
		expect(schedule.activeMidiAt(1.0)).toEqual([]);
	});
});

describe('activeMidiAt', () => {
	// Bass at beat 1 (tick 0 + offset 480 = 0.5s), duration 0.5s → active 0.5–1.0s
	// Comp at beat 2 (tick 480 + offset 480 = 1.0s), duration 0.3s → active 1.0–1.3s
	const schedule = buildSchedule(
		[bass(0, 40, 0.5)],
		[comp(480, [60, 64], 0.3)],
		TICK_OFFSET, PPQ, TEMPO
	);

	it('returns active MIDI at a time within a note', () => {
		expect(schedule.activeMidiAt(0.7, 0)).toEqual([40]);
	});

	it('returns empty when no notes are active', () => {
		// 1.5s is after both notes (without tolerance)
		expect(schedule.activeMidiAt(1.8, 0)).toEqual([]);
	});

	it('returns multiple MIDI when comp chord is active', () => {
		const result = schedule.activeMidiAt(1.1, 0);
		expect(result.sort()).toEqual([60, 64]);
	});

	it('uses tolerance window to widen match', () => {
		// Bass ends at 1.0s, but with 0.15s tolerance should still match at 1.1s
		expect(schedule.activeMidiAt(1.1, 0.15)).toContain(40);
	});

	it('does not match outside tolerance window', () => {
		// Bass ends at 1.0s; at 1.3s even with 0.15 tolerance it's outside
		expect(schedule.activeMidiAt(1.3, 0.15)).not.toContain(40);
	});

	it('tolerance also extends before note start', () => {
		// Bass starts at 0.5s; at 0.4s with 0.15 tolerance it should match
		expect(schedule.activeMidiAt(0.4, 0.15)).toContain(40);
	});
});

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

// Helper: create a drum event at a given tick
function drum(ticks: number) {
	return { time: `${ticks}i` };
}

// At 120 BPM, PPQ 480: one beat = 0.5s, one tick = 0.5/480 s ≈ 0.001042s
const PPQ = 480;
const TEMPO = 120;
const TICK_OFFSET = 480; // 1-bar count-in at 4/4... (1 beat here for compact numbers)

describe('buildSchedule', () => {
	it('converts bass events from ticks to seconds', () => {
		const schedule = buildSchedule([bass(0, 40)], [], [], TICK_OFFSET, PPQ, TEMPO);

		expect(schedule.notes).toHaveLength(1);
		// tick 0 + offset 480 = 480 ticks = 1 beat = 0.5s at 120 BPM
		expect(schedule.notes[0].startSeconds).toBeCloseTo(0.5, 4);
		expect(schedule.notes[0].midi).toBe(40);
		expect(schedule.notes[0].source).toBe('bass');
	});

	it('expands comp events into individual notes', () => {
		const schedule = buildSchedule([], [comp(0, [60, 64, 67])], [], TICK_OFFSET, PPQ, TEMPO);

		expect(schedule.notes).toHaveLength(3);
		expect(schedule.notes.map((n) => n.midi).sort()).toEqual([60, 64, 67]);
		schedule.notes.forEach((n) => expect(n.source).toBe('comp'));
	});

	it('sorts notes by startSeconds', () => {
		const schedule = buildSchedule(
			[bass(960, 40), bass(0, 43)],
			[comp(480, [60])],
			[],
			TICK_OFFSET, PPQ, TEMPO
		);

		const starts = schedule.notes.map((n) => n.startSeconds);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});

	it('returns empty schedule for empty events', () => {
		const schedule = buildSchedule([], [], [], TICK_OFFSET, PPQ, TEMPO);
		expect(schedule.notes).toHaveLength(0);
		expect(schedule.transientOnsets).toHaveLength(0);
		expect(schedule.activeMidiAt(1.0)).toEqual([]);
		expect(schedule.bleedEventsIn(0, 10)).toEqual([]);
	});
});

describe('activeMidiAt', () => {
	// Bass at beat 1 (tick 0 + offset 480 = 0.5s), duration 0.5s → active 0.5–1.0s
	// Comp at beat 2 (tick 480 + offset 480 = 1.0s), duration 0.3s → active 1.0–1.3s
	const schedule = buildSchedule(
		[bass(0, 40, 0.5)],
		[comp(480, [60, 64], 0.3)],
		[],
		TICK_OFFSET, PPQ, TEMPO
	);

	it('returns active MIDI at a time within a note', () => {
		expect(schedule.activeMidiAt(0.7, 0)).toEqual([40]);
	});

	it('returns empty when no notes are active', () => {
		// 1.8s is after both notes (without tolerance)
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

	it('wraps loop-mode queries onto the first pass', () => {
		// Loop of one bar (4 beats = 1920 ticks = 2s). Bass sounds 0.5–1.0s
		// of every pass; pass 3 puts it at 6.5–7.0s.
		const looped = buildSchedule([bass(0, 40, 0.5)], [], [], TICK_OFFSET, PPQ, TEMPO, 1920);
		expect(looped.loopSeconds).toBeCloseTo(2, 6);
		expect(looped.activeMidiAt(6.7, 0)).toEqual([40]);
		expect(looped.activeMidiAt(6.2, 0)).toEqual([]);
		// Pre-loop (count-in) time passes through unwrapped.
		expect(looped.activeMidiAt(0.2, 0)).toEqual([]);
	});
});

describe('transientOnsets', () => {
	it('includes bass, comp and drum onsets, sorted', () => {
		const schedule = buildSchedule(
			[bass(0, 40)],
			[comp(480, [60, 64])],
			[drum(960)],
			TICK_OFFSET, PPQ, TEMPO
		);
		// 0.5s (bass), 1.0s (comp chord = ONE transient), 1.5s (drum)
		expect(schedule.transientOnsets.map((t) => Number(t.toFixed(4)))).toEqual([0.5, 1.0, 1.5]);
	});

	it('dedupes hits landing within 30ms — a downbeat is one bleed event', () => {
		const schedule = buildSchedule(
			[bass(0, 40)],
			[comp(5, [60, 64])], // ~10ms after the bass at this tempo/ppq
			[drum(0), drum(10)],
			TICK_OFFSET, PPQ, TEMPO
		);
		expect(schedule.transientOnsets).toHaveLength(1);
	});
});

describe('bleedEventsIn', () => {
	it('returns recording-relative onsets inside the window', () => {
		const schedule = buildSchedule(
			[bass(0, 40)],
			[comp(480, [60])],
			[drum(960)],
			TICK_OFFSET, PPQ, TEMPO
		);
		// Recording starts at 0.9s transport for 1s: comp (1.0s) and drum (1.5s) land inside.
		const onsets = schedule.bleedEventsIn(0.9, 1.0);
		expect(onsets.map((t) => Number(t.toFixed(4)))).toEqual([0.1, 0.6]);
	});

	it('applies the 250ms pre-recording lookback', () => {
		const schedule = buildSchedule([bass(0, 40)], [], [], TICK_OFFSET, PPQ, TEMPO);
		// Bass at 0.5s; recording starts at 0.6s → onset 0.1s BEFORE recording,
		// inside the lookback, reported as negative recording-relative time
		// (matching getMetronomeBleedOnsets' convention).
		const onsets = schedule.bleedEventsIn(0.6, 1.0);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(-0.1, 4);
	});

	it('repeats onsets across loop passes', () => {
		// One-bar loop (2s), single bass onset at 0.5s of each pass.
		const schedule = buildSchedule([bass(0, 40)], [], [], TICK_OFFSET, PPQ, TEMPO, 1920);
		// Recording spans transport 4.0–8.0s = passes 2 and 3 → onsets at 4.5, 6.5.
		const onsets = schedule.bleedEventsIn(4.0, 4.0);
		expect(onsets.map((t) => Number(t.toFixed(4)))).toEqual([0.5, 2.5]);
	});

	it('covers a long recording far past the first pass (the old coverage hole)', () => {
		const schedule = buildSchedule([bass(0, 40)], [], [], TICK_OFFSET, PPQ, TEMPO, 1920);
		// 30 passes in: still reports the onset.
		const onsets = schedule.bleedEventsIn(60.0, 2.0);
		expect(onsets.length).toBeGreaterThan(0);
	});

	it('returns nothing for a zero-length window', () => {
		const schedule = buildSchedule([bass(0, 40)], [], [], TICK_OFFSET, PPQ, TEMPO);
		expect(schedule.bleedEventsIn(0.5, 0)).toEqual([]);
	});
});

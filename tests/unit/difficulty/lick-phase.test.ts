import { describe, it, expect } from 'vitest';
import {
	ALL_KEYS,
	PROFICIENT_BPM,
	EXPERT_BPM,
	lickPhase,
	phaseDisplay,
	currentLickPhase,
	allKeysUnlockedAt,
	unlockEvents,
	collapseUnlockMarkers,
	unlockMarkerLabel,
	bpmAxisRange,
	bpmBandSlices,
	type UnlockMarker
} from '$lib/difficulty/lick-phase';
import type { LickProgressPoint } from '$lib/types/lick-practice';

const pt = (t: number, bpm: number, keys: number): LickProgressPoint => ({ t, bpm, keys });

describe('lickPhase', () => {
	it('is "new" below the full key set, however fast the tempo', () => {
		expect(lickPhase(60, 1)).toBe('new');
		expect(lickPhase(200, 11)).toBe('new');
	});

	it('is "learning" once all keys are unlocked and below the proficient tempo', () => {
		expect(lickPhase(60, ALL_KEYS)).toBe('learning');
		expect(lickPhase(PROFICIENT_BPM - 1, ALL_KEYS)).toBe('learning');
	});

	it('promotes to "proficient" AT the threshold tempo, not past it', () => {
		expect(lickPhase(PROFICIENT_BPM, ALL_KEYS)).toBe('proficient');
	});

	it('is "proficient" up to the expert threshold', () => {
		expect(lickPhase(EXPERT_BPM - 1, ALL_KEYS)).toBe('proficient');
	});

	it('promotes to "expert" AT the expert tempo and beyond', () => {
		expect(lickPhase(EXPERT_BPM, ALL_KEYS)).toBe('expert');
		expect(lickPhase(220, ALL_KEYS)).toBe('expert');
	});

	it('treats a key count above the cap as a full set (merged/legacy data)', () => {
		expect(lickPhase(160, ALL_KEYS + 3)).toBe('expert');
	});
});

describe('phaseDisplay', () => {
	it('labels each phase and colours it from the mastery ramp, ascending', () => {
		expect(phaseDisplay('new').label).toBe('new');
		expect(phaseDisplay('learning').label).toBe('learning');
		expect(phaseDisplay('proficient').label).toBe('proficient');
		expect(phaseDisplay('expert').label).toBe('expert');

		const bands = (['new', 'learning', 'proficient', 'expert'] as const).map((p) => {
			const m = /^var\(--mastery-(\d+)\)$/.exec(phaseDisplay(p).color);
			expect(m).not.toBeNull();
			return Number(m![1]);
		});
		expect(bands).toStrictEqual([...bands].sort((a, b) => a - b));
		expect(new Set(bands).size).toBe(4);
	});
});

describe('currentLickPhase', () => {
	it('reads the newest sample, not the newest-appended one', () => {
		// Deliberately out of order: history merges can append an older sample.
		const points = [pt(300, 155, 12), pt(100, 60, 4), pt(200, 130, 12)];
		expect(currentLickPhase(points)).toBe('expert');
	});

	it('returns null with no samples', () => {
		expect(currentLickPhase([])).toBeNull();
	});
});

describe('allKeysUnlockedAt', () => {
	it('returns the timestamp of the first full-key sample', () => {
		const points = [pt(100, 60, 6), pt(200, 70, 12), pt(300, 80, 12)];
		expect(allKeysUnlockedAt(points)).toBe(200);
	});

	it('returns null while the lick is still unlocking keys', () => {
		expect(allKeysUnlockedAt([pt(100, 60, 6), pt(200, 70, 11)])).toBeNull();
	});

	it('sorts before scanning, so an out-of-order series still finds the earliest', () => {
		const points = [pt(300, 80, 12), pt(100, 60, 6), pt(200, 70, 12)];
		expect(allKeysUnlockedAt(points)).toBe(200);
	});
});

describe('unlockEvents', () => {
	it('emits an event per key-count increase, carrying the tempo at that moment', () => {
		const points = [pt(100, 60, 1), pt(200, 65, 2), pt(300, 65, 3)];
		expect(unlockEvents(points)).toStrictEqual([
			{ t: 200, bpm: 65, from: 1, to: 2 },
			{ t: 300, bpm: 65, from: 2, to: 3 }
		]);
	});

	it('does not treat the first sample as an unlock (history may start mid-climb)', () => {
		expect(unlockEvents([pt(100, 60, 5)])).toStrictEqual([]);
	});

	it('ignores samples where only the tempo moved', () => {
		const points = [pt(100, 60, 12), pt(200, 65, 12), pt(300, 70, 12)];
		expect(unlockEvents(points)).toStrictEqual([]);
	});

	it('never emits an event for a key count that went backwards', () => {
		const points = [pt(100, 60, 5), pt(200, 65, 4), pt(300, 70, 6)];
		expect(unlockEvents(points)).toStrictEqual([{ t: 300, bpm: 70, from: 4, to: 6 }]);
	});

	it('sorts before scanning, so an out-of-order series still pairs neighbours', () => {
		const points = [pt(300, 70, 3), pt(100, 60, 1), pt(200, 65, 2)];
		expect(unlockEvents(points)).toStrictEqual([
			{ t: 200, bpm: 65, from: 1, to: 2 },
			{ t: 300, bpm: 70, from: 2, to: 3 }
		]);
	});

	it('records a multi-key jump as one event spanning the range', () => {
		const points = [pt(100, 60, 2), pt(200, 65, 5)];
		expect(unlockEvents(points)).toStrictEqual([{ t: 200, bpm: 65, from: 2, to: 5 }]);
	});
});

describe('collapseUnlockMarkers', () => {
	const marker = (x: number, from: number, to: number): UnlockMarker => ({ x, y: 40, from, to });

	it('keeps markers that clear the minimum gap', () => {
		const markers = [marker(10, 1, 2), marker(40, 2, 3)];
		expect(collapseUnlockMarkers(markers, 12)).toStrictEqual(markers);
	});

	it('merges a marker that crowds its predecessor, keeping the earlier position', () => {
		const merged = collapseUnlockMarkers([marker(10, 1, 2), marker(15, 2, 3)], 12);
		expect(merged).toStrictEqual([{ x: 10, y: 40, from: 1, to: 3 }]);
	});

	it('collapses a dense run into a single marker spanning every key in it', () => {
		const merged = collapseUnlockMarkers(
			[marker(10, 1, 2), marker(16, 2, 3), marker(20, 3, 4), marker(40, 4, 5)],
			12
		);
		expect(merged).toStrictEqual([
			{ x: 10, y: 40, from: 1, to: 4 },
			{ x: 40, y: 40, from: 4, to: 5 }
		]);
	});

	it('measures the gap from the last KEPT marker, not the previous input', () => {
		// 22 crowds 16, but 16 was absorbed — 22 clears the kept marker at 10, so
		// it draws rather than chaining into an ever-growing merge.
		const merged = collapseUnlockMarkers([marker(10, 1, 2), marker(16, 2, 3), marker(22, 3, 4)], 12);
		expect(merged).toStrictEqual([
			{ x: 10, y: 40, from: 1, to: 3 },
			{ x: 22, y: 40, from: 3, to: 4 }
		]);
	});

	it('returns an empty list unchanged', () => {
		expect(collapseUnlockMarkers([], 12)).toStrictEqual([]);
	});
});

describe('unlockMarkerLabel', () => {
	it('names a single unlock by its ordinal', () => {
		expect(unlockMarkerLabel({ x: 0, y: 0, from: 1, to: 2 })).toBe('2nd key unlocked');
		expect(unlockMarkerLabel({ x: 0, y: 0, from: 2, to: 3 })).toBe('3rd key unlocked');
		expect(unlockMarkerLabel({ x: 0, y: 0, from: 10, to: 11 })).toBe('11th key unlocked');
		expect(unlockMarkerLabel({ x: 0, y: 0, from: 11, to: 12 })).toBe('12th key unlocked');
	});

	it('names a merged marker as a range', () => {
		expect(unlockMarkerLabel({ x: 0, y: 0, from: 2, to: 5 })).toBe('keys 3–5 unlocked');
	});
});

describe('bpmAxisRange', () => {
	it('pads and snaps to 10 BPM around the data', () => {
		expect(bpmAxisRange([64, 78])).toStrictEqual({ lo: 50, hi: 90 });
	});

	it('never drops below zero', () => {
		expect(bpmAxisRange([5])).toStrictEqual({ lo: 0, hi: 20 });
	});

	it('keeps a flat series off the panel edges', () => {
		const { lo, hi } = bpmAxisRange([100, 100]);
		expect(lo).toBeLessThan(100);
		expect(hi).toBeGreaterThan(100);
	});

	it('reaches up to the next phase threshold when it is within 20 BPM', () => {
		// padded hi would be 110; 120 is close enough to be worth showing.
		expect(bpmAxisRange([95]).hi).toBe(PROFICIENT_BPM);
		// padded hi would be 140; the expert line is the next goal.
		expect(bpmAxisRange([125]).hi).toBe(EXPERT_BPM);
	});

	it('does not stretch to a threshold that is out of reach', () => {
		expect(bpmAxisRange([62]).hi).toBe(80);
	});

	it('falls back to a sane range with no data', () => {
		expect(bpmAxisRange([])).toStrictEqual({ lo: 0, hi: 100 });
	});
});

describe('bpmBandSlices', () => {
	it('clips each band to the visible range and drops the ones off-panel', () => {
		expect(bpmBandSlices(50, 90)).toStrictEqual([{ phase: 'learning', from: 50, to: 90 }]);
	});

	it('splits the range at a threshold that falls inside it', () => {
		expect(bpmBandSlices(100, 140)).toStrictEqual([
			{ phase: 'learning', from: 100, to: PROFICIENT_BPM },
			{ phase: 'proficient', from: PROFICIENT_BPM, to: 140 }
		]);
	});

	it('covers all three bands when the range spans both thresholds', () => {
		expect(bpmBandSlices(110, 170)).toStrictEqual([
			{ phase: 'learning', from: 110, to: PROFICIENT_BPM },
			{ phase: 'proficient', from: PROFICIENT_BPM, to: EXPERT_BPM },
			{ phase: 'expert', from: EXPERT_BPM, to: 170 }
		]);
	});

	it('emits a single expert band for a fast lick', () => {
		expect(bpmBandSlices(160, 200)).toStrictEqual([{ phase: 'expert', from: 160, to: 200 }]);
	});

	it('does not emit a zero-height slice when the range starts exactly on a threshold', () => {
		expect(bpmBandSlices(PROFICIENT_BPM, 140)).toStrictEqual([
			{ phase: 'proficient', from: PROFICIENT_BPM, to: 140 }
		]);
	});

	it('returns nothing for an inverted or empty range', () => {
		expect(bpmBandSlices(120, 120)).toStrictEqual([]);
		expect(bpmBandSlices(140, 100)).toStrictEqual([]);
	});
});

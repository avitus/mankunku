import { describe, it, expect, vi } from 'vitest';
import type { DetectedNote } from '$lib/types/audio';
import type { MatchResult } from '$lib/matching/search';
import { createFreestyleRecognizer } from '$lib/matching/freestyle';
import type { FreestyleBook } from '$lib/matching/book-index';

const BAR_TICKS = 1920;

function note(midi: number, onsetTime: number): DetectedNote {
	return { midi, cents: 0, onsetTime, duration: 0.2, clarity: 0.95 };
}

/** n distinct detected notes — enough for the 5-interval matcher floor. */
function line(n: number): DetectedNote[] {
	return Array.from({ length: n }, (_, i) => note(60 + (i % 12), i * 0.25));
}

function mkBook(overrides: Partial<FreestyleBook> = {}): FreestyleBook {
	return {
		index: { sources: [], phrases: [], ngramIndex: {}, ngramSize: 5, builtAt: '' },
		names: new Map([['lick-a', 'Lick A'], ['lick-b', 'Lick B']]),
		durationTicks: new Map([
			['lick-a', 3 * BAR_TICKS],
			['lick-b', BAR_TICKS / 2]
		]),
		...overrides
	};
}

function result(sourceId: string, score: number): MatchResult {
	return {
		sourceId,
		source: { id: sourceId, kind: 'quote', performer: '', title: sourceId },
		score,
		matched: 7,
		queryLength: 7
	};
}

describe('createFreestyleRecognizer', () => {
	it('fires only at or above the quote-confidence bar', () => {
		const search = vi.fn().mockReturnValue([result('lick-a', 0.85)]);
		const rec = createFreestyleRecognizer({ book: mkBook(), tempo: 120, barTicks: BAR_TICKS, search });
		expect(rec.scan(line(8), 1000)).toBeNull();

		search.mockReturnValue([result('lick-a', 0.92)]);
		const match = rec.scan(line(9), 2000);
		expect(match).toEqual({ lickId: 'lick-a', name: 'Lick A', score: 0.92, atTick: 2000 });
	});

	it('skips scans when no new notes arrived (silence guard)', () => {
		const search = vi.fn().mockReturnValue([result('lick-a', 0.95)]);
		const rec = createFreestyleRecognizer({ book: mkBook(), tempo: 120, barTicks: BAR_TICKS, search });
		expect(rec.scan(line(8), 1000)).not.toBeNull();
		expect(rec.scan(line(8), 2000)).toBeNull();
		expect(search).toHaveBeenCalledTimes(1);
	});

	it('never calls search below the 6-note matcher floor', () => {
		const search = vi.fn();
		const rec = createFreestyleRecognizer({ book: mkBook(), tempo: 120, barTicks: BAR_TICKS, search });
		expect(rec.scan(line(5), 1000)).toBeNull();
		expect(search).not.toHaveBeenCalled();
	});

	it('holds a fired lick in cooldown for its own duration', () => {
		const search = vi.fn().mockReturnValue([result('lick-a', 0.95)]);
		const rec = createFreestyleRecognizer({ book: mkBook(), tempo: 120, barTicks: BAR_TICKS, search });
		expect(rec.scan(line(8), 0)).not.toBeNull();
		// lick-a lasts 3 bars — a re-match 2 bars in stays quiet…
		expect(rec.scan(line(9), 2 * BAR_TICKS)).toBeNull();
		// …and fires again after the cooldown lapses.
		expect(rec.scan(line(10), 3 * BAR_TICKS + 1)).not.toBeNull();
	});

	it('clamps short-lick cooldowns to one bar', () => {
		const search = vi.fn().mockReturnValue([result('lick-b', 0.95)]);
		const rec = createFreestyleRecognizer({ book: mkBook(), tempo: 120, barTicks: BAR_TICKS, search });
		expect(rec.scan(line(8), 0)).not.toBeNull();
		// lick-b is half a bar long, but the floor is one full bar.
		expect(rec.scan(line(9), BAR_TICKS / 2 + 1)).toBeNull();
		expect(rec.scan(line(10), BAR_TICKS + 1)).not.toBeNull();
	});

	it('lets a different lick fire during another lick cooldown', () => {
		const search = vi.fn().mockReturnValue([result('lick-a', 0.95)]);
		const rec = createFreestyleRecognizer({ book: mkBook(), tempo: 120, barTicks: BAR_TICKS, search });
		expect(rec.scan(line(8), 0)?.lickId).toBe('lick-a');
		search.mockReturnValue([result('lick-a', 0.95), result('lick-b', 0.93)]);
		expect(rec.scan(line(9), BAR_TICKS / 2)?.lickId).toBe('lick-b');
	});
});

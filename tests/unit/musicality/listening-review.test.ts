import { describe, expect, it } from 'vitest';
import type { ListeningSnapshot } from '$lib/musicality/listening-player';
import type { BounceParams } from '$lib/audio/backing-bounce';
import { getListeningReviewExtent, selectListeningReviewBar } from '$lib/musicality/listening-review';

function snapshot(overrides: Partial<ListeningSnapshot> = {}): ListeningSnapshot {
	return {
		status: 'stopped', generated: { bassEvents: [], compEvents: [], drumEvents: [] },
		params: { tempo: 120, phrase: { timeSignature: [4, 4] } } as unknown as BounceParams,
		ppq: 192, startAudioTime: 10, audioTime: 14.5, elapsedBeats: 9, durationBeats: 16,
		barIndex: 2, ending: false, error: null,
		provenance: { engine: 'causal-rolling', sessionId: 'take', fingerprint: 'policy',
			totalBars: 4, committedBars: 4, committedThroughTick: 3072, sessionStatus: 'stopped', dispatches: [] },
		...overrides
	};
}

it('reviews committed silent bars already reached by the clock, never committed lookahead', () => {
	const take = snapshot();
	expect(getListeningReviewExtent(take, 4)).toEqual({ firstBarIndex: 0, lastBarIndex: 2, barCount: 3 });
	const before = JSON.stringify(take);
	const extent = getListeningReviewExtent(take, 4)!;
	expect(Object.isFrozen(extent)).toBe(true);
	expect(selectListeningReviewBar(1, extent)).toBe(1);
	expect(selectListeningReviewBar(3, extent)).toBeNull();
	expect(JSON.stringify(take)).toBe(before);
});

it('bounds an error take by its actual committed prefix even if the clock reached farther', () => {
	const take = snapshot({ status: 'error', error: 'missed scheduling deadline' });
	take.provenance = { ...take.provenance!, committedBars: 2, committedThroughTick: 1536 };
	expect(getListeningReviewExtent(take, 4)).toEqual({ firstBarIndex: 0, lastBarIndex: 1, barCount: 2 });
	expect(take.status).toBe('error');
});

it('keeps Original fixed scores bounded by reached audio, then permits the full completed take', () => {
	const take = snapshot({ provenance: { engine: 'fixed', totalBars: 4, committedBars: 4, committedThroughTick: 3072 } });
	expect(getListeningReviewExtent(take, 4)?.lastBarIndex).toBe(2);
	const complete = { ...take, status: 'completed' as const, audioTime: 20.5, elapsedBeats: 16, barIndex: 3 };
	expect(getListeningReviewExtent(complete, 4)?.lastBarIndex).toBe(3);
});

it('uses captured tempo and the least advanced actual clock cursor without consulting editable controls', () => {
	const take = snapshot();
	// A stale UI cursor cannot reveal bars the actual captured audio clock has not reached.
	expect(getListeningReviewExtent({ ...take, audioTime: 11 }, 4)?.lastBarIndex).toBe(0);
	expect(getListeningReviewExtent({ ...take, elapsedBeats: 3.9 }, 4)?.lastBarIndex).toBe(0);
	expect(getListeningReviewExtent({ ...take, barIndex: 1 }, 4)?.lastBarIndex).toBe(1);
	expect(getListeningReviewExtent(take, 3)).toBeNull();
});

it('disables review while live or loading, including the release tail, without altering a requested selection', () => {
	for (const status of ['idle', 'loading', 'playing'] as const) {
		expect(getListeningReviewExtent(snapshot({ status, ending: true }), 4)).toBeNull();
	}
	expect(selectListeningReviewBar(1, null)).toBeNull();
});

describe('unavailable and malformed evidence', () => {
	it('does not infer a prefix or a reached bar from missing clocks, settings, provenance or events', () => {
		for (const patch of [
			{ generated: null }, { params: null }, { provenance: undefined }, { barIndex: null },
			{ startAudioTime: null }, { audioTime: null }, { audioTime: 9 }, { elapsedBeats: -1 },
			{ elapsedBeats: 17 }, { elapsedBeats: NaN }, { durationBeats: Infinity },
			{ ppq: 0 }, { ppq: 1.5 }, { barIndex: -1 }, { barIndex: 4 }, { barIndex: 1.5 }
		]) expect(getListeningReviewExtent(snapshot(patch), 4)).toBeNull();
		for (const totalBars of [0, -1, 1.5, NaN, Infinity]) expect(getListeningReviewExtent(snapshot(), totalBars)).toBeNull();
	});

	it('rejects unknown or inconsistent provenance and an empty prefix', () => {
		const take = snapshot();
		for (const patch of [
			{ engine: 'unknown' }, { totalBars: 3 }, { committedBars: 0, committedThroughTick: 0 },
			{ committedBars: 5 }, { committedBars: 1.5 }, { committedThroughTick: 768 },
			{ committedThroughTick: NaN }
		]) {
			const provenance = { ...take.provenance!, ...patch } as ListeningSnapshot['provenance'];
			expect(getListeningReviewExtent({ ...take, provenance }, 4)).toBeNull();
		}
		for (const tempo of [0, -1, NaN, Infinity]) {
			expect(getListeningReviewExtent({ ...take, params: { ...take.params!, tempo } }, 4)).toBeNull();
		}
	});

	it('rejects invalid or stale mark selections instead of moving them to a different bar', () => {
		const extent = { firstBarIndex: 0 as const, lastBarIndex: 2, barCount: 3 };
		for (const value of [null, -1, 3, 1.5, NaN, Infinity]) expect(selectListeningReviewBar(value, extent)).toBeNull();
		expect(selectListeningReviewBar(0, extent)).toBe(0);
		expect(selectListeningReviewBar(2, extent)).toBe(2);
		expect(selectListeningReviewBar(0, { ...extent, lastBarIndex: -1 })).toBeNull();
	});
});

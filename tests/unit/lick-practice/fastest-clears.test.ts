import { describe, it, expect } from 'vitest';
import { fastestClearByKey } from '$lib/state/lick-practice-rotation';

describe('fastestClearByKey', () => {
	it('keeps the highest tempo each key cleared at, in played order', () => {
		// The 2026-10-10 Wail focus drill: Bb and Eb clearing over and over
		// as the tempo climbed, most rounds clearing nothing.
		const rounds = [
			{ round: 1, tempo: 50, keys: ['Bb' as const] },
			{ round: 2, tempo: 50, keys: [] },
			{ round: 4, tempo: 50, keys: ['Eb' as const, 'Bb' as const] },
			{ round: 13, tempo: 52, keys: ['Eb' as const] },
			{ round: 17, tempo: 54, keys: ['Bb' as const, 'Eb' as const] },
			{ round: 20, tempo: 53, keys: ['Bb' as const] }
		];
		expect(fastestClearByKey(rounds, ['Eb', 'Bb', 'F'])).toEqual([
			{ key: 'Eb', tempo: 54 },
			{ key: 'Bb', tempo: 54 },
			{ key: 'F', tempo: null }
		]);
	});

	it('appends a cleared key the played list does not name', () => {
		expect(fastestClearByKey([{ round: 1, tempo: 90, keys: ['C'] }], [])).toEqual([
			{ key: 'C', tempo: 90 }
		]);
	});

	it('is empty with no rounds and no played keys', () => {
		expect(fastestClearByKey([], [])).toEqual([]);
	});
});

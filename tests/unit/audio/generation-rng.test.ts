import { describe, it, expect } from 'vitest';
import { createRng, seedFrom } from '$lib/audio/generation-rng';

describe('createRng', () => {
	it('produces an identical sequence for the same seed', () => {
		const a = createRng(12345);
		const b = createRng(12345);
		const seqA = Array.from({ length: 20 }, () => a.float());
		const seqB = Array.from({ length: 20 }, () => b.float());
		expect(seqA).toEqual(seqB);
	});

	it('advances the stream for every seed, including 0', () => {
		// The mulberry32 core is a pure xorshift-multiply: a zero state maps
		// to zero forever, so an unguarded seed 0 (which seedFrom can emit)
		// would freeze every draw at 0 — chance() always true, weighted()
		// always the first entry.
		for (const seed of [0, 1, 0xffffffff]) {
			const rng = createRng(seed);
			const draws = new Set(Array.from({ length: 16 }, () => rng.float()));
			expect(draws.size).toBeGreaterThan(1);
		}
	});

	it('produces different sequences for different seeds', () => {
		const a = createRng(1);
		const b = createRng(2);
		const seqA = Array.from({ length: 8 }, () => a.float());
		const seqB = Array.from({ length: 8 }, () => b.float());
		expect(seqA).not.toEqual(seqB);
	});

	it('float() stays in [0, 1)', () => {
		const rng = createRng(99);
		for (let i = 0; i < 1000; i++) {
			const f = rng.float();
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThan(1);
		}
	});

	it('int() covers both inclusive endpoints and nothing outside', () => {
		const rng = createRng(7);
		const seen = new Set<number>();
		for (let i = 0; i < 500; i++) {
			const n = rng.int(2, 5);
			expect(n).toBeGreaterThanOrEqual(2);
			expect(n).toBeLessThanOrEqual(5);
			seen.add(n);
		}
		expect(seen).toEqual(new Set([2, 3, 4, 5]));
	});

	it('chance() is always false at 0 and always true at 1', () => {
		const rng = createRng(11);
		for (let i = 0; i < 100; i++) {
			expect(rng.chance(0)).toBe(false);
			expect(rng.chance(1)).toBe(true);
		}
	});

	it('pick() returns a member of the list', () => {
		const rng = createRng(3);
		const items = ['a', 'b', 'c'];
		for (let i = 0; i < 100; i++) {
			expect(items).toContain(rng.pick(items));
		}
	});

	it('weighted() never returns a zero-weight entry', () => {
		const rng = createRng(5);
		for (let i = 0; i < 200; i++) {
			const v = rng.weighted([
				{ value: 'never', weight: 0 },
				{ value: 'a', weight: 1 },
				{ value: 'b', weight: 3 }
			]);
			expect(v).not.toBe('never');
		}
	});

	it('weighted() favours heavier entries', () => {
		const rng = createRng(6);
		let heavy = 0;
		for (let i = 0; i < 1000; i++) {
			if (rng.weighted([{ value: 'light', weight: 1 }, { value: 'heavy', weight: 9 }]) === 'heavy') {
				heavy++;
			}
		}
		expect(heavy).toBeGreaterThan(800);
		expect(heavy).toBeLessThan(980);
	});

	it('weighted() returns the last entry when every weight is zero', () => {
		// The documented caller contract: it still draws exactly once, so
		// determinism holds, and the LAST entry is the answer.
		const rng = createRng(8);
		for (let i = 0; i < 20; i++) {
			expect(
				rng.weighted([
					{ value: 'a', weight: 0 },
					{ value: 'b', weight: 0 },
					{ value: 'last', weight: 0 }
				])
			).toBe('last');
		}
	});

	it('weighted() treats a negative weight as zero', () => {
		const rng = createRng(9);
		for (let i = 0; i < 200; i++) {
			expect(rng.weighted([{ value: 'neg', weight: -5 }, { value: 'a', weight: 1 }])).toBe('a');
		}
	});

	it('int() with equal bounds always returns that bound', () => {
		const rng = createRng(10);
		for (let i = 0; i < 50; i++) expect(rng.int(4, 4)).toBe(4);
	});

	it('chance(p) is true about p of the time between the short-circuits', () => {
		const rng = createRng(12);
		let hits = 0;
		for (let i = 0; i < 1000; i++) if (rng.chance(0.3)) hits++;
		expect(hits).toBeGreaterThan(240);
		expect(hits).toBeLessThan(360);
	});
});

describe('seedFrom', () => {
	it('is stable for the same inputs', () => {
		expect(seedFrom('lick-1', 120, 0, 3)).toBe(seedFrom('lick-1', 120, 0, 3));
	});

	it('changes when any input changes', () => {
		const base = seedFrom('lick-1', 120, 0, 3);
		expect(seedFrom('lick-2', 120, 0, 3)).not.toBe(base);
		expect(seedFrom('lick-1', 140, 0, 3)).not.toBe(base);
		expect(seedFrom('lick-1', 120, 1, 3)).not.toBe(base);
		expect(seedFrom('lick-1', 120, 0, 4)).not.toBe(base);
	});

	it('is order-sensitive', () => {
		expect(seedFrom('a', 'b')).not.toBe(seedFrom('b', 'a'));
	});
});

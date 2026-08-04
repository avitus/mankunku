/**
 * Seeded Fisher-Yates shuffle.
 *
 * Uses the mulberry32 PRNG for deterministic, well-distributed output.
 * Given the same items and seed, always produces the same order.
 */

/** Mulberry32 PRNG — returns a function that yields floats in [0, 1). */
function mulberry32(seed: number): () => number {
	// A zero state maps to zero forever (the core is a pure
	// xorshift-multiply), which would degenerate the shuffle; nudge it
	// onto a real orbit. Matches audio/generation-rng.ts.
	let s = seed | 0;
	if (s === 0) s = 0x9e3779b9 | 0;
	return () => {
		s = Math.imul(s ^ (s >>> 16), 2246822507);
		s = Math.imul(s ^ (s >>> 13), 3266489909);
		return ((s ^= s >>> 16) >>> 0) / 4294967296;
	};
}

/** Return a shuffled copy of `items` using a deterministic seed. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
	const result = [...items];
	const rng = mulberry32(seed);
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

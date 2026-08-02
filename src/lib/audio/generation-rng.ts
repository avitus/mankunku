/**
 * Deterministic pseudo-random generation for the backing track engine.
 *
 * Every musical choice the generators make (approach devices, comp figures,
 * velocity shading, drum accents) draws from a seeded stream so that
 * replaying the same phrase at the same tempo reproduces the exact same
 * backing — the diagnostics log stays truthful and regression tests can
 * assert on generated output.
 *
 * The core PRNG is mulberry32, matching `util/seeded-shuffle.ts`.
 */

export interface SeededRng {
	/** Uniform float in [0, 1). */
	float(): number;
	/** Uniform integer in [min, max], both inclusive. */
	int(min: number, max: number): number;
	/** True with the given probability. Always false at 0, always true at 1. */
	chance(probability: number): boolean;
	/** Uniformly chosen member of a non-empty list. */
	pick<T>(items: readonly T[]): T;
	/** Weighted choice; zero-weight entries are never returned. */
	weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T;
}

/** Mulberry32 PRNG stream with musical-choice helpers. */
export function createRng(seed: number): SeededRng {
	let s = seed | 0;
	const float = (): number => {
		s = Math.imul(s ^ (s >>> 16), 2246822507);
		s = Math.imul(s ^ (s >>> 13), 3266489909);
		return ((s ^= s >>> 16) >>> 0) / 4294967296;
	};
	return {
		float,
		int(min: number, max: number): number {
			return min + Math.floor(float() * (max - min + 1));
		},
		chance(probability: number): boolean {
			if (probability <= 0) return false;
			if (probability >= 1) return true;
			return float() < probability;
		},
		pick<T>(items: readonly T[]): T {
			return items[Math.floor(float() * items.length)];
		},
		weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T {
			let total = 0;
			for (const e of entries) total += Math.max(0, e.weight);
			let roll = float() * total;
			for (const e of entries) {
				roll -= Math.max(0, e.weight);
				if (roll < 0 && e.weight > 0) return e.value;
			}
			// Numeric edge (roll === total): last positive-weight entry.
			for (let i = entries.length - 1; i >= 0; i--) {
				if (entries[i].weight > 0) return entries[i].value;
			}
			return entries[entries.length - 1].value;
		}
	};
}

/**
 * Derive a 32-bit seed from stable inputs (FNV-1a over the joined parts).
 * Callers pass e.g. (phraseId, tempo, chorusIndex, barIndex) so the same
 * bar of the same phrase always seeds the same stream, while any change
 * of position or context yields an independent one.
 */
export function seedFrom(...parts: Array<string | number>): number {
	const key = parts.join('|');
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

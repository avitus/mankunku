import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	DEFAULT_BACKING_MIX,
	normalizeBackingMix,
	loadBackingMix,
	saveBackingMix,
	voiceVelocity,
	type BackingMixLevels
} from '$lib/audio/backing-mix';

/** Minimal localStorage stub for the Node test environment. */
function stubStorage(): Record<string, string> {
	const store: Record<string, string> = {};
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => (k in store ? store[k] : null),
		setItem: (k: string, v: string) => {
			store[k] = String(v);
		},
		removeItem: (k: string) => {
			delete store[k];
		}
	};
	return store;
}

afterEach(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('normalizeBackingMix', () => {
	it('returns defaults for junk input', () => {
		expect(normalizeBackingMix(undefined)).toEqual(DEFAULT_BACKING_MIX);
		expect(normalizeBackingMix(null)).toEqual(DEFAULT_BACKING_MIX);
		expect(normalizeBackingMix('nope')).toEqual(DEFAULT_BACKING_MIX);
		expect(normalizeBackingMix(42)).toEqual(DEFAULT_BACKING_MIX);
	});

	it('merges partial values over defaults', () => {
		const mix = normalizeBackingMix({ bass: 0.6, kick: 2 });
		expect(mix.bass).toBe(0.6);
		expect(mix.kick).toBe(2);
		expect(mix.comp).toBe(DEFAULT_BACKING_MIX.comp);
		expect(mix.ride).toBe(DEFAULT_BACKING_MIX.ride);
	});

	it('clamps values into [0, 3] and drops non-finite ones', () => {
		const mix = normalizeBackingMix({ bass: -1, comp: 99, drums: NaN, kick: Infinity });
		expect(mix.bass).toBe(0);
		expect(mix.comp).toBe(3);
		expect(mix.drums).toBe(DEFAULT_BACKING_MIX.drums);
		expect(mix.kick).toBe(DEFAULT_BACKING_MIX.kick);
	});

	it('ignores unknown keys', () => {
		const mix = normalizeBackingMix({ bass: 0.5, master: 9 });
		expect(mix).toEqual({ ...DEFAULT_BACKING_MIX, bass: 0.5 });
		expect('master' in mix).toBe(false);
	});
});

describe('load/save round-trip', () => {
	it('round-trips through localStorage', () => {
		stubStorage();
		const tuned: BackingMixLevels = { bass: 0.7, comp: 1.4, drums: 1.1, kick: 2.2, ride: 0.9, hihat: 1 };
		saveBackingMix(tuned);
		expect(loadBackingMix()).toEqual(tuned);
	});

	it('returns defaults when storage is empty or absent', () => {
		stubStorage();
		expect(loadBackingMix()).toEqual(DEFAULT_BACKING_MIX);
		delete (globalThis as { localStorage?: unknown }).localStorage;
		expect(loadBackingMix()).toEqual(DEFAULT_BACKING_MIX);
	});

	it('normalizes corrupted stored values instead of throwing', () => {
		const store = stubStorage();
		store['backing-mix-levels'] = '{"bass": 99, "comp": "loud"}';
		const mix = loadBackingMix();
		expect(mix.bass).toBe(3);
		expect(mix.comp).toBe(DEFAULT_BACKING_MIX.comp);

		store['backing-mix-levels'] = 'not json {{';
		expect(loadBackingMix()).toEqual(DEFAULT_BACKING_MIX);
	});
});

describe('voiceVelocity', () => {
	it('scales a drum velocity by its voice trim', () => {
		expect(voiceVelocity(0.4, 1)).toBeCloseTo(0.4);
		expect(voiceVelocity(0.4, 0.5)).toBeCloseTo(0.2);
		expect(voiceVelocity(0.13, 2)).toBeCloseTo(0.26);
	});

	it('clamps the product into [0, 1]', () => {
		expect(voiceVelocity(0.6, 3)).toBe(1);
		expect(voiceVelocity(0.4, 0)).toBe(0);
	});
});

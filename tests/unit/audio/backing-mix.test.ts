import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	DEFAULT_BACKING_MIX,
	BACKING_BASE_TRIMS,
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
		const tuned: BackingMixLevels = {
			bass: 0.7,
			comp: 1.4,
			drums: 1.1,
			kick: 2.2,
			ride: 0.9,
			hihat: 1,
			'hihat-pedal': 1,
			snare: 1.3,
			crossstick: 1,
			'ride-bell': 0.8,
			crash: 1
		};
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
		store['backing-mix-levels-v2'] = '{"bass": 99, "comp": "loud"}';
		const mix = loadBackingMix();
		expect(mix.bass).toBe(3);
		expect(mix.comp).toBe(DEFAULT_BACKING_MIX.comp);

		store['backing-mix-levels-v2'] = 'not json {{';
		expect(loadBackingMix()).toEqual(DEFAULT_BACKING_MIX);
	});

	it('discards levels stored under the pre-base-trim key', () => {
		// Values tuned against the old flat gains (bass at 5%, kit trims
		// maxed) are exactly what BACKING_BASE_TRIMS now bakes in — loading
		// them on top would double-apply the correction.
		const store = stubStorage();
		store['backing-mix-levels'] = '{"bass": 0.05, "drums": 3, "kick": 3}';
		expect(loadBackingMix()).toEqual(DEFAULT_BACKING_MIX);
		expect('backing-mix-levels' in store).toBe(false);
	});
});

describe('BACKING_BASE_TRIMS', () => {
	it('documents the balance: hot bass/comp trims down, normalized kit stays unclamped', () => {
		// Bass/comp are CDN libraries far hotter than the balance point; the
		// kit assets are peak-normalized to −3 dBFS offline (2026-08-04), so
		// voice trims are modest and — the point of the normalization — no
		// musical velocity (≤ 1) times its trim may hit the [0, 1] clamp that
		// used to flatten the top half of the range. Exact values may move
		// with future tuning; these shape assertions must hold.
		expect(BACKING_BASE_TRIMS.bass).toBeLessThan(BACKING_BASE_TRIMS.comp);
		expect(BACKING_BASE_TRIMS.comp).toBeLessThan(1);
		expect(BACKING_BASE_TRIMS.drums).toBeGreaterThan(1);
		// Close-mic kick thumps hotter than the overhead-mic cymbal voices.
		expect(BACKING_BASE_TRIMS.kick).toBeGreaterThan(BACKING_BASE_TRIMS.ride);
		expect(BACKING_BASE_TRIMS.kick).toBeGreaterThan(BACKING_BASE_TRIMS.hihat);
		const voiceKeys = ['kick', 'ride', 'hihat', 'hihat-pedal', 'snare', 'crossstick', 'ride-bell', 'crash'] as const;
		for (const key of voiceKeys) {
			// Highest musically generated velocity is well under 0.65; even a
			// full-scale 1.0 must clear the clamp with the kick's trim.
			expect(0.65 * BACKING_BASE_TRIMS[key]).toBeLessThanOrEqual(1);
		}
		for (const v of Object.values(BACKING_BASE_TRIMS)) {
			expect(Number.isFinite(v)).toBe(true);
			expect(v).toBeGreaterThan(0);
		}
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

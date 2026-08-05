/**
 * Per-instrument mix levels for the backing track.
 *
 * `bass`, `comp` and `drums` are linear gain multipliers layered on top of
 * the overall backing volume; the drum-voice keys are velocity multipliers
 * applied at drum trigger time — the kit is one sampler, so voice balance
 * can only be shaped through velocity.
 *
 * Levels persist to localStorage so a mix tuned on the
 * /diagnostics/backing-mixer page applies to every session on this device.
 * All values are clamped to [0, 3]; 1 means "as generated".
 */

export interface BackingMixLevels {
	bass: number;
	comp: number;
	drums: number;
	kick: number;
	ride: number;
	hihat: number;
	'hihat-pedal': number;
	snare: number;
	crossstick: number;
	'ride-bell': number;
	crash: number;
}

export const DEFAULT_BACKING_MIX: BackingMixLevels = {
	bass: 1,
	comp: 1,
	drums: 1,
	kick: 1,
	ride: 1,
	hihat: 1,
	'hihat-pedal': 1,
	snare: 1,
	crossstick: 1,
	'ride-bell': 1,
	crash: 1
};

/**
 * Baseline trims that equalize instrument loudness. bass/comp/drums are
 * gain factors; the drum-voice entries multiply generated velocities
 * before the [0, 1] clamp.
 *
 * The drum-voice values changed with the 2026-08-04 sample normalization:
 * every kit buffer is now peak-normalized to −3 dBFS offline, so these
 * trims re-express the ear-tuned 2026-08-02 balance against the new flat
 * asset levels (old trim × old file peak = new trim × 0.708). The old ×3
 * values existed to push quiet source files up and clipped the top half of
 * the velocity range against the [0, 1] clamp; at −3 dBFS assets the whole
 * musical velocity range is audible and the clamp no longer engages.
 * Voices the generator doesn't emit yet (snare landed with the section
 * setups; pedal/cross-stick/bell/crash await the vocabulary increment)
 * start at family-matched estimates for the milestone listening pass.
 */
export const BACKING_BASE_TRIMS: Record<keyof BackingMixLevels, number> = {
	bass: 0.05,
	comp: 0.1,
	drums: 1.8,
	kick: 1.45,
	ride: 0.33,
	hihat: 0.33,
	'hihat-pedal': 0.33,
	snare: 0.55,
	crossstick: 0.5,
	'ride-bell': 0.35,
	crash: 0.5
};

const MIX_MAX = 3;
const STORAGE_KEY = 'backing-mix-levels-v2';
/**
 * Pre-base-trim key. Levels stored there were tuned against the old flat
 * gains — exactly the correction BACKING_BASE_TRIMS now bakes in — so
 * loading them on top would double-apply it. Dropped, not migrated.
 */
const LEGACY_STORAGE_KEY = 'backing-mix-levels';

/**
 * Merge an untrusted value over the defaults: known keys only, finite
 * numbers only, clamped to [0, 3]. Never throws.
 */
export function normalizeBackingMix(value: unknown): BackingMixLevels {
	const mix = { ...DEFAULT_BACKING_MIX };
	if (typeof value !== 'object' || value === null) return mix;
	for (const key of Object.keys(DEFAULT_BACKING_MIX) as Array<keyof BackingMixLevels>) {
		const raw = (value as Record<string, unknown>)[key];
		if (typeof raw === 'number' && Number.isFinite(raw)) {
			mix[key] = Math.max(0, Math.min(MIX_MAX, raw));
		}
	}
	return mix;
}

/** Load the persisted mix, or defaults when absent/corrupt (also SSR-safe). */
export function loadBackingMix(): BackingMixLevels {
	if (typeof localStorage === 'undefined') return { ...DEFAULT_BACKING_MIX };
	try {
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? normalizeBackingMix(JSON.parse(raw)) : { ...DEFAULT_BACKING_MIX };
	} catch {
		return { ...DEFAULT_BACKING_MIX };
	}
}

/** Persist the mix (no-op without localStorage). */
export function saveBackingMix(mix: BackingMixLevels): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(mix));
	} catch {
		/* quota exceeded — ignore */
	}
}

/** Apply a voice trim to a generated drum velocity, clamped to [0, 1]. */
export function voiceVelocity(base: number, trim: number): number {
	return Math.max(0, Math.min(1, base * trim));
}

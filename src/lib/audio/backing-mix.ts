/**
 * Per-instrument mix levels for the backing track.
 *
 * `bass`, `comp` and `drums` are linear gain multipliers layered on top of
 * the overall backing volume; `kick`, `ride` and `hihat` are velocity
 * multipliers applied at drum trigger time — the kit is one sampler, so
 * voice balance can only be shaped through velocity.
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
}

export const DEFAULT_BACKING_MIX: BackingMixLevels = {
	bass: 1,
	comp: 1,
	drums: 1,
	kick: 1,
	ride: 1,
	hihat: 1
};

/**
 * Baseline trims that equalize the raw sample-library loudness, tuned by
 * ear on /diagnostics/backing-mixer (2026-08-02): the Smolken bass and the
 * pianos run far hotter than the drum kit, whose kick and hi-hat samples
 * are quiet even at full velocity. User mix levels MULTIPLY these bases,
 * so 1.0 on every slider reproduces this tuned balance and the whole
 * slider range stays available as headroom around it.
 *
 * bass/comp/drums are gain factors; kick/ride/hihat multiply generated
 * drum velocities before the [0, 1] clamp.
 */
export const BACKING_BASE_TRIMS: Record<keyof BackingMixLevels, number> = {
	bass: 0.05,
	comp: 0.1,
	drums: 1.8,
	kick: 3,
	ride: 1.55,
	hihat: 3
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

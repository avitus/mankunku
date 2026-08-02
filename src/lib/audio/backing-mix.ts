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

const MIX_MAX = 3;
const STORAGE_KEY = 'backing-mix-levels';

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

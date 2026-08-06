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
 * ⚠️ Drum-voice trims live in VELOCITY space, and smplr maps velocity to
 * gain QUADRATICALLY (`(vel/127)²` — midiVelToGain). Converting a trim
 * between sample-level regimes therefore goes through a square root:
 * equal audible level means `amp_old × (v·t_old)² = amp_new × (v·t_new)²`,
 * i.e. `t_new = t_old × √(amp_old / amp_new)`. The first post-
 * normalization values here (2026-08-04) preserved the linear product
 * instead, which collapsed the kit by an order of magnitude — caught by
 * the render-audio diagnostic, not by any level-blind unit test.
 *
 * Current values re-express the ear-tuned 2026-08-02 balance against the
 * −3 dBFS-normalized kit via the sqrt rule (kick 3→2.0 — rounded down from 2.09 so no musical velocity can clamp; ride 1.55→0.71;
 * hi-hat was velocity-clamped pre-normalization, so its target is the old
 * CLAMPED loudness → 0.81). Timekeeping-range velocities (≤ 0.5) stay
 * unclamped; the loudest setup accents may just kiss the ceiling. Voices
 * the generator barely emits yet start at family-matched estimates for
 * the milestone listening pass.
 */
export const BACKING_BASE_TRIMS: Record<keyof BackingMixLevels, number> = {
	bass: 0.05,
	comp: 0.1,
	drums: 1.8,
	kick: 2.0,
	ride: 0.71,
	hihat: 0.81,
	'hihat-pedal': 0.81,
	snare: 1.0,
	crossstick: 1.0,
	'ride-bell': 0.7,
	// Ear-tuned at Milestone B (2026-08-06): the peak-normalized crash body
	// sits far above the ride bed (peak normalization is blind to sustain),
	// so its trim is the one drum entry set well below its family estimate.
	crash: 0.55
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

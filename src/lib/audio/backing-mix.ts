/**
 * Per-instrument mix levels for the backing track.
 *
 * `bass`, `comp`, `drums` and `room` are linear gain multipliers layered
 * on top of the overall backing volume; the drum-voice keys are velocity
 * multipliers applied at drum trigger time — voices share their family's
 * sampler output, so within-family balance can only be shaped through
 * velocity.
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
	/** Room-reverb return level (0 = dry). Added 2026-08; older persisted
	 *  mixes lack the key and normalize to the default. */
	room: number;
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
	crash: 1,
	room: 1
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
export const BACKING_BASE_TRIMS: Record<Exclude<keyof BackingMixLevels, 'room'>, number> = {
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
	// Refined on the confirm listen: 85% of the 0.55 calibration's level,
	// converted through the sqrt rule above (0.55 × √0.85 ≈ 0.51). Still
	// hot on the 2026-08-08 listen — one more 85% step (0.51 × √0.85 ≈ 0.47).
	crash: 0.47
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

// ── Spatial + bus policy (increment 9) ───────────────────────
//
// One place for every number the live graph (backing-track.ts) and the
// offline bounce (backing-bounce.ts) must AGREE on, so a lab WAV keeps
// sounding like the app. Values are Web Audio units: pans in [-1, 1],
// sends/returns linear gain, compressor params in the units
// DynamicsCompressorNode takes.

/** The drum kit splits into three sampler families, each with its own
 *  pan position (a kit is wide; one mono point-source is an amateur tell). */
export type DrumFamily = 'kick' | 'snare' | 'cymbals';

/** Stereo positions per backing source. Bass and kick anchor the center
 *  (low frequencies pull the image); comp sits slightly left like a
 *  pianist across the room, snare just off-center, cymbals right. */
export const BACKING_PANS: Record<'bass' | 'comp' | DrumFamily, number> = {
	bass: 0,
	comp: -0.2,
	kick: 0,
	snare: -0.1,
	cymbals: 0.25
};

/** Per-source room-reverb send levels (pre-return linear gain). Snare and
 *  comp speak in the room; bass and kick stay nearly dry — low-end reverb
 *  reads as mud, not space. */
export const ROOM_SENDS: Record<'bass' | 'comp' | DrumFamily, number> = {
	bass: 0.04,
	comp: 0.12,
	kick: 0.02,
	snare: 0.15,
	cymbals: 0.12
};

/** Room return into the backing bus: ≈ −18 dB, scaled by `mix.room`. */
export const ROOM_RETURN_GAIN = 0.126;

/** Path to the small-room impulse response (Opus, same fetch+decode path
 *  as the drum samples). Load is best-effort: no IR → dry backing. */
export const ROOM_IR_URL = '/samples/ir/room.ogg';

/**
 * Glue compressor on the backing bus only (master carries the melody and
 * stays untouched): gentle 2:1 over a soft knee, fast-ish attack to catch
 * stacked transients (crash + comp push + bass on a downbeat), musical
 * release. Values are the DynamicsCompressorNode AudioParam targets.
 */
export const BACKING_BUS_COMPRESSOR = {
	threshold: -24,
	knee: 30,
	ratio: 2,
	attack: 0.01,
	release: 0.25
} as const;

/**
 * Per-role ensemble microtiming for the backing track.
 *
 * A professional rhythm section is not sample-locked: the ride and bass
 * define the time ("on top"), the comp lays back behind it, and every
 * stroke carries a little human jitter. Friberg & Sundström's ensemble
 * measurements show these offsets are roughly constant in MILLISECONDS —
 * not in beat fractions — so the profiles here are ms values, compressed
 * only when a fast tempo would make them a musically significant slice of
 * the beat.
 *
 * Placement = straight beat → `applySwingToBeats` → role offset → role
 * jitter → clamp ≥ 0. Jitter is triangular (sum of two uniforms), which
 * keeps most strokes near the intent with soft tails — and it is drawn
 * from DEDICATED per-(role, bar) streams (`seedFrom(phraseId, tempo,
 * '<role>-time', barIndex)`), so adding a musical probability check in a
 * generator can never reshuffle another voice's — or later notes' —
 * timing. This replaces the old `humanizeTicks`, whose `120/tempo`
 * scaling made slow tempi sloppier and fast tempi robotic (backwards),
 * and which shared its stream with the musical draws.
 */

import { applySwingToBeats } from '$lib/music/swing';
import { createRng, seedFrom, type SeededRng } from './generation-rng';
import type { DrumVoice } from './backing-styles';

export type TimingRole = 'bass' | 'comp' | DrumVoice;

export interface TimingProfile {
	/** Constant offset from the grid in ms (negative = ahead / "on top"). */
	offsetMs: number;
	/** Triangular jitter half-width in ms. */
	jitterMs: number;
}

/**
 * Swing-style ensemble profiles. Ride is the reference clock; bass sits
 * fractionally on top with it; comp lays back; kick/snare land a touch
 * behind the cymbal, as played limbs do.
 */
export const SWING_TIMING: Record<TimingRole, TimingProfile> = {
	ride: { offsetMs: 0, jitterMs: 4 },
	'ride-bell': { offsetMs: 0, jitterMs: 4 },
	hihat: { offsetMs: 0, jitterMs: 3 },
	'hihat-pedal': { offsetMs: 0, jitterMs: 3 },
	kick: { offsetMs: 2, jitterMs: 6 },
	snare: { offsetMs: 4, jitterMs: 7 },
	crossstick: { offsetMs: 4, jitterMs: 7 },
	crash: { offsetMs: 0, jitterMs: 5 },
	bass: { offsetMs: -3, jitterMs: 5 },
	comp: { offsetMs: 12, jitterMs: 8 }
};

function scaleTiming(
	base: Record<TimingRole, TimingProfile>,
	offsetScale: number,
	jitterScale: number,
	overrides: Partial<Record<TimingRole, TimingProfile>> = {}
): Record<TimingRole, TimingProfile> {
	const out = {} as Record<TimingRole, TimingProfile>;
	for (const role of Object.keys(base) as TimingRole[]) {
		out[role] = overrides[role] ?? {
			offsetMs: base[role].offsetMs * offsetScale,
			jitterMs: base[role].jitterMs * jitterScale
		};
	}
	return out;
}

/** Ballad: looser strokes, the comp settles even further behind the time. */
export const BALLAD_TIMING = scaleTiming(SWING_TIMING, 1, 1.5, {
	comp: { offsetMs: 18, jitterMs: 12 }
});

/** Bossa: tight ensemble — everyone on the grid, minimal scatter. */
export const BOSSA_TIMING = scaleTiming(SWING_TIMING, 0, 0.6);

/** Straight: half the personality, still not machine-locked. */
export const STRAIGHT_TIMING = scaleTiming(SWING_TIMING, 0.5, 1);

/**
 * Above this fraction of the beat, a constant-ms offset stops reading as
 * feel and starts reading as a flam — compress it.
 */
const MAX_OFFSET_BEAT_FRACTION = 0.04;

/**
 * Place one event: swung grid position plus the role's offset and jitter,
 * in Transport ticks (clamped to ≥ 0 — bar-0 negative offsets pile on the
 * downbeat, which is fine).
 */
export function placeEventTicks(
	absBeat: number,
	swing: number,
	ppq: number,
	tempo: number,
	profile: TimingProfile,
	rng: SeededRng
): number {
	const swungTicks = applySwingToBeats(absBeat, swing) * ppq;
	const beatMs = 60_000 / tempo;
	const cap = MAX_OFFSET_BEAT_FRACTION * beatMs;
	const offsetMs = Math.sign(profile.offsetMs) * Math.min(Math.abs(profile.offsetMs), cap);
	const jitterMs = (rng.float() + rng.float() - 1) * profile.jitterMs;
	const msPerTick = beatMs / ppq;
	return Math.max(0, Math.round(swungTicks + (offsetMs + jitterMs) / msPerTick));
}

/**
 * Lazy per-(role, bar) timing streams for one generation pass. Two
 * contexts built from the same params produce identical draws, so each
 * generator can own one without sharing state.
 */
export function createTimingStreams(phraseId: string, tempo: number) {
	const rngs = new Map<string, SeededRng>();
	return {
		for(role: TimingRole, barIndex: number): SeededRng {
			const key = `${role}:${barIndex}`;
			let rng = rngs.get(key);
			if (!rng) {
				rng = createRng(seedFrom(phraseId, tempo, `${role}-time`, barIndex));
				rngs.set(key, rng);
			}
			return rng;
		}
	};
}

export type TimingStreams = ReturnType<typeof createTimingStreams>;

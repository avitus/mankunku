import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';

export interface KeyboardArticulationInput {
	style: BackingStyle;
	instrument: BackingInstrument;
	durationBeats: number;
	velocity: number;
	/** Room until the next actual attack, bar end or harmonic boundary, whichever comes first. */
	availableBeats: number;
	/** Keep the established support/response envelope, apart from the scheduling boundary. */
	protection?: 'background' | 'arrival' | 'reply';
}

export type KeyboardArticulationProfile = 'protected' | 'piano-detached' | 'piano-held' |
	'organ-detached' | 'organ-held' | 'bossa-piano' | 'bossa-organ' | 'ballad-piano' | 'ballad-organ';

export interface KeyboardArticulation {
	durationBeats: number;
	velocity: number;
	profile: KeyboardArticulationProfile;
}

/**
 * Give already-selected cells instrument-appropriate releases, never extra attacks or accents.
 * Short piano answers release clearly; the organ sustains slightly further, but short cells
 * remain short. Held piano support is not shortened. Native Bossa and Ballad envelopes have
 * their own policies, so a syncopated Bossa cell cannot become a Ballad pad.
 *
 * All bounds use beats at the caller's actual scheduled onset, including microtiming. The
 * returned gate cannot cross that bound; sample release tails remain the renderer's concern.
 */
export function articulateKeyboardHit(input: KeyboardArticulationInput): KeyboardArticulation {
	const { style, instrument, durationBeats, availableBeats, velocity, protection } = input;
	if (!Number.isFinite(durationBeats) || durationBeats < 0 || !Number.isFinite(availableBeats) || availableBeats < 0) {
		throw new RangeError('Keyboard articulation requires finite, nonnegative durations and available room');
	}
	let duration = durationBeats;
	let profile: KeyboardArticulationProfile;
	if (protection) {
		profile = 'protected';
	} else if (style === 'bossa-nova') {
		profile = instrument === 'piano' ? 'bossa-piano' : 'bossa-organ';
		duration = instrument === 'piano' ? durationBeats * .92 : Math.min(1.25, durationBeats * 1.08);
	} else if (style === 'ballad') {
		profile = instrument === 'piano' ? 'ballad-piano' : 'ballad-organ';
		// Piano pads decay naturally; organ pads sustain at level until their gate ends.
		// Give whole organ pads a small closing breath, keeping most of the bar supported.
		// Half pads sustain slightly further; pickups retain their short footprint.
		duration = instrument === 'piano' ? durationBeats : durationBeats * (durationBeats >= 3 ? .9 : 1.04);
	} else if (durationBeats <= .8) {
		profile = instrument === 'piano' ? 'piano-detached' : 'organ-detached';
		duration = instrument === 'piano' ? durationBeats * .85 : Math.min(.95, durationBeats * 1.3);
	} else {
		profile = instrument === 'piano' ? 'piano-held' : 'organ-held';
		duration = instrument === 'piano' ? durationBeats : durationBeats * 1.12;
	}
	return { durationBeats: Math.min(duration, availableBeats), velocity, profile };
}

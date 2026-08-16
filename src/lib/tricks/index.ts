/**
 * The trick catalog: the flat, ordered list of available melodic devices.
 * Deliberately just an array + id lookup — no registry infrastructure.
 */
import type { Trick, TrickContext, TrickParameters } from '$lib/types/tricks';
import type { PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { InstrumentConfig } from '$lib/types/instruments';
import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import { writtenKeyToConcert } from '$lib/music/transposition';
import { enclosuresTrick } from './devices/enclosures';
import { triadPairsTrick } from './devices/triad-pairs';

export const TRICKS: readonly Trick[] = [enclosuresTrick, triadPairsTrick];

export function getTrickById(id: string): Trick | undefined {
	return TRICKS.find((trick) => trick.id === id);
}

/**
 * Concert anchor of a trick drill's key rotation: the player's WRITTEN C
 * (concert Bb on a Bb horn, concert Eb on an Eb horn). Tricks have no stored
 * home key — examples generate in a concert-C context and transpose per key —
 * so the unlock ramp and the circle-of-4ths rotation grow from the key the
 * player reads as C, exactly like a lick entered in written C would. The
 * drill sites and the tune-practice mastery-tier mirror must all resolve the
 * anchor through this function or they drift.
 */
export function trickEntryKey(instrument: InstrumentConfig): PitchClass {
	return writtenKeyToConcert('C', instrument);
}

/**
 * Demo style for a practice round: rotates through the trick's exampleStyles
 * (round 1 = the first, canonical style), cycling. Undefined when the trick
 * declares no styles — generateExample then uses its default.
 */
export function exampleStyleForRound(trick: Trick, roundNumber: number): string | undefined {
	const styles = trick.exampleStyles;
	if (!styles || styles.length === 0) return undefined;
	return styles[(Math.max(1, roundNumber) - 1) % styles.length];
}

/**
 * The harmony a variant is actually drilled over: the device picks the vamp
 * its selected variant sounds correct on (altered triad pairs → the dominant
 * vamp, the melodic-minor family → the minor vamp), defaulting to the major
 * vamp for devices with no preference.
 *
 * Shared by the practice session and the trick page's notation preview so the
 * two cannot drift. They did: the preview hardcoded maj7 / major.ionian on the
 * premise that "both tricks are maj7-compatible", but five of the eight
 * triad-pair families exclude maj7 outright — the whole-tone pair rendered as
 * "C+·D+ over Cmaj7", harmony it would never be played over. That also changed
 * the notes, not just the label: example-generator realizes its pool from
 * scaleId, so altered pitch classes fell out of pool and took the chromatic
 * fallback placement path instead of the one the drill uses.
 */
export function trickBedHarmony(
	trick: Trick,
	parameters: TrickParameters
): Pick<TrickContext, 'chordQuality' | 'scaleId'> {
	const bed = PROGRESSION_TEMPLATES[trickPracticeBed(trick, parameters)].harmony[0];
	return { chordQuality: bed.chord.quality, scaleId: bed.scaleId };
}

/**
 * The progression a variant drills over. The `'major-vamp'` fallback for
 * devices with no `practiceBed` lives HERE and nowhere else — the session
 * needs the id to schedule the rhythm section while the preview needs only
 * the harmony, and having each derive the default separately is the drift
 * this module exists to prevent. (Both current devices declare beds —
 * triad pairs per family, enclosures per chord type — so the fallback is
 * purely defensive today.)
 */
export function trickPracticeBed(
	trick: Trick,
	parameters: TrickParameters
): ChordProgressionType {
	return trick.practiceBed?.(parameters) ?? 'major-vamp';
}

/** A full `TrickContext` rooted at `key`, over the variant's own practice bed. */
export function trickContextFor(
	trick: Trick,
	parameters: TrickParameters,
	key: PitchClass,
	tempo: number
): TrickContext {
	return {
		...trickBedHarmony(trick, parameters),
		chordRoot: key,
		key,
		timeSignature: [4, 4],
		level: 50,
		tempo,
		swing: 0.5
	};
}

/**
 * The trick catalog: the flat, ordered list of available melodic devices.
 * Deliberately just an array + id lookup — no registry infrastructure.
 */
import type { Trick } from '$lib/types/tricks';
import { enclosuresTrick } from './devices/enclosures';
import { triadPairsTrick } from './devices/triad-pairs';

export const TRICKS: readonly Trick[] = [enclosuresTrick, triadPairsTrick];

export function getTrickById(id: string): Trick | undefined {
	return TRICKS.find((trick) => trick.id === id);
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

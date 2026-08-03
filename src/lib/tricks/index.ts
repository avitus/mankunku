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

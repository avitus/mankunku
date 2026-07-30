import type { Phrase } from '$lib/types/music';
import type { MatchIndex, SourceEntry } from './index-format';
import { encodePhrase } from './encode';
import { buildIndex, DEFAULT_NGRAM_SIZE } from './search';

/**
 * A client-side match index over the user's own licks, for freestyle
 * recognition. The server-side `/api/lick-match` index is the WJazzD
 * attribution corpus — the wrong corpus for "did the user just play a lick
 * they know" — so freestyle builds this small local one instead.
 */
export interface FreestyleBook {
	index: MatchIndex;
	/** Lick id → display name. */
	names: Map<string, string>;
	/** Lick id → notated length in transport ticks (for recognition cooldowns). */
	durationTicks: Map<string, number>;
}

const TICKS_PER_BEAT = (ppq: number): number => ppq;

/**
 * Index every lick with enough pitched notes to be matchable (the n-gram
 * matcher needs `DEFAULT_NGRAM_SIZE` intervals, i.e. one more note). The
 * caller decides which licks count as "known" — pass a pre-filtered pool.
 */
export function buildBookIndex(licks: readonly Phrase[], ppq: number): FreestyleBook {
	const sources: SourceEntry[] = [];
	const phrases: Parameters<typeof buildIndex>[1] = [];
	const names = new Map<string, string>();
	const durationTicks = new Map<string, number>();

	for (const lick of licks) {
		const feature = encodePhrase(lick);
		if (feature.intervals.length < DEFAULT_NGRAM_SIZE) continue;
		sources.push({ id: lick.id, kind: 'quote', performer: '', title: lick.name });
		phrases.push({ sourceId: lick.id, intervals: feature.intervals, iois: feature.iois });
		names.set(lick.id, lick.name);
		durationTicks.set(lick.id, Math.round(feature.totalBeats * TICKS_PER_BEAT(ppq)));
	}

	return { index: buildIndex(sources, phrases), names, durationTicks };
}

/**
 * Shared types for the lick-matching index. Produced by the build script
 * from the Weimar Jazz Database + curated quotes; loaded by the
 * /api/lick-match endpoint at startup.
 */

/** Transposition-invariant feature vector for a phrase. */
export interface LickFeature {
	/** Semitone intervals between consecutive pitched notes; length N-1 */
	intervals: number[];
	/** Inter-onset intervals in 16th-note ticks; length N-1 */
	iois: number[];
	/** Number of pitched notes (rests excluded) */
	noteCount: number;
	/** Total span in beats (quarter notes) */
	totalBeats: number;
	/** Concert pitch-class of the phrase's key, 0-11 */
	keyPc: number;
}

export type SourceKind = 'wjazzd' | 'quote';

export interface SourceEntry {
	id: string;
	kind: SourceKind;
	/** For WJazzD: "Charlie Parker". For quote: "Traditional bebop vocabulary". */
	performer: string;
	/** For WJazzD: "Ko Ko". For quote: "Countdown head". */
	title: string;
	/** Optional: original key, for display only */
	key?: string;
	/** Optional: recording year for WJazzD */
	year?: number;
	/** Curated-quote explanation, shown under the suggestion */
	note?: string;
}

export interface IndexPhrase {
	sourceId: string;
	/** Starting bar number within the source (1-based), when known */
	startBar?: number;
	intervals: number[];
	iois: number[];
}

export interface MatchIndex {
	sources: SourceEntry[];
	phrases: IndexPhrase[];
	/**
	 * Inverted index: interval n-gram (comma-joined, e.g. "2,-1,2,3,-2") →
	 * list of [phraseIndex, positionWithinPhrase] tuples.
	 */
	ngramIndex: Record<string, Array<[number, number]>>;
	/** N-gram size used to build ngramIndex */
	ngramSize: number;
	/** ISO timestamp when the index was built */
	builtAt: string;
}

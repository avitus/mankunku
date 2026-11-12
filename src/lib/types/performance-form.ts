/** A performed pass is explicit: a repeated chart section is not a chorus. */
export type PerformanceRole = 'head' | 'solo';

export interface PerformanceChorus {
	index: number;
	role: PerformanceRole;
	/** Half-open, zero-based BAR coordinates, independent of meter. */
	startBar: number;
	endBarExclusive: number;
}

export interface PerformanceSection {
	/** Unique occurrence on this performance's timeline. */
	index: number;
	/** Null when the caller has no authored-section provenance. */
	sourceSection: number | null;
	/** Zero-based occurrence of this source section across the performance. */
	occurrenceIndex: number;
	chorusIndex: number;
	startBar: number;
	endBarExclusive: number;
}

export interface PerformanceForm {
	version: 1;
	totalBars: number;
	choruses: PerformanceChorus[];
	sections: PerformanceSection[];
}

import type { Tune } from '../../src/lib/types/tune';

/** Synthetic original harmony-only chart for adapter tests; never shipped as repertoire. */
export const LOCAL_LISTENING_AABA: Tune = {
	id: 'e2e-musicality-local-aaba',
	title: 'Listening Book AABA',
	composer: 'Synthetic test fixture',
	key: 'C',
	timeSignature: [4, 4],
	style: 'Medium Swing',
	tags: ['test-only'],
	source: 'user',
	sections: ['A', 'A', 'B', 'A'].map((label) => ({
		label,
		bars: 8,
		notes: [],
		harmony: Array.from({ length: 8 }, (_, bar) => ({
			chord: { root: label === 'B' ? 'F' as const : 'C' as const, quality: 'maj7' as const },
			scaleId: 'major.ionian',
			startOffset: [bar, 1] as [number, number],
			duration: [1, 1] as [number, number],
			symbol: label === 'B' ? 'Fmaj7' : 'Cmaj7'
		}))
	}))
};

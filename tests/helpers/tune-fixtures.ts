import type { HarmonicSegment, Note } from '../../src/lib/types/music';
import type { Tune, TuneSection } from '../../src/lib/types/tune';

/**
 * Shared tune fixture builders for the notation suites
 * (tune-notation.test.ts, chart-geometry.test.ts) — one copy so the
 * fixtures cannot drift between them.
 */

export function seg(
	root: HarmonicSegment['chord']['root'],
	quality: HarmonicSegment['chord']['quality'],
	startOffset: [number, number],
	duration: [number, number],
	symbol?: string
): HarmonicSegment {
	const s: HarmonicSegment = { chord: { root, quality }, scaleId: 'major.ionian', startOffset, duration };
	if (symbol) s.symbol = symbol;
	return s;
}

export function section(overrides: Partial<TuneSection>): TuneSection {
	return { label: 'A', bars: 4, notes: [], harmony: [], ...overrides };
}

export function sheet(overrides: Partial<Tune>): Tune {
	return {
		id: 'ls-test',
		title: 'Test Tune',
		key: 'C',
		timeSignature: [4, 4],
		tags: [],
		sections: [],
		source: 'user',
		...overrides
	};
}

/** 2-bar sheet: whole-note C4 over Dm7→G7, then half-note D4 over Cmaj7 + rest. */
export function simpleSheet(): Tune {
	const notes: Note[] = [
		{ pitch: 60, duration: [1, 1], offset: [0, 1] },
		{ pitch: 62, duration: [1, 2], offset: [1, 1] }
	];
	return sheet({
		sections: [
			section({
				bars: 2,
				notes,
				harmony: [
					seg('D', 'min7', [0, 1], [1, 2]),
					seg('G', '7', [1, 2], [1, 2]),
					seg('C', 'maj7', [1, 1], [1, 1])
				]
			})
		]
	});
}

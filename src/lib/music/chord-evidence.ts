import { PITCH_CLASSES, type HarmonicSegment, type PitchClass } from '$lib/types/music';
import { parseChordSymbol, type ChordBaseQuality, type ChordSymbol } from './chord-symbol';
import { CHORD_DEFINITIONS } from './chords';
import { transposePitchClass } from './transposition';

export interface ChordEvidence {
	root: PitchClass;
	pitchClasses: PitchClass[];
	/** A major-quality tonic candidate, not a dominant or suspended chord. */
	majorTonic: boolean;
}

const TRIADS: Record<ChordBaseQuality, readonly number[]> = {
	maj: [0, 4, 7], min: [0, 3, 7], dom: [0, 4, 7],
	dim: [0, 3, 6], halfdim: [0, 3, 6], aug: [0, 4, 8],
	minmaj: [0, 3, 7], sus4: [0, 5, 7], sus2: [0, 2, 7]
};

const DEGREE_INTERVALS: Readonly<Record<number, number>> = {
	1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21
};

/** Resolve written degrees, conservatively including stacked extension tones. */
function symbolIntervals(symbol: ChordSymbol): number[] | null {
	const triad = TRIADS[symbol.quality];
	const middle = symbol.quality === 'sus2' ? 2 : symbol.quality === 'sus4' ? 4 : 3;
	const tones = new Map<number, number>([[1, triad[0]], [middle, triad[1]], [5, triad[2]]]);
	const seventh = symbol.quality === 'maj' || symbol.quality === 'minmaj' ? 11 :
		symbol.quality === 'dim' ? 9 : 10;
	for (const extension of symbol.extensions) {
		const degree = Number(extension);
		if (![6, 7, 9, 11, 13].includes(degree)) return null;
		if (degree === 6) tones.set(6, 9);
		else if (symbol.extensions.includes('6') && degree === 9) tones.set(9, 14);
		else {
			tones.set(7, seventh);
			for (const upper of [9, 11, 13]) {
				if (upper <= degree) tones.set(upper, DEGREE_INTERVALS[upper]);
			}
		}
	}
	for (const alteration of symbol.alterations) {
		const added = /^add(\d+)$/.exec(alteration);
		const changed = /^([b#])(5|9|11|13)$/.exec(alteration);
		const degree = Number(added?.[1] ?? changed?.[2]);
		if ((!added && !changed) || DEGREE_INTERVALS[degree] === undefined) return null;
		const shift = changed ? (changed[1] === 'b' ? -1 : 1) : 0;
		tones.set(degree, DEGREE_INTERVALS[degree] + shift);
	}
	return [...tones.values()];
}

/**
 * Harmonic evidence, not a comping voicing. A supplied symbol is authoritative:
 * never simplify an unknown symbol or `alt` into the audio enum's approximation.
 * Without text, use the explicitly stored quality. `scaleId` is not consulted.
 */
export function chordEvidence(segment: HarmonicSegment): ChordEvidence | null {
	let intervals: readonly number[];
	let majorTonic: boolean;
	let bass = segment.chord.bass;
	if (segment.symbol !== undefined) {
		const parsed = parseChordSymbol(segment.symbol);
		if (!parsed || parsed.root !== segment.chord.root ||
			(bass !== undefined && parsed.bass !== undefined && bass !== parsed.bass)) return null;
		const resolved = symbolIntervals(parsed);
		if (!resolved) return null;
		intervals = resolved;
		majorTonic = parsed.quality === 'maj' && resolved.includes(4) && resolved.includes(7);
		bass = parsed.bass ?? bass;
	} else {
		if (segment.chord.quality === '7alt') return null;
		intervals = CHORD_DEFINITIONS[segment.chord.quality].intervals;
		majorTonic = segment.chord.quality === 'maj7' || segment.chord.quality === 'maj6';
	}
	const pitches = new Set(intervals.map((interval) => transposePitchClass(segment.chord.root, interval)));
	if (bass) pitches.add(bass);
	return {
		root: segment.chord.root,
		pitchClasses: PITCH_CLASSES.filter((pitch) => pitches.has(pitch)),
		majorTonic
	};
}

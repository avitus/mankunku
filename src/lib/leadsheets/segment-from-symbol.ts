import type { Fraction, HarmonicSegment } from '$lib/types/music';
import {
	parseChordSymbol,
	formatChordSymbol,
	chordSymbolToQuality,
	type ChordSymbol
} from '$lib/music/chord-symbol';
import { getScalesForChord } from '$lib/music/scales';

/**
 * Shared builder turning chord symbols into HarmonicSegments — one place
 * where the quality mapping, default scale context, and canonical raw-symbol
 * stamping happen, used by manual entry and every importer.
 */

/** Default scale context for a voiced quality — derived from the scale table. */
export function scaleIdForQuality(quality: HarmonicSegment['chord']['quality']): string {
	return getScalesForChord(quality)[0]?.id ?? 'major.ionian';
}

/** Build a segment from an already-parsed CONCERT-pitch chord struct. */
export function harmonicSegmentFromChordSymbol(
	cs: ChordSymbol,
	startOffset: Fraction,
	duration: Fraction
): HarmonicSegment {
	const quality = chordSymbolToQuality(cs);
	return {
		chord: {
			root: cs.root,
			quality,
			...(cs.bass ? { bass: cs.bass } : {})
		},
		scaleId: scaleIdForQuality(quality),
		startOffset,
		duration,
		symbol: formatChordSymbol(cs)
	};
}

/**
 * Build a segment from CONCERT-pitch chord text. Returns null for
 * unparseable text — callers decide whether that's a skip or an error.
 */
export function harmonicSegmentFromSymbol(
	concertText: string,
	startOffset: Fraction,
	duration: Fraction
): HarmonicSegment | null {
	const parsed = parseChordSymbol(concertText);
	if (!parsed) return null;
	return harmonicSegmentFromChordSymbol(parsed, startOffset, duration);
}

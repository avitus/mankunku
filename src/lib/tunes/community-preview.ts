import type { Tune } from '$lib/types/tune';
import type { HarmonicSegment, PitchClass } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { pitchClassInterval, transposePitchClass } from '$lib/music/transposition';
import { transposeChordSymbol } from '$lib/music/chord-symbol';
import { chordSymbol } from '$lib/music/chords';
import { chordDisplayLine } from '$lib/music/chord-layout';
import { harmonyRole } from './harmony-colors';

export interface PreviewCell {
	symbol: string | null;
	start: number;
	length: number;
	role: ReturnType<typeof harmonyRole>;
}
export interface PreviewBar {
	number: number;
	section: string | null;
	cells: PreviewCell[];
}

/** Compact notation-order changes, never an expanded playback form. */
export function communityPreviewBars(tune: Tune, writtenKey: PitchClass): PreviewBar[] {
	const barLength = tune.timeSignature[0] / tune.timeSignature[1];
	const shift = pitchClassInterval(tune.key, writtenKey);
	const symbolFor = (segment: HarmonicSegment): string => {
		const root = transposePitchClass(segment.chord.root, shift);
		const bass = segment.chord.bass ? transposePitchClass(segment.chord.bass, shift) : null;
		const fallback = chordSymbol(root, segment.chord.quality) + (bass ? `/${bass}` : '');
		return chordDisplayLine(transposeChordSymbol(segment.symbol, shift) ?? fallback, writtenKey);
	};
	const bars: PreviewBar[] = [];
	for (const section of tune.sections) {
		const harmony = [...section.harmony].sort(
			(a, b) => fractionToFloat(a.startOffset) - fractionToFloat(b.startOffset)
		);
		for (let index = 0; index < section.bars && bars.length < 8; index++) {
			const start = index * barLength;
			const end = start + barLength;
			const cells: PreviewCell[] = [];
			let cursor = start;
			for (const segment of harmony) {
				const from = Math.max(start, cursor, fractionToFloat(segment.startOffset));
				const to = Math.min(
					end,
					fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)
				);
				if (to <= from) continue;
				if (from > cursor)
					cells.push({
						symbol: null,
						start: (cursor - start) / barLength,
						length: (from - cursor) / barLength,
						role: null
					});
				cells.push({
					symbol: symbolFor(segment),
					start: (from - start) / barLength,
					length: (to - from) / barLength,
					role: harmonyRole(segment, tune.key)
				});
				cursor = to;
			}
			if (cursor < end)
				cells.push({
					symbol: null,
					start: (cursor - start) / barLength,
					length: (end - cursor) / barLength,
					role: null
				});
			bars.push({ number: bars.length + 1, section: index === 0 ? section.label : null, cells });
		}
		if (bars.length === 8) break;
	}
	return bars;
}

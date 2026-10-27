import type { HarmonicSegment } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import { flattenTune } from './flatten';
import { addFractions, compareFractions, multiplyFraction, subtractFractions } from '$lib/music/intervals';
import { isInPickupLeadIn } from '$lib/music/pickup';
import { clearPickupBarHarmony } from '$lib/state/tune-practice-plan';

export interface ChordBar {
	index: number;
	number: number;
	harmony: HarmonicSegment[];
}

export interface ChordBarSection {
	label: string;
	ending?: TuneSection['ending'];
	bars: ChordBar[];
}

/** Notation-order bars, preserving the chart's sections and numbered endings. */
export function tuneChordBars(tune: Tune): ChordBarSection[] {
	const flat = clearPickupBarHarmony(tune, flattenTune(tune));
	let absoluteBar = 0;
	let printedBar = 0;
	return tune.sections.map(section => {
		const bars = Array.from({ length: section.bars }, () => {
			const index = absoluteBar++;
			if (isInPickupLeadIn(tune, index)) return null;
			const start = multiplyFraction(tune.timeSignature, index);
			const end = addFractions(start, tune.timeSignature);
			const harmony = flat.harmony.flatMap(segment => {
				const segmentEnd = addFractions(segment.startOffset, segment.duration);
				if (compareFractions(segmentEnd, start) <= 0 || compareFractions(segment.startOffset, end) >= 0) return [];
				const from = compareFractions(segment.startOffset, start) < 0 ? start : segment.startOffset;
				const to = compareFractions(segmentEnd, end) > 0 ? end : segmentEnd;
				return [{ ...segment, startOffset: subtractFractions(from, start), duration: subtractFractions(to, from) }];
			});
			return { index, number: ++printedBar, harmony };
		}).filter(bar => bar !== null);
		return { label: section.label, ending: section.ending, bars };
	}).filter(section => section.bars.length > 0);
}

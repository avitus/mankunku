import type { FlattenedTune } from './flatten';
import type { Fraction } from '$lib/types/music';
import { addFractions, subtractFractions, compareFractions, multiplyFraction } from '$lib/music/intervals';

interface BarRange { start: number; end: number }

/** Copy selected spans, retaining notation provenance even across omitted sections. */
function takeRanges(flat: FlattenedTune, meter: Fraction, ranges: BarRange[]) {
	const result: FlattenedTune = { notes: [], harmony: [], totalBars: 0, noteSourceIndices: [], segmentSourceIndices: [], sectionMap: [] };
	const sourceBars: number[] = [];
	for (const range of ranges) {
		const from = multiplyFraction(meter, range.start);
		const end = multiplyFraction(meter, range.end);
		const to = multiplyFraction(meter, result.totalBars);
		flat.notes.forEach((note, i) => {
			const stop = addFractions(note.offset, note.duration);
			if (compareFractions(stop, from) <= 0 || compareFractions(note.offset, end) >= 0) return;
			const start = compareFractions(note.offset, from) < 0 ? from : note.offset;
			const finish = compareFractions(stop, end) > 0 ? end : stop;
			result.notes.push({ ...note, offset: addFractions(to, subtractFractions(start, from)), duration: subtractFractions(finish, start) });
			result.noteSourceIndices.push(flat.noteSourceIndices[i]);
		});
		flat.harmony.forEach((h, i) => {
			const stop = addFractions(h.startOffset, h.duration);
			if (compareFractions(stop, from) <= 0 || compareFractions(h.startOffset, end) >= 0) return;
			const start = compareFractions(h.startOffset, from) < 0 ? from : h.startOffset;
			const finish = compareFractions(stop, end) > 0 ? end : stop;
			result.harmony.push({ ...h, startOffset: addFractions(to, subtractFractions(start, from)), duration: subtractFractions(finish, start) });
			result.segmentSourceIndices.push(flat.segmentSourceIndices[i]);
		});
		flat.sectionMap.forEach((entry, i) => {
			const stop = flat.sectionMap[i + 1]?.barOffset ?? flat.totalBars;
			if (entry.barOffset < range.end && stop > range.start) result.sectionMap.push({ ...entry, barOffset: result.totalBars + Math.max(entry.barOffset, range.start) - range.start });
		});
		for (let bar = range.start; bar < range.end; bar++) sourceBars.push(bar);
		result.totalBars += range.end - range.start;
	}
	return { flat: result, sourceBars };
}

/** Solo material from an explicitly annotated chart, with pickup and excluded bars removed. */
export function soloPlaybackFlat(flat: FlattenedTune, meter: Fraction, pickupBars: number) {
	return playbackWithoutSections(flat, meter, pickupBars, flat.omittedSoloSections);
}

function playbackWithoutSections(flat: FlattenedTune, meter: Fraction, pickupBars: number, sections?: number[]) {
	const omitted = new Set(sections);
	const ranges: BarRange[] = [];
	flat.sectionMap.forEach((entry, i) => {
		const end = flat.sectionMap[i + 1]?.barOffset ?? flat.totalBars;
		const start = Math.max(pickupBars, entry.barOffset);
		if (omitted.has(entry.sourceSection) || start >= end) return;
		const previous = ranges.at(-1);
		if (previous?.end === start) previous.end = end;
		else ranges.push({ start, end });
	});
	return takeRanges(flat, meter, ranges);
}

/** Explicit solo omissions override the heuristic that interprets a closing repeat as the form. */
export function sessionWithSoloOmissions(args: {
	flat: FlattenedTune; timeSignature: Fraction; headBars: number; soloStart: number; playHead: boolean; playOutro?: boolean; choruses: number;
	closingFlat: FlattenedTune; closingStart: number;
}) {
	const { flat, timeSignature: meter } = args;
	const solo = soloPlaybackFlat(flat, meter, args.soloStart);
	const notes: FlattenedTune['notes'] = [];
	const harmony: FlattenedTune['harmony'] = [];
	const sectionMap: FlattenedTune['sectionMap'] = [];
	const noteSourceIndices: number[] = [];
	const sessionBarMap: number[] = [];
	let phraseBars = 0;
	function append(part: FlattenedTune, sourceBars: number[], melody: boolean) {
		const shift = multiplyFraction(meter, phraseBars);
		if (melody) {
			notes.push(...part.notes.map(n => ({ ...n, offset: addFractions(n.offset, shift) })));
			noteSourceIndices.push(...part.noteSourceIndices);
		}
		harmony.push(...part.harmony.map(h => ({ ...h, startOffset: addFractions(h.startOffset, shift) })));
		sectionMap.push(...part.sectionMap.map(s => ({ ...s, barOffset: s.barOffset + phraseBars })));
		sessionBarMap.push(...sourceBars);
		phraseBars += part.totalBars;
	}
	if (args.playHead) {
		const head = takeRanges(flat, meter, [{ start: 0, end: args.headBars }]);
		append(head.flat, head.sourceBars, true);
	}
	const headBars = phraseBars;
	for (let i = 0; i < args.choruses; i++) append(solo.flat, solo.sourceBars, false);
	const { closingFlat, closingStart } = args;
	const closing = args.playHead && args.playOutro && solo.flat.totalBars > 0
		? playbackWithoutSections(closingFlat, meter, closingStart, closingFlat.omittedOutroSections)
		: null;
	const outroStartBar = closing?.flat.totalBars ? phraseBars : null;
	if (closing && outroStartBar !== null) append(closing.flat, closing.sourceBars, true);
	return { notes, harmony, sectionMap, phraseBars, headBars, duplicatedForm: true,
		outroStartBar, outroSourceStartBar: closing?.sourceBars[0] ?? closingStart, closingStartBar: outroStartBar,
		noteSourceIndices, sessionBarMap, soloBars: solo.flat.totalBars };
}

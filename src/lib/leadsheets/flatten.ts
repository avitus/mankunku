import type { Fraction, HarmonicSegment, Note } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import { addFractions, multiplyFraction } from '$lib/music/intervals';

/**
 * Flattening a lead sheet's section list into one continuous melody + harmony
 * timeline, so the notation renderer and backing-track engine can consume a
 * lead sheet exactly like a Phrase — no new orchestration.
 */

export interface FlattenedLeadSheet {
	/** Continuous melody with offsets shifted to the sheet timeline. */
	notes: Note[];
	/** Continuous harmony with startOffsets shifted to the sheet timeline. */
	harmony: HarmonicSegment[];
	/** Total length in bars of the flattened form. */
	totalBars: number;
}

export interface FlattenOptions {
	/**
	 * When true, repeated spans are written out in playback order (body,
	 * ending 1, body again, ending 2). When false (default), sections are
	 * concatenated once in notation order — what a renderer showing repeat
	 * barlines wants.
	 */
	expandRepeats?: boolean;
}

/**
 * Expand repeat structures into playback order. A span from `repeatStart` to
 * `repeatEnd` plays twice; consecutive `ending: 1` sections at the span's tail
 * play only on the first pass, and `ending: 2` sections following the span
 * play only on the second. An unbalanced `repeatStart` (no closing
 * `repeatEnd`) plays once rather than looping.
 */
function expandSections(sections: TuneSection[]): TuneSection[] {
	const out: TuneSection[] = [];
	let i = 0;
	while (i < sections.length) {
		if (!sections[i].repeatStart) {
			out.push(sections[i]);
			i++;
			continue;
		}

		let end = i;
		while (end < sections.length && !sections[end].repeatEnd) end++;
		if (end === sections.length) {
			// Unbalanced repeat — play the remainder once.
			out.push(...sections.slice(i));
			break;
		}

		const span = sections.slice(i, end + 1);
		const firstEndingStart = span.findIndex((s) => s.ending === 1);
		const body = firstEndingStart >= 0 ? span.slice(0, firstEndingStart) : span;
		const firstEnding = firstEndingStart >= 0 ? span.slice(firstEndingStart) : [];

		let next = end + 1;
		const secondEnding: TuneSection[] = [];
		while (next < sections.length && sections[next].ending === 2) {
			secondEnding.push(sections[next]);
			next++;
		}

		out.push(...body, ...firstEnding, ...body, ...secondEnding);
		i = next;
	}
	return out;
}

/**
 * Flatten a lead sheet's sections into a single continuous `notes[]` +
 * `harmony[]`, shifting each section's local offsets by the cumulative bar
 * count before it (in whole-note units).
 */
export function flattenLeadSheet(
	sheet: Tune,
	options: FlattenOptions = {}
): FlattenedLeadSheet {
	const barDuration: Fraction = [sheet.timeSignature[0], sheet.timeSignature[1]];
	const sequence = options.expandRepeats ? expandSections(sheet.sections) : sheet.sections;

	const notes: Note[] = [];
	const harmony: HarmonicSegment[] = [];
	let barsBefore = 0;

	for (const sec of sequence) {
		if (barsBefore === 0) {
			notes.push(...sec.notes.map((n) => ({ ...n })));
			harmony.push(...sec.harmony.map((h) => ({ ...h, chord: { ...h.chord } })));
		} else {
			const shift = multiplyFraction(barDuration, barsBefore);
			notes.push(...sec.notes.map((n) => ({ ...n, offset: addFractions(n.offset, shift) })));
			harmony.push(...sec.harmony.map((h) => ({
				...h,
				chord: { ...h.chord },
				startOffset: addFractions(h.startOffset, shift)
			})));
		}
		barsBefore += sec.bars;
	}

	return { notes, harmony, totalBars: barsBefore };
}

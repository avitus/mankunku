import type { Fraction, HarmonicSegment, Note } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import { addFractions, multiplyFraction } from '$lib/music/intervals';

/**
 * Flattening a tune's section list into one continuous melody + harmony
 * timeline, so the notation renderer and backing-track engine can consume a
 * tune exactly like a Phrase — no new orchestration.
 */

export interface FlattenedTune {
	/** Continuous melody with offsets shifted to the sheet timeline. */
	notes: Note[];
	/** Continuous harmony with startOffsets shifted to the sheet timeline. */
	harmony: HarmonicSegment[];
	/** Total length in bars of the flattened form. */
	totalBars: number;
	/**
	 * notes[i] ↔ index of the same authored note in the NOTATION-order flatten
	 * (== the chart-anchor `sourceIndex` space of `tuneToAbcWithMap`).
	 * Identity when `expandRepeats` is false; on an expanded timeline a
	 * repeated section's second pass maps back to the same notation indices.
	 */
	noteSourceIndices: number[];
	/** harmony[i] ↔ index in the notation-order flattened harmony. Identity when unexpanded. */
	segmentSourceIndices: number[];
	/**
	 * One entry per emitted section in THIS timeline's order: which authored
	 * section it came from and its bar offset on this timeline.
	 */
	sectionMap: { sourceSection: number; barOffset: number }[];
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
 * Expand repeat structures into playback order, tracking each emitted
 * section's authored index. A span from `repeatStart` to `repeatEnd` plays
 * twice; consecutive `ending: 1` sections at the span's tail play only on the
 * first pass, and `ending: 2` sections following the span play only on the
 * second. An unbalanced `repeatStart` (no closing `repeatEnd`) plays once
 * rather than looping.
 */
function expandSections(sections: TuneSection[]): {
	sections: TuneSection[];
	sourceIndices: number[];
} {
	const out: TuneSection[] = [];
	const sourceIndices: number[] = [];
	const pushRange = (from: number, to: number) => {
		for (let k = from; k < to; k++) {
			out.push(sections[k]);
			sourceIndices.push(k);
		}
	};

	let i = 0;
	while (i < sections.length) {
		if (!sections[i].repeatStart) {
			pushRange(i, i + 1);
			i++;
			continue;
		}

		let end = i;
		while (end < sections.length && !sections[end].repeatEnd) end++;
		if (end === sections.length) {
			// Unbalanced repeat — play the remainder once.
			pushRange(i, sections.length);
			break;
		}

		const spanEnd = end + 1;
		let firstEndingStart = -1;
		for (let k = i; k < spanEnd; k++) {
			if (sections[k].ending === 1) {
				firstEndingStart = k;
				break;
			}
		}
		const bodyEnd = firstEndingStart >= 0 ? firstEndingStart : spanEnd;

		let next = spanEnd;
		pushRange(i, bodyEnd);
		if (firstEndingStart >= 0) pushRange(firstEndingStart, spanEnd);
		pushRange(i, bodyEnd);
		while (next < sections.length && sections[next].ending === 2) {
			pushRange(next, next + 1);
			next++;
		}
		i = next;
	}
	return { sections: out, sourceIndices };
}

/**
 * Flatten a tune's sections into a single continuous `notes[]` +
 * `harmony[]`, shifting each section's local offsets by the cumulative bar
 * count before it (in whole-note units). Provenance arrays map every emitted
 * note/segment back to its notation-order index (identity when unexpanded),
 * so playback-timeline consumers can address chart anchors in O(1).
 */
export function flattenTune(
	sheet: Tune,
	options: FlattenOptions = {}
): FlattenedTune {
	const barDuration: Fraction = [sheet.timeSignature[0], sheet.timeSignature[1]];
	const expanded = options.expandRepeats
		? expandSections(sheet.sections)
		: { sections: sheet.sections, sourceIndices: sheet.sections.map((_, i) => i) };

	// Notation-order flat-index bases per authored section — the same
	// accumulation the chart anchor map uses (tune-notation's
	// flattenedNoteBase), which is what keeps provenance aligned with anchors.
	const noteBase: number[] = [];
	const segBase: number[] = [];
	let nb = 0;
	let sb = 0;
	for (const sec of sheet.sections) {
		noteBase.push(nb);
		segBase.push(sb);
		nb += sec.notes.length;
		sb += sec.harmony.length;
	}

	const notes: Note[] = [];
	const harmony: HarmonicSegment[] = [];
	const noteSourceIndices: number[] = [];
	const segmentSourceIndices: number[] = [];
	const sectionMap: { sourceSection: number; barOffset: number }[] = [];
	let barsBefore = 0;

	for (let j = 0; j < expanded.sections.length; j++) {
		const sec = expanded.sections[j];
		const src = expanded.sourceIndices[j];
		sectionMap.push({ sourceSection: src, barOffset: barsBefore });
		const shift = barsBefore === 0 ? null : multiplyFraction(barDuration, barsBefore);

		for (let n = 0; n < sec.notes.length; n++) {
			const note = sec.notes[n];
			notes.push(shift ? { ...note, offset: addFractions(note.offset, shift) } : { ...note });
			noteSourceIndices.push(noteBase[src] + n);
		}
		for (let h = 0; h < sec.harmony.length; h++) {
			const seg = sec.harmony[h];
			harmony.push(
				shift
					? { ...seg, chord: { ...seg.chord }, startOffset: addFractions(seg.startOffset, shift) }
					: { ...seg, chord: { ...seg.chord } }
			);
			segmentSourceIndices.push(segBase[src] + h);
		}
		barsBefore += sec.bars;
	}

	return { notes, harmony, totalBars: barsBefore, noteSourceIndices, segmentSourceIndices, sectionMap };
}

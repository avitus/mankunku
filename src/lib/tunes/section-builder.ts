import type { Fraction, Note } from '$lib/types/music';
import type { TuneSection } from '$lib/types/tune';
import { addFractions, subtractFractions, compareFractions } from '$lib/music/intervals';
import { harmonicSegmentFromSymbol } from '$lib/tunes/segment-from-symbol';

/**
 * Shared section assembly — the ONE place where a flat bar-by-bar structural
 * reading (rehearsal marks, repeat barlines, volta endings, pickup flags)
 * plus absolute-offset melody/harmony events becomes TuneSections.
 *
 * Both score importers feed this: the MuseScore parser from the .mscx
 * measure stream, and the PDF extraction from the model's per-bar
 * transcription — so equivalent structural readings produce IDENTICAL forms
 * by construction. Semantics grown against real charts:
 *  - sections split at marks, |:, after :|, and at volta-membership changes;
 *  - a lone flagged anacrusis (and any unmarked front matter before the
 *    first real mark) stays unlabeled and outside repeats;
 *  - an orphan :| synthesizes "repeat from the top of the form";
 *  - unmarked sections take the next unused letter; ending sections inherit
 *    their body's label;
 *  - the in-effect chord is restated across section boundaries.
 */

/** One bar of the piece, in reading order. */
export interface BarStructure {
	/** Absolute start offset in whole notes. */
	startOffset: Fraction;
	/** The bar's length (the meter in effect at this bar). */
	length: Fraction;
	rehearsalMark: string | null;
	startRepeat: boolean;
	endRepeat: boolean;
	/** True for a right-aligned anacrusis bar. */
	pickup: boolean;
	/** Volta this bar belongs to (1st/2nd ending), if any. */
	ending?: 1 | 2;
}

/** A chord change point on the absolute timeline (concert-pitch text). */
export interface HarmonyChange {
	offset: Fraction;
	text: string;
}

interface SectionBuilder {
	/** Rehearsal-mark label, or null until an auto letter is assigned. */
	label: string | null;
	/** True for the lone anacrusis section (unlabeled, outside repeats). */
	pickup: boolean;
	/** Volta ending number, when this section IS an ending. */
	ending?: 1 | 2;
	/** Ending sections continue the body — they inherit its label. */
	inheritLabel: boolean;
	firstMeasure: number;
	measureCount: number;
	startRepeat: boolean;
	endRepeat: boolean;
	startOffset: Fraction;
	endOffset: Fraction;
}

/**
 * @param harmonies Chord change points; consumed in ascending-offset order
 * (the dedupe, carried-chord lookup, and next-change end boundaries all
 * assume it), so foreign/importer input is defensively sorted first.
 */
export function buildSections(
	measures: BarStructure[],
	notes: Note[],
	harmonies: HarmonyChange[],
	warnOnce: (msg: string) => void
): TuneSection[] {
	harmonies = [...harmonies].sort((a, b) => compareFractions(a.offset, b.offset));
	// Sections split at rehearsal marks AND at repeat barlines: a |: opens a
	// section and a :| closes one, so a simple repeat is always representable
	// (sections repeat as whole units). Unmarked sections get running letters.
	const startsSection = (i: number): boolean =>
		i === 0 ||
		measures[i].rehearsalMark !== null ||
		measures[i].startRepeat ||
		measures[i - 1].endRepeat ||
		measures[i].ending !== measures[i - 1].ending;

	const builders: SectionBuilder[] = [];
	measures.forEach((m, i) => {
		if (startsSection(i)) {
			builders.push({
				label: m.rehearsalMark,
				pickup: false,
				ending: m.ending,
				inheritLabel: m.ending !== undefined && m.rehearsalMark === null,
				firstMeasure: i,
				measureCount: 0,
				startRepeat: false,
				endRepeat: false,
				startOffset: m.startOffset,
				endOffset: m.startOffset
			});
		}
		const current = builders[builders.length - 1];
		current.measureCount += 1;
		current.endOffset = addFractions(m.startOffset, m.length);
		// Both flags land on section boundaries by construction now.
		if (m.startRepeat) current.startRepeat = true;
		if (m.endRepeat) current.endRepeat = true;
	});

	// A lone anacrusis bar ahead of the first section boundary sits outside
	// the form — it stays UNLABELED (no boxed marker) and consumes no letter.
	if (
		measures[0]?.pickup &&
		measures[0].rehearsalMark === null &&
		builders.length > 1 &&
		builders[0].measureCount === 1
	) {
		builders[0].label = '';
		builders[0].pickup = true;
	}

	// Unmarked front matter ahead of the first real rehearsal mark carries no
	// letter either — it's the pickup/intro bar of the form the marks define,
	// and a boxed 'C' ahead of 'A' reads as an error, not a section.
	const hasMarks = builders.some((b) => b.label !== null && b.label !== '');
	if (hasMarks && builders[0] && builders[0].label === null && !builders[0].inheritLabel) {
		builders[0].label = '';
	}

	// A lone :| with no |: means "repeat from the top" (or from the bar after
	// the previous :|) — synthesize the opening so playback matches the page.
	// "The top" is the top of the FORM: pickup/front-matter bars stay outside.
	let spanStart = builders[0]?.label === '' ? 1 : 0;
	let hasStart = false;
	builders.forEach((b, i) => {
		if (b.startRepeat) hasStart = true;
		if (b.endRepeat) {
			// spanStart can point past the end for a pickup-only form (a
			// single '' -labelled bar carrying an orphan :|) — nothing to open.
			if (!hasStart && builders[spanStart]) builders[spanStart].startRepeat = true;
			spanStart = i + 1;
			hasStart = false;
		}
	});

	// Unmarked sections get the next letter NOT already taken by a rehearsal
	// mark or an earlier auto label — a colliding duplicate would be
	// suppressed by the notation's consecutive-part-label logic.
	const usedLabels = new Set(builders.map((b) => b.label).filter((l) => l !== null));
	for (const b of builders) {
		if (b.label !== null || b.inheritLabel) continue;
		let code = 65; // 'A'
		while (usedLabels.has(String.fromCharCode(code))) code++;
		b.label = String.fromCharCode(code);
		usedLabels.add(b.label);
	}
	// Ending sections continue their body's material — same label, no letter.
	builders.forEach((b, i) => {
		if (b.inheritLabel && b.label === null) b.label = builders[i - 1]?.label ?? 'A';
	});

	return builders.map((b) => {
		const inRange = (offset: Fraction): boolean =>
			compareFractions(offset, b.startOffset) >= 0 && compareFractions(offset, b.endOffset) < 0;

		const sectionNotes: Note[] = notes
			.filter((n) => inRange(n.offset))
			.map((n) => ({ ...n, offset: subtractFractions(n.offset, b.startOffset) }));

		// Later declaration wins when two changes share an anchor (e.g. a
		// snapped pickup chord landing on an already-occupied beat) — avoids
		// zero-duration segments.
		const changes = harmonies
			.filter((h) => inRange(h.offset))
			.filter((h, i, arr) => i + 1 === arr.length || compareFractions(arr[i + 1].offset, h.offset) !== 0);

		// Carry the in-effect chord across the section boundary: a section
		// opened by a repeat barline (or a mark placed mid-harmony) restates
		// the active chord at its start so coverage survives the split.
		const active = harmonies.filter((h) => compareFractions(h.offset, b.startOffset) < 0).pop();
		if (active && (changes.length === 0 || compareFractions(changes[0].offset, b.startOffset) > 0)) {
			changes.unshift({ offset: b.startOffset, text: active.text });
		}
		const harmony = changes.flatMap((h, i) => {
			const end = i + 1 < changes.length ? changes[i + 1].offset : b.endOffset;
			const duration = subtractFractions(end, h.offset);
			const segment = harmonicSegmentFromSymbol(
				h.text,
				subtractFractions(h.offset, b.startOffset),
				duration
			);
			if (!segment) {
				// Printed bar number (pickups excluded from numbering).
				let bar = 0;
				let pickups = 0;
				for (const m of measures) {
					if (compareFractions(m.startOffset, h.offset) > 0) break;
					bar++;
					if (m.pickup) pickups++;
				}
				// Clamp: a chord anchored IN a pickup bar counts both bar++ and
				// pickups++, which would print "bar 0"; attribute it to bar 1,
				// the bar the pickup leads into.
				warnOnce(
					`bar ${Math.max(1, bar - pickups)}: Chord "${h.text}" was not recognized and was skipped.`
				);
				return [];
			}
			return [segment];
		});

		return {
			label: b.label ?? 'A',
			bars: b.measureCount,
			...(b.startRepeat ? { repeatStart: true } : {}),
			...(b.endRepeat ? { repeatEnd: true } : {}),
			...(b.ending ? { ending: b.ending } : {}),
			notes: sectionNotes,
			harmony
		};
	});
}

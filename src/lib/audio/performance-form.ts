import type { PerformanceChorus, PerformanceForm, PerformanceRole, PerformanceSection } from '$lib/types/performance-form';

export type { PerformanceChorus, PerformanceForm, PerformanceRole, PerformanceSection } from '$lib/types/performance-form';

export interface PerformanceFormInput {
	totalBars: number;
	sectionMap: readonly { sourceSection: number; barOffset: number }[];
	/** Supplied by the session owner; never inferred from source-section order. */
	choruses: readonly Omit<PerformanceChorus, 'index'>[];
}

/**
 * Attach authored-section occurrences to explicit performed passes. This only
 * describes an existing timeline: it never shifts notes, changes, or chart bars.
 * Section spans are split at chorus boundaries; unlabelled spans keep null
 * provenance instead of inventing an authored section.
 */
export function buildPerformanceForm(input: PerformanceFormInput): PerformanceForm {
	const { totalBars, sectionMap } = input;
	if (!Number.isInteger(totalBars) || totalBars < 0) throw new Error('Invalid performance bar count');
	let end = 0;
	const choruses = input.choruses.map((chorus, index) => {
		if (!Number.isInteger(chorus.startBar) || !Number.isInteger(chorus.endBarExclusive)
			|| chorus.startBar !== end || chorus.endBarExclusive <= chorus.startBar
			|| chorus.endBarExclusive > totalBars) {
			throw new Error('Performance choruses must cover contiguous, non-overlapping bars');
		}
		end = chorus.endBarExclusive;
		return { ...chorus, index };
	});
	if (end !== totalBars) throw new Error('Performance choruses must cover the complete timeline');
	for (let i = 0; i < sectionMap.length; i++) {
		const entry = sectionMap[i];
		if (!Number.isInteger(entry.barOffset) || entry.barOffset < 0 || entry.barOffset > totalBars
			|| (i > 0 && entry.barOffset < sectionMap[i - 1].barOffset)) {
			throw new Error('Performance sections must use ordered bar offsets within the timeline');
		}
	}
	const sections: PerformanceSection[] = [];
	const occurrences = new Map<number | null, number>();
	for (const chorus of choruses) {
		const boundaries = [...new Set([
			chorus.startBar,
			...sectionMap.filter((s) => s.barOffset > chorus.startBar && s.barOffset < chorus.endBarExclusive).map((s) => s.barOffset),
			chorus.endBarExclusive
		])];
		for (let i = 0; i < boundaries.length - 1; i++) {
			const startBar = boundaries[i];
			let sourceSection: number | null = null;
			for (const entry of sectionMap) {
				if (entry.barOffset > startBar) break;
				sourceSection = entry.sourceSection;
			}
			const occurrenceIndex = occurrences.get(sourceSection) ?? 0;
			sections.push({ index: sections.length, sourceSection, occurrenceIndex, chorusIndex: chorus.index,
				startBar, endBarExclusive: boundaries[i + 1] });
			occurrences.set(sourceSection, occurrenceIndex + 1);
		}
	}
	return { version: 1, totalBars, choruses, sections };
}

export interface PhraseUnitPosition {
	/** Group index within the current section occurrence. */
	index: number;
	barIndex: number;
	/** Actual length, truncated at the end of a section/chorus. */
	lengthBars: number;
	/** 0 at the first bar, 1 at the last (a one-bar unit is already final). */
	position: number;
	/** Includes the current bar. */
	barsRemaining: number;
	isFinalBar: boolean;
}

export interface PerformanceBarContext {
	barIndex: number;
	role: PerformanceRole;
	chorusIndex: number;
	sectionIndex: number;
	sourceSection: number | null;
	sectionOccurrence: number;
	barInChorus: number;
	barsInChorus: number;
	barInSection: number;
	barsInSection: number;
	isChorusFirstBar: boolean;
	/** Factual end of a pass, including the performance's final pass. */
	isChorusFinalBar: boolean;
	isSectionFirstBar: boolean;
	isSectionFinalBar: boolean;
	isFinalBar: boolean;
	phrase2: PhraseUnitPosition;
	phrase4: PhraseUnitPosition;
	phrase8: PhraseUnitPosition;
	/** Strength of the boundary AFTER this bar, from 0 to 1. */
	boundaryStrength: number;
}

function phraseUnit(barInSection: number, barsInSection: number, size: number): PhraseUnitPosition {
	const index = Math.floor(barInSection / size);
	const barIndex = barInSection % size;
	const lengthBars = Math.min(size, barsInSection - index * size);
	return { index, barIndex, lengthBars,
		position: lengthBars === 1 ? 1 : barIndex / (lengthBars - 1),
		barsRemaining: lengthBars - barIndex, isFinalBar: barIndex === lengthBars - 1 };
}

/** Return bar-level structural context without guessing choruses from repeats. */
export function performanceBarContext(form: PerformanceForm, barIndex: number): PerformanceBarContext | null {
	if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= form.totalBars) return null;
	const section = form.sections.find((s) => barIndex >= s.startBar && barIndex < s.endBarExclusive);
	if (!section) return null;
	const chorus = form.choruses[section.chorusIndex];
	const barInSection = barIndex - section.startBar;
	const barsInSection = section.endBarExclusive - section.startBar;
	const phrase2 = phraseUnit(barInSection, barsInSection, 2);
	const phrase4 = phraseUnit(barInSection, barsInSection, 4);
	const phrase8 = phraseUnit(barInSection, barsInSection, 8);
	const isChorusFinalBar = barIndex === chorus.endBarExclusive - 1;
	const isSectionFinalBar = barIndex === section.endBarExclusive - 1;
	const boundaryStrength = isChorusFinalBar ? 1 : isSectionFinalBar ? 0.85
		: phrase8.isFinalBar ? 0.75 : phrase4.isFinalBar ? 0.5 : phrase2.isFinalBar ? 0.25 : 0;
	return {
		barIndex, role: chorus.role, chorusIndex: chorus.index, sectionIndex: section.index,
		sourceSection: section.sourceSection, sectionOccurrence: section.occurrenceIndex,
		barInChorus: barIndex - chorus.startBar, barsInChorus: chorus.endBarExclusive - chorus.startBar,
		barInSection, barsInSection, isChorusFirstBar: barIndex === chorus.startBar,
		isChorusFinalBar, isSectionFirstBar: barIndex === section.startBar, isSectionFinalBar,
		isFinalBar: barIndex === form.totalBars - 1, phrase2, phrase4, phrase8, boundaryStrength
	};
}

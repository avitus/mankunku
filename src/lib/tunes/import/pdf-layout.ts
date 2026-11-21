/** Layout policy shared by canvas extraction and corpus evaluation. No browser or model dependencies. */
import { fractionToFloat } from '$lib/music/intervals';
import { midiToDisplayName } from '$lib/music/notation';
import { eventsByBar, type NoteEvent } from './pdf-noteheads';
import { matchPrintedBeams } from './pdf-raster-beams';
import type { Fraction, Note } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import type { SystemGeometry } from './pdf-geometry';

/** Keep the chord row above a staff and exclude the next system's chord row. */
export function systemCropBounds(
	systems: SystemGeometry[],
	index: number,
	height: number
): [number, number] {
	const { band, interline } = systems[index];
	const previous = systems[index - 1];
	const next = systems[index + 1];
	const splitBefore = previous
		? previous.band.bottom + (band.top - previous.band.bottom) * 0.35
		: 0;
	const splitAfter = next ? band.bottom + (next.band.top - band.bottom) * 0.35 : height;
	return [
		Math.max(0, Math.round(Math.max(splitBefore, band.top - 10 * interline))),
		Math.min(height, Math.round(Math.min(splitAfter, band.bottom + 4 * interline)))
	];
}

/** Refuse a fixed bar-count skeleton when missing boundaries would force invented music. */
export function layoutIssues(systems: SystemGeometry[]): string[] {
	const issues: string[] = [];
	for (const [i, system] of systems.entries()) {
		const widths = system.barlines.slice(1).map((x, j) => x - system.barlines[j]);
		if (!system.barlines.length) issues.push(`line ${i + 1}: no measure boundaries detected`);
		if (widths.length > 1 && Math.max(...widths) > 2.8 * Math.min(...widths)) {
			issues.push(`line ${i + 1}: measure boundaries are uncertain`);
		}
		// A barline touching the header with a very wide following span is
		// typically an opening repeat, with obscured internal boundaries.
		if (
			system.barlines[0] - system.firstBarLeft < system.interline &&
			widths.some((w) => w > 35 * system.interline)
		) {
			issues.push(`line ${i + 1}: opening boundary or hidden barlines need a layout reread`);
		}
	}
	return issues;
}

/** Detect a regular printed grid. A pickup occupies no column, and the final row may be short. */
export function printedSystemWidth(barCounts: number[], opensWithPickup: boolean): number | undefined {
	if (barCounts.length < 3) return undefined;
	const width = barCounts[0] - Number(opensWithPickup);
	const last = barCounts.at(-1)!;
	if (!Number.isInteger(width) || width < 2 || width > 8 || last < 1 || last > width) return undefined;
	return barCounts.slice(1, -1).every(count => count === width) ? width : undefined;
}

/** Preserve verified features of the physical page on the sections that survive editing and playback. */
export function retainPrintedLayout(sections: TuneSection[], systems: SystemGeometry[], meter: Fraction): void {
	const counts = systems.map(system => system.barlines.length);
	if (sections.reduce((n, section) => n + section.bars, 0) !== counts.reduce((a, b) => a + b, 0)) return;
	const width = printedSystemWidth(counts, Boolean(sections[0]?.pickupLength));
	const barDuration = fractionToFloat(meter);
	const bars = systems.flatMap((system, i) => system.barlines.map((_, b) => ({
		opensAtMargin: b === 0 && i > 0 && Math.abs(system.firstBarLeft - systems[i - 1].firstBarLeft) <= 2 * system.interline,
		bracket: system.openEndingBrackets?.[b],
		leader: system.endingDirectionLeaders?.includes(b),
		startWings: b === 0 ? system.initialRepeatWinged || systems[i - 1]?.repeatDots.at(-1)?.wingedRight
			: system.repeatDots[b - 1]?.wingedRight,
		endWings: system.repeatDots[b]?.wingedLeft
	})));
	let absolute = 0;
	for (const section of sections) {
		const first = bars[absolute];
		if (width !== undefined) section.printedBarsPerLine = width;
		if (section.ending && first?.bracket) section.printedEndingBracket = first.bracket;
		if (section.ending === 2 && first?.opensAtMargin) section.endingAtLeftMargin = true;
		for (const cue of section.directions ?? []) {
			const bar = absolute + Math.floor(fractionToFloat(cue.offset) / barDuration);
			if (cue.text === 'Solo break' && bars[bar]?.leader) cue.extendsToBarline = true;
		}
		const start = section.repeatStart && first?.startWings;
		const end = section.repeatEnd && bars[absolute + section.bars - 1]?.endWings;
		if (start || end) section.repeatWings = start && end ? 'both' : start ? 'start' : 'end';
		absolute += section.bars;
	}
}

/** The whole-page reader can split a handwritten beam on a beat boundary. Use
 * the same printed evidence as the line reader, before concert transposition. */
export function retainWholePdfBeams(
	sheet: Tune, systems: Array<{ geometry: SystemGeometry; noteEvents: NoteEvent[] }>
): void {
	const events = systems.flatMap(system => eventsByBar(system.noteEvents, system.geometry));
	if (events.length !== sheet.sections.reduce((n, section) => n + section.bars, 0)) return;
	const barDuration = fractionToFloat(sheet.timeSignature);
	let absolute = 0;
	for (const section of sheet.sections) {
		const bars: Note[][] = Array.from({ length: section.bars }, () => []);
		for (const note of section.notes) {
			if (note.pitch === null) continue;
			const bar = Math.floor(fractionToFloat(note.offset) / barDuration);
			bars[bar]?.push(note);
		}
		for (const notes of bars) {
			notes.sort((a, b) => fractionToFloat(a.offset) - fractionToFloat(b.offset));
			const marks = matchPrintedBeams(notes.map(note => ({
				name: midiToDisplayName(note.pitch!, note.spelling ? note.spelling === 'flat' : sheet.key),
				length: fractionToFloat(note.duration)
			})), events[absolute++]);
			for (const [i, mark] of marks) notes[i].beamFromPrevious = mark;
		}
	}
}

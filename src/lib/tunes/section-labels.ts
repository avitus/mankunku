import type { Tune, TuneSection } from '$lib/types/tune';
import { addFractions, subtractFractions, compareFractions, multiplyFraction } from '$lib/music/intervals';
import { resolvePickupLength } from '$lib/music/pickup';

/** Visible rehearsal marks; ending fragments inherit their body's mark. */
export function sectionLabels(tune: Pick<Tune, 'sections' | 'timeSignature'>) {
	let bar = 0;
	let previous = '';
	return tune.sections.flatMap((section, sectionIdx) => {
		const start = bar;
		bar += section.bars;
		const label = section.label.trim();
		if (!label || (label === previous && !section.labelExplicit)) return [];
		previous = label;
		return [{ sectionIdx, label, bar: start + (resolvePickupLength(tune, sectionIdx) && section.bars > 1 ? 1 : 0) }];
	});
}

/** Split a section without moving its music or its repeat/ending anchors. */
function split(section: TuneSection, bars: number, meter: Tune['timeSignature']): [TuneSection, TuneSection] {
	const at = multiplyFraction(meter, bars);
	const left: TuneSection = { ...section, bars, repeatEnd: undefined, notes: [], harmony: [] };
	const right: TuneSection = { ...section, label: '', labelExplicit: undefined, bars: section.bars - bars, repeatStart: undefined, pickupLength: undefined, notes: [], harmony: [] };
	for (const note of section.notes) {
		const end = addFractions(note.offset, note.duration);
		if (compareFractions(note.offset, at) >= 0) right.notes.push({ ...note, offset: subtractFractions(note.offset, at) });
		else if (compareFractions(end, at) <= 0) left.notes.push(note);
		else {
			left.notes.push({ ...note, gliss: undefined, duration: subtractFractions(at, note.offset), ...(note.pitch !== null ? { tied: true } : {}) });
			right.notes.push({ ...note, articulation: undefined, offset: [0, 1], duration: subtractFractions(end, at) });
		}
	}
	for (const chord of section.harmony) {
		const end = addFractions(chord.startOffset, chord.duration);
		if (compareFractions(chord.startOffset, at) >= 0) right.harmony.push({ ...chord, startOffset: subtractFractions(chord.startOffset, at) });
		else if (compareFractions(end, at) <= 0) left.harmony.push(chord);
		else {
			left.harmony.push({ ...chord, duration: subtractFractions(at, chord.startOffset) });
			right.harmony.push({ ...chord, startOffset: [0, 1], duration: subtractFractions(end, at) });
		}
	}
	return [left, right];
}

/** Remove label-only boundaries; structural signs remain attached to their bars. */
function joinUnmarked(sections: TuneSection[], meter: Tune['timeSignature']): TuneSection[] {
	const result: TuneSection[] = [];
	for (const section of sections) {
		const prev = result.at(-1);
		if (prev && !section.label && !section.repeatStart && !prev.repeatEnd && !section.pickupLength &&
			prev.ending === section.ending && !!prev.omitFromSolos === !!section.omitFromSolos) {
			const shift = multiplyFraction(meter, prev.bars);
			prev.notes.push(...section.notes.map(n => ({ ...n, offset: addFractions(shift, n.offset) })));
			prev.harmony.push(...section.harmony.map(h => ({ ...h, startOffset: addFractions(shift, h.startOffset) })));
			prev.bars += section.bars;
			prev.repeatEnd = section.repeatEnd;
		} else result.push({ ...section, notes: [...section.notes], harmony: [...section.harmony] });
	}
	return result;
}

/** Add, move, rename or remove a mark. Absolute bar anchors survive reflow. */
export function editSectionLabel(tune: Tune, from: number | null, to: number | null, text?: string): TuneSection[] | null {
	const marks = sectionLabels(tune);
	const mark = from === null ? undefined : marks.find(m => m.sectionIdx === from);
	if (from !== null && !mark) return null;
	const label = (text ?? mark?.label ?? '').trim();
	const total = tune.sections.reduce((n, s) => n + s.bars, 0);
	if (to !== null && (!Number.isInteger(to) || to < 0 || to >= total || !label || label.length > 80 || /[\r\n\[\]]/.test(label))) return null;
	if (to !== null && marks.some(m => m.bar === to && m.sectionIdx !== from)) return null;
	const sections = tune.sections.map(s => ({ ...s, notes: [...s.notes], harmony: [...s.harmony] }));
	if (mark) {
		const next = marks.find(m => m.sectionIdx > mark.sectionIdx)?.sectionIdx ?? sections.length;
		for (let i = mark.sectionIdx; i < next; i++) {
			if (to === mark.bar && sections[i].label) sections[i].label = label;
			else { sections[i].label = ''; sections[i].labelExplicit = undefined; }
		}
		if (to === mark.bar) { sections[mark.sectionIdx].labelExplicit = true; return sections; }
	}
	if (to !== null) {
		let base = 0;
		for (let i = 0; i < sections.length; i++) {
			const section = sections[i];
			if (to < base + section.bars) {
				if (to === base) { section.label = label; section.labelExplicit = true; }
				else {
					const [left, right] = split(section, to - base, tune.timeSignature);
					right.label = label;
					right.labelExplicit = true;
					sections.splice(i, 1, left, right);
				}
				break;
			}
			base += section.bars;
		}
	}
	return joinUnmarked(sections, tune.timeSignature);
}

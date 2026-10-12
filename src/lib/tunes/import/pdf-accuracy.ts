/** Accuracy metrics are independent of provider, decoder format, and historical regression floors. */
import type { Tune } from '$lib/types/tune';
import { chordSymbol } from '$lib/music/chords';
import { parseChordSymbol, formatChordSymbol } from '$lib/music/chord-symbol';

export interface PrecisionRecall {
	matched: number;
	expected: number;
	observed: number;
	precision: number;
	recall: number;
}
/** Multiset matching penalizes duplicate hallucinations. Locations are part of every token. */
export function precisionRecall(expected: string[], observed: string[]): PrecisionRecall {
	const remaining = new Map<string, number>();
	for (const event of expected) remaining.set(event, (remaining.get(event) ?? 0) + 1);
	let matched = 0;
	for (const event of observed) {
		const count = remaining.get(event) ?? 0;
		if (count > 0) {
			matched++;
			remaining.set(event, count - 1);
		}
	}
	return {
		matched,
		expected: expected.length,
		observed: observed.length,
		precision: observed.length ? matched / observed.length : expected.length ? 0 : 1,
		recall: expected.length ? matched / expected.length : 1
	};
}
const units = (fraction: [number, number]): number => Math.round((fraction[0] / fraction[1]) * 192);
function tokens(tune: Tune) {
	const pitches: string[] = [],
		rhythms: string[] = [],
		notes: string[] = [],
		chords: string[] = [],
		form: string[] = [];
	let start = 0,
		bars = 0;
	const barUnits = (tune.timeSignature[0] / tune.timeSignature[1]) * 192;
	for (const section of tune.sections) {
		for (const note of section.notes) {
			if (note.pitch === null) continue;
			const location = start + units(note.offset),
				duration = units(note.duration);
			pitches.push(`${location}:${note.pitch}`);
			rhythms.push(`${location}:${duration}`);
			notes.push(`${location}:${note.pitch}:${duration}:${!!note.tied}`);
		}
		for (const chord of section.harmony) {
			const symbol = chord.symbol ?? chordSymbol(chord.chord.root, chord.chord.quality);
			const parsed = parseChordSymbol(symbol);
			chords.push(
				`${start + units(chord.startOffset)}:${parsed ? formatChordSymbol(parsed) : symbol}`
			);
		}
		if (section.repeatStart) form.push(`${bars}:startRepeat`);
		if (section.repeatEnd) form.push(`${bars + section.bars}:endRepeat`);
		if (section.ending) form.push(`${bars}:ending${section.ending}`);
		if (section.pickupLength) form.push(`${bars}:pickup${units(section.pickupLength)}`);
		bars += section.bars;
		start += section.bars * barUnits;
	}
	return { pitches, rhythms, notes, chords, form, bars };
}
export function measurePdfAccuracy(expected: Tune, observed: Tune) {
	const a = tokens(expected),
		b = tokens(observed);
	return {
		keyCorrect: expected.key === observed.key,
		meterCorrect: expected.timeSignature.join('/') === observed.timeSignature.join('/'),
		bars: { expected: a.bars, observed: b.bars },
		pitches: precisionRecall(a.pitches, b.pitches),
		rhythms: precisionRecall(a.rhythms, b.rhythms),
		notes: precisionRecall(a.notes, b.notes),
		chords: precisionRecall(a.chords, b.chords),
		form: precisionRecall(a.form, b.form)
	};
}
/** Release targets, not a claim that today's provider meets them. No expected-failure exemptions. */
export function pdfAccuracyGate(
	metrics: ReturnType<typeof measurePdfAccuracy>,
	reviewedReference: boolean
): string[] {
	const failures: string[] = [];
	if (!reviewedReference) failures.push('reference requires independent review');
	if (!metrics.keyCorrect) failures.push('wrong key');
	if (!metrics.meterCorrect) failures.push('wrong meter');
	if (metrics.bars.expected !== metrics.bars.observed) failures.push('wrong measure count');
	for (const name of ['pitches', 'rhythms', 'notes', 'chords', 'form'] as const) {
		const threshold = name === 'form' ? 1 : 0.95;
		if (metrics[name].precision < threshold || metrics[name].recall < threshold)
			failures.push(`${name} below ${threshold * 100}% precision/recall`);
	}
	return failures;
}

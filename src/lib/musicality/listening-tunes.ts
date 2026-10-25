import { ALL_CURATED_TUNES } from '$lib/data/tunes';
import { transposeTune } from '$lib/tunes/book-loader';
import { flattenTune } from '$lib/tunes/flatten';
import { buildSessionPhrase } from '$lib/state/tune-practice-plan';
import { PITCH_CLASSES, type Phrase, type PitchClass } from '$lib/types/music';
import { buildPerformanceForm, performanceBarContext, type PerformanceBarContext, type PerformanceForm } from '$lib/audio/performance-form';
import { addFractions, subtractFractions, compareFractions, fractionToFloat } from '$lib/music/intervals';
import { chordSymbol } from '$lib/music/chords';
import type { Tune } from '$lib/types/tune';

/** Real charts available in the app; the current orchestration supports 4/4. */
export const LISTENING_TUNES = ALL_CURATED_TUNES
	.filter((tune) => tune.timeSignature[0] === 4 && tune.timeSignature[1] === 4)
	.map(({ id, title, composer, key }) => ({ id, title, composer, key }));

export interface ListeningTuneOptions {
	tuneId: string;
	key?: PitchClass;
	/** Solo passes between the head in and head out. Defaults to two. */
	soloChoruses?: number;
}

export interface ListeningTuneBar {
	/** Zero-based position in the complete finite performance. */
	barIndex: number;
	/** One-based number suitable for display. */
	barNumber: number;
	sectionLabel: string;
	context: PerformanceBarContext;
	chordSymbols: string[];
	changes: { symbol: string; beatOffset: number; durationBeats: number; held: boolean }[];
}

export interface ListeningTuneSession {
	tune: Tune;
	phrase: Phrase & { performanceForm: PerformanceForm };
	bars: ListeningTuneBar[];
	headBars: number;
	chorusBars: number;
	soloChoruses: number;
}

/** Build a finite, explicitly labelled performance from the app's real chart. */
export function buildListeningTuneSession(options: ListeningTuneOptions): ListeningTuneSession {
	const original = ALL_CURATED_TUNES.find((tune) => tune.id === options.tuneId);
	if (!original) throw new Error('Unknown listening tune');
	if (original.timeSignature[0] !== 4 || original.timeSignature[1] !== 4) {
		throw new Error('Full-tune listening currently supports 4/4 charts');
	}
	const soloChoruses = options.soloChoruses ?? 2;
	if (!Number.isInteger(soloChoruses) || soloChoruses < 1 || soloChoruses > 4) {
		throw new Error('Choose between 1 and 4 solo choruses');
	}
	const key = options.key ?? original.key;
	if (!PITCH_CLASSES.includes(key)) throw new Error('Unknown concert key');
	const tune = structuredClone(transposeTune(original, key));
	const flat = flattenTune(tune, { expandRepeats: true });
	const built = buildSessionPhrase({ flat, timeSignature: tune.timeSignature, playHead: true, choruses: soloChoruses });
	const chorusBars = (built.phraseBars - built.headBars) / soloChoruses;
	const headOutStart = built.phraseBars;
	const totalBars = headOutStart + chorusBars;
	// The final resolved pass supplies the closing head, including its second
	// ending. This retains practice's repeat semantics and does not replay an intro.
	const sourceStart = flat.totalBars - chorusBars;
	const boundary: [number, number] = [sourceStart, 1];
	const shift: [number, number] = [headOutStart - sourceStart, 1];
	const headOutHarmony = flat.harmony.flatMap((segment) => {
		const end = addFractions(segment.startOffset, segment.duration);
		if (compareFractions(end, boundary) <= 0) return [];
		const start = compareFractions(segment.startOffset, boundary) < 0 ? boundary : segment.startOffset;
		return [{ ...segment, chord: { ...segment.chord }, startOffset: addFractions(start, shift), duration: subtractFractions(end, start) }];
	});
	const headOutNotes = flat.notes.flatMap((note) => {
		const end = addFractions(note.offset, note.duration);
		if (compareFractions(end, boundary) <= 0) return [];
		const start = compareFractions(note.offset, boundary) < 0 ? boundary : note.offset;
		return [{ ...note, offset: addFractions(start, shift), duration: subtractFractions(end, start) }];
	});
	const sectionMap = [...built.sectionMap, ...flat.sectionMap.flatMap((entry, index) => {
		const end = flat.sectionMap[index + 1]?.barOffset ?? flat.totalBars;
		return end <= sourceStart ? [] : [{ sourceSection: entry.sourceSection,
			barOffset: headOutStart + Math.max(sourceStart, entry.barOffset) - sourceStart }];
	})];
	const performanceForm = buildPerformanceForm({ totalBars, sectionMap,
		choruses: [...built.performanceForm.choruses, { role: 'head', startBar: headOutStart, endBarExclusive: totalBars }] });
	const phrase: ListeningTuneSession['phrase'] = {
		id: `musicality-${original.id}-${key}-${soloChoruses}`,
		name: tune.title,
		key,
		timeSignature: tune.timeSignature,
		notes: [...built.notes, ...headOutNotes],
		harmony: [...built.harmony, ...headOutHarmony],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, ...tune.difficulty, lengthBars: totalBars },
		category: 'user', tags: [...tune.tags], source: tune.source,
		sectionMap, performanceForm
	};
	const bars: ListeningTuneBar[] = Array.from({ length: totalBars }, (_, barIndex) => {
		const context = performanceBarContext(performanceForm, barIndex)!;
		const changes = phrase.harmony.flatMap((segment) => {
			const start = fractionToFloat(segment.startOffset);
			const end = start + fractionToFloat(segment.duration);
			if (end <= barIndex || start >= barIndex + 1) return [];
			const symbol = segment.symbol ?? `${chordSymbol(segment.chord.root, segment.chord.quality)}${segment.chord.bass ? `/${segment.chord.bass}` : ''}`;
			return [{ symbol, beatOffset: (Math.max(start, barIndex) - barIndex) * 4,
				durationBeats: (Math.min(end, barIndex + 1) - Math.max(start, barIndex)) * 4, held: start < barIndex }];
		});
		return { barIndex, barNumber: barIndex + 1, context,
			sectionLabel: context.sourceSection === null ? 'Unlabelled' : tune.sections[context.sourceSection].label,
			chordSymbols: changes.map((change) => change.symbol), changes };
	});
	return { tune, phrase, bars, headBars: built.headBars, chorusBars, soloChoruses };
}

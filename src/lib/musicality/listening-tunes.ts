import { ALL_CURATED_TUNES } from '$lib/data/tunes';
import { transposeTune } from '$lib/tunes/book-loader';
import { flattenTune } from '$lib/tunes/flatten';
import { buildSessionPhrase, headBarsForFlat } from '$lib/state/tune-practice-plan';
import { PITCH_CLASSES, type Phrase, type PitchClass } from '$lib/types/music';
import { buildPerformanceForm, performanceBarContext, type PerformanceBarContext, type PerformanceForm } from '$lib/audio/performance-form';
import { addFractions, subtractFractions, compareFractions, fractionToFloat } from '$lib/music/intervals';
import { chordSymbol, CHORD_DEFINITIONS } from '$lib/music/chords';
import type { Tune } from '$lib/types/tune';
import { validateAdoptedTune } from '$lib/tunes/adopted-tune-validator';
import { getScale } from '$lib/music/scales';

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
	return buildSessionFromSource(original, options);
}

function buildSessionFromSource(original: Tune, options: ListeningTuneBuildOptions): ListeningTuneSession {
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

export type ListeningTuneBuildOptions = Omit<ListeningTuneOptions, 'tuneId'>;
export type ListeningTuneAssessment = { ok: true; session: ListeningTuneSession } | { ok: false; reason: string };

/** Existing renderer source limit; this adapter never expands or truncates it. */
export const MAX_LISTENING_SOURCE_BARS = 128;

/** Validate existing local data without repairing harmony or inferring repeat markers. */
function validateListeningSource(input: unknown, options: ListeningTuneBuildOptions): asserts input is Tune {
	const shape = validateAdoptedTune(input);
	if (!shape.valid) throw new Error(`This chart cannot be used for listening: ${shape.errors[0]}`);
	const tune = input as Tune;
	if (tune.timeSignature[0] !== 4 || tune.timeSignature[1] !== 4) throw new Error('Full-tune listening currently supports 4/4 charts');
	if (typeof tune.source !== 'string' || !tune.source.length) throw new Error('This chart has no source identity');
	const solos = options.soloChoruses ?? 2;
	if (!Number.isInteger(solos) || solos < 1 || solos > 4) throw new Error('Choose between 1 and 4 solo choruses');
	if (!PITCH_CLASSES.includes(options.key ?? tune.key)) throw new Error('Unknown concert key');
	let openRepeat = false;
	let firstEnding = false;
	let secondEndingAllowed = false;
	let needsSecondEnding = false;
	const invalidForm = () => { throw new Error('This chart has unsupported or incomplete repeat/ending markers'); };
	for (const section of tune.sections) {
		if ([section.repeatStart, section.repeatEnd].some(value => value !== undefined && typeof value !== 'boolean')) invalidForm();
		if (needsSecondEnding && section.ending !== 2) invalidForm();
		if (section.ending === 2) {
			if (!secondEndingAllowed || section.repeatStart || section.repeatEnd) invalidForm();
			needsSecondEnding = false;
		} else {
			secondEndingAllowed = false;
			if (section.repeatStart) {
				if (openRepeat) invalidForm();
				openRepeat = true;
			}
			if (section.ending === 1) {
				if (!openRepeat) invalidForm();
				firstEnding = true;
			} else if (firstEnding) invalidForm();
			if (section.repeatEnd) {
				if (!openRepeat) invalidForm();
				openRepeat = false;
				secondEndingAllowed = needsSecondEnding = firstEnding;
				firstEnding = false;
			}
		}
		let cursor = 0;
		for (const segment of section.harmony) {
			if (!Object.hasOwn(CHORD_DEFINITIONS, segment.chord.quality)) throw new Error('Unsupported chord quality');
			if (![...segment.startOffset, ...segment.duration].every(Number.isSafeInteger)) throw new Error('Harmony positions need safe rational quarter-note values');
			if (!getScale(segment.scaleId)) throw new Error(`Unsupported harmony scale: ${segment.scaleId}`);
			const start = fractionToFloat(segment.startOffset) * 4;
			const length = fractionToFloat(segment.duration) * 4;
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length <= 0 || start !== cursor || start + length > section.bars * 4) {
				throw new Error('Listening needs complete contiguous harmony on quarter-note boundaries');
			}
			cursor = start + length;
		}
		if (cursor !== section.bars * 4) throw new Error('Listening needs harmony covering every bar of each section');
		for (const note of section.notes) {
			if (![...note.offset, ...note.duration].every(Number.isSafeInteger)) throw new Error('Melody positions need safe rational values');
			const start = fractionToFloat(note.offset);
			const end = start + fractionToFloat(note.duration);
			if (!Number.isFinite(end) || start < 0 || end > section.bars) throw new Error('A melody note extends beyond its chart section');
		}
	}
	if (openRepeat || needsSecondEnding) invalidForm();
	const flat = flattenTune(tune, { expandRepeats: true });
	const { headBars, formRepeats } = headBarsForFlat(flat);
	const chorusBars = formRepeats ? flat.totalBars - headBars : flat.totalBars;
	const totalBars = headBars + (solos + 1) * chorusBars;
	if (!Number.isSafeInteger(totalBars) || chorusBars <= 0 || totalBars < 1 || totalBars > MAX_LISTENING_SOURCE_BARS) {
		throw new Error(`This arrangement exceeds the ${MAX_LISTENING_SOURCE_BARS}-bar listening limit; choose fewer solo choruses or a shorter chart`);
	}
}

/** Build from a captured tune object; never reads or writes a tune-book store. */
export function buildListeningTuneSessionFromTune(tune: Tune, options: ListeningTuneBuildOptions = {}): ListeningTuneSession {
	validateListeningSource(tune, options);
	return validateExpandedSession(buildSessionFromSource(tune, options));
}

/** Safe admission for untrusted local/imported payloads; errors remain visible to the caller. */
export function assessListeningTune(input: unknown, options: ListeningTuneBuildOptions = {}): ListeningTuneAssessment {
	try {
		validateListeningSource(input, options);
		return { ok: true, session: validateExpandedSession(buildSessionFromSource(input, options)) };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : 'This chart cannot be used for listening' };
	}
}

/** Check the actual expanded result too; unsafe fraction arithmetic cannot escape admission. */
function validateExpandedSession(session: ListeningTuneSession): ListeningTuneSession {
	const totalBars = session.phrase.performanceForm.totalBars;
	if (!Number.isSafeInteger(totalBars) || totalBars < 1 || totalBars > MAX_LISTENING_SOURCE_BARS || session.bars.length !== totalBars) {
		throw new Error('The expanded listening form is invalid');
	}
	let cursor = 0;
	for (const segment of session.phrase.harmony) {
		const start = fractionToFloat(segment.startOffset) * 4;
		const length = fractionToFloat(segment.duration) * 4;
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length <= 0 || start !== cursor) {
			throw new Error('The expanded chart needs complete contiguous quarter-note harmony');
		}
		cursor = start + length;
	}
	if (cursor !== totalBars * 4) throw new Error('The expanded harmony does not cover the listening form');
	for (const note of session.phrase.notes) {
		if (note.pitch !== null && (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127)) {
			throw new Error('The transposed melody contains a pitch outside MIDI range');
		}
		const start = fractionToFloat(note.offset);
		const end = start + fractionToFloat(note.duration);
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > totalBars) {
			throw new Error('The expanded melody does not fit the listening form');
		}
	}
	return session;
}

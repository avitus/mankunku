import type { HarmonicSegment, Phrase } from '$lib/types/music';
import { parseChordSymbol } from '$lib/music/chord-symbol';
import { applySwingToBeats } from '$lib/music/swing';
import { pitchClassToNumber, shellVoicing } from './voicings';
import { compareFractions, fractionToFloat } from '$lib/music/intervals';
import { quarterBeatsPerBar } from '$lib/tunes/meter';
import type { BackingInstrument } from '$lib/types/instruments';
import type { StyleDefinition } from './backing-styles';
import { prepareReleasedArrangement } from './backing-arrangement';
import type { BackingGenerationParams, BassEvent, CompEvent, GeneratedBacking } from './backing-generation';

/** Musicality plans a continuous bar grid. Give its planner harmonic context in
 * written gaps, then gate the generated events against the original spans. */
function continuousPlanningHarmony(harmony: HarmonicSegment[], formQuarters: number): HarmonicSegment[] {
	const first = harmony[0];
	if (!first) return harmony;
	const result: HarmonicSegment[] = [];
	let cursor = 0;
	for (const segment of harmony) {
		const start = fractionToFloat(segment.startOffset) * 4;
		if (start > cursor + 1e-8) {
			result.push({ ...(result.at(-1) ?? first), startOffset: [cursor, 4], duration: [start - cursor, 4] });
		}
		result.push(segment);
		cursor = start + fractionToFloat(segment.duration) * 4;
	}
	if (formQuarters > cursor + 1e-8) {
		result.push({ ...harmony[harmony.length - 1], startOffset: [cursor, 4], duration: [formQuarters - cursor, 4] });
	}
	return result.length === harmony.length ? harmony : result;
}

/** Respect explicit no-chord passages even when the band anticipates the next chord or sustains a voicing. */
export function fitBackingToWrittenHarmony(
	backing: GeneratedBacking, harmony: HarmonicSegment[], tempo: number, ppq: number,
	soloBreaks: readonly number[] = [], quartersPerBar = 4
): GeneratedBacking {
	const breaks = soloBreaks.map(bar => ({
		start: bar * quartersPerBar, end: (Math.floor(bar) + 1) * quartersPerBar
	})).sort((a, b) => a.start - b.start);
	const spans: Array<{ start: number; end: number }> = [];
	for (const chord of harmony) {
		const start = fractionToFloat(chord.startOffset) * 4;
		const end = start + fractionToFloat(chord.duration) * 4;
		const previous = spans.at(-1);
		if (previous && start <= previous.end + 1e-8) previous.end = Math.max(previous.end, end);
		else spans.push({ start, end });
	}

	// Swing and human timing can anticipate a downbeat. Keep the band's re-entry
	// and move that attack onto the barline if it would land inside the break.
	function playableTick(absBeat: number, tick: number): number | null {
		for (const b of breaks) {
			if (absBeat >= b.start && absBeat < b.end) return null;
			if (tick >= b.start * ppq && tick < b.end * ppq) return absBeat >= b.end ? Math.round(b.end * ppq) : null;
		}
		return tick;
	}

	// Transpose and swing leave the score beat intact. Bound the scheduled ticks too,
	// so an early attack or a long release cannot sound inside a written rest.
	function fit<T extends BassEvent | CompEvent>(events: T[]): T[] {
		return events.flatMap(event => {
			const span = spans.find(s => event.absBeat >= s.start - 1e-8 && event.absBeat < s.end - 1e-8);
			if (!span) return [];
			const tick = playableTick(event.absBeat, Math.max(Math.round(span.start * ppq), parseInt(event.time, 10)));
			if (tick === null) return [];
			const beat = tick / ppq;
			const nextBreak = breaks.find(b => b.start > beat);
			const secondsLeft = (Math.min(span.end, nextBreak?.start ?? Infinity) - beat) * 60 / tempo;
			if (secondsLeft <= 0) return [];
			const duration = Math.min(secondsLeft, event.duration);
			const clippedCarry = 'barLineSustain' in event && event.barLineSustain &&
				(tick !== parseInt(event.time, 10) || duration < event.duration - 1e-8);
			return [{ ...event, time: `${tick}i`, duration, ...(clippedCarry && { barLineSustain: undefined }) }];
		});
	}
	// A solo break leaves the soloist alone, including when the drummer would anticipate the return.
	const drumEvents = breaks.length ? backing.drumEvents.flatMap(event => {
		const original = parseInt(event.time, 10);
		const tick = playableTick(event.absBeat, original);
		return tick === null ? [] : [tick === original ? event : { ...event, time: `${tick}i` }];
	}) : backing.drumEvents;
	return { ...backing, drumEvents, bassEvents: fit(backing.bassEvents), compEvents: fit(backing.compEvents) };
}

/** A chord change printed on the final melody attack is the band's written
 * landing. Ordinary jazz comping can otherwise miss a last offbeat entirely. */
function playWrittenFine(
	backing: GeneratedBacking, phrase: Phrase, chord: HarmonicSegment, params: BackingGenerationParams, melodySwing: number
): GeneratedBacking {
	const last = phrase.notes.findLast(note => note.pitch !== null);
	if (!last || compareFractions(last.offset, chord.startOffset) !== 0 ||
		phrase.performanceForm?.choruses.at(-1)?.role === 'solo') return backing;
	const beat = fractionToFloat(chord.startOffset) * 4;
	const length = fractionToFloat(chord.duration) * 4;
	if (length > 1 || Math.abs(beat - Math.round(beat)) < 1e-8) return backing;
	const end = beat + length;
	const barLength = quarterBeatsPerBar(phrase.timeSignature);
	const formEnd = (phrase.performanceForm?.totalBars ?? phrase.difficulty.lengthBars) * barLength;
	if (Math.abs(end - formEnd) > 1e-8 || phrase.soloBreaks?.some(bar =>
		beat >= bar * barLength && beat < (Math.floor(bar) + 1) * barLength)) return backing;
	const tick = Math.round(applySwingToBeats(beat, melodySwing) * params.ppq);
	const secondsPerTick = 60 / params.tempo / params.ppq;
	const duration = (end * params.ppq - tick) * secondsPerTick;
	if (duration <= 0) return backing;
	function finishBefore<T extends BassEvent | CompEvent>(events: T[]): T[] {
		return events.flatMap(event => {
			const left = (tick - parseInt(event.time, 10)) * secondsPerTick;
			if (event.absBeat >= beat || left <= 0) return [];
			return [event.duration <= left ? event : { ...event, duration: left, ...('barLineSustain' in event && { barLineSustain: undefined }) }];
		});
	}
	const time = `${tick}i`;
	const root = pitchClassToNumber(chord.chord.root);
	const written = chord.symbol ? parseChordSymbol(chord.symbol) : null;
	const triad = written && !written.extensions.length && !written.alterations.length && (written.quality === 'maj' || written.quality === 'min');
	const notes = triad ? [48 + root, 48 + root + (written.quality === 'min' ? 3 : 4), 55 + root]
		: shellVoicing(chord.chord.root, chord.chord.quality);
	return { ...backing,
		drumEvents: backing.drumEvents.filter(event => event.absBeat <= beat && parseInt(event.time, 10) <= tick),
		bassEvents: [...finishBefore(backing.bassEvents), { absBeat: beat, time, duration,
			midi: 36 + pitchClassToNumber(chord.chord.bass ?? chord.chord.root), velocity: backing.bassEvents.at(-1)?.velocity ?? 76 }],
		compEvents: [...finishBefore(backing.compEvents), { absBeat: beat, time, duration, notes, velocity: backing.compEvents.at(-1)?.velocity ?? 60 }]
	};
}

/** Use the same Musicality arrangement and written rests for live playback and WAV export. */
export function preparePhraseArrangement(
	phrase: Phrase, harmony: HarmonicSegment[], style: StyleDefinition, params: BackingGenerationParams,
	instrument: BackingInstrument, seed: number, melodySwing: number
): GeneratedBacking {
	if (!harmony.length) return { bassEvents: [], compEvents: [], drumEvents: [] };
	const quartersPerBar = quarterBeatsPerBar(phrase.timeSignature);
	const formBars = params.performanceForm?.totalBars ?? (phrase.writtenHarmonyOnly ? phrase.difficulty.lengthBars : 0);
	const planningHarmony = continuousPlanningHarmony(harmony, formBars * quartersPerBar);
	const arranged = prepareReleasedArrangement(planningHarmony, style, params, instrument, phrase.timeSignature[1], seed);
	const fitted = phrase.writtenHarmonyOnly || planningHarmony !== harmony
		? fitBackingToWrittenHarmony(arranged, harmony, params.tempo, params.ppq, phrase.soloBreaks, quartersPerBar)
		: arranged;
	const finalChord = harmony.at(-1)!;
	return finalChord.writtenFine ? playWrittenFine(fitted, phrase, finalChord, params, melodySwing) : fitted;
}

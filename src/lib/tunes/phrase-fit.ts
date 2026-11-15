import { PITCH_CLASSES, type Fraction, type HarmonicSegment, type Phrase, type PitchClass } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { pitchClassInterval } from '$lib/music/transposition';
import { chordEvidence } from '$lib/music/chord-evidence';

/** Inspectable ranking evidence, not a proficiency grade or probability of musical quality. */
export interface PhraseFit {
	/** Weighted chord-tone support, 0–1. Unknown evidence produces no assessment. */
	score: number;
	strongBeatTargets: number;
	strongBeatAttacks: number;
	supportedHeldBeats: number;
	heldBeats: number;
	resolvedApproaches: number;
	approaches: number;
	endingOnChordTone: boolean;
}

const EPSILON = 1e-8;

/** Compound meters use dotted beats; asymmetric meters claim only the downbeat as strong. */
function meterGrid(meter: [number, number]): { beat: number; strong: number[] } | null {
	const [beats, unit] = meter;
	if (!Number.isInteger(beats) || beats <= 0 || ![2, 4, 8, 16].includes(unit)) return null;
	if (unit === 8 && beats >= 6 && beats % 3 === 0) {
		return { beat: 3 / 8, strong: Array.from({ length: beats / 3 }, (_, i) => i * 3 / 8) };
	}
	return { beat: 1 / unit, strong: beats === 4 ? [0, 2 / unit] : [0] };
}

/**
 * Compare a phrase at its authored timing with the actual concert-pitch harmony.
 * Strong attacks count twice, held notes by beat duration, stepwise approaches
 * and the final sounding note once. Unwritten tensions remain eligible: this
 * conservative first rubric rewards concrete support without declaring other
 * notes wrong. Unknown symbols, gaps, overlaps or a phrase beyond the supplied
 * form yield null, rather than inventing chords or wrapping to the first bar.
 */
export function assessPhraseFit(
	phrase: Phrase,
	targetKey: PitchClass,
	insertionOffset: Fraction,
	harmony: readonly HarmonicSegment[],
	meter: [number, number]
): PhraseFit | null {
	const grid = meterGrid(meter);
	if (!grid || phrase.timeSignature[0] !== meter[0] || phrase.timeSignature[1] !== meter[1]) return null;
	const insertion = fractionToFloat(insertionOffset);
	if (!Number.isFinite(insertion) || insertion < 0) return null;
	const shift = pitchClassInterval(phrase.key, targetKey);
	const notes = phrase.notes.filter(n => n.pitch !== null).map(n => ({
		pitch: n.pitch! + shift, start: fractionToFloat(n.offset),
		end: fractionToFloat(n.offset) + fractionToFloat(n.duration), tied: !!n.tied
	})).sort((a, b) => a.start - b.start);
	if (!notes.length || notes.some(n => !Number.isFinite(n.start) || !Number.isFinite(n.end) ||
		n.start < 0 || n.end <= n.start || !Number.isInteger(n.pitch))) return null;
	// Tied continuation is one attack and one held note, including across a chord change.
	const sounding: typeof notes = [];
	for (const note of notes) {
		const previous = sounding.at(-1);
		if (previous && note.start < previous.end - EPSILON) return null;
		if (previous?.tied && previous.pitch === note.pitch && Math.abs(previous.end - note.start) < EPSILON) {
			previous.end = note.end;
			previous.tied = note.tied;
		} else sounding.push({ ...note });
	}
	const chords = harmony.map(segment => ({ start: fractionToFloat(segment.startOffset),
		end: fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration), evidence: chordEvidence(segment) }))
		.sort((a, b) => a.start - b.start);
	if (!chords.length || chords.some((chord, i) => !Number.isFinite(chord.start) || !Number.isFinite(chord.end) ||
		chord.start < 0 || chord.end <= chord.start || (i > 0 && chord.start < chords[i - 1].end - EPSILON))) return null;
	const bar = meter[0] / meter[1];
	const events: { pitch: number; start: number; end: number; strong: boolean; attackSupported: boolean; endingSupported: boolean }[] = [];
	const result: PhraseFit = { score: 0, strongBeatTargets: 0, strongBeatAttacks: 0,
		supportedHeldBeats: 0, heldBeats: 0, resolvedApproaches: 0, approaches: 0, endingOnChordTone: false };
	for (const note of sounding) {
		const start = insertion + note.start;
		const end = insertion + note.end;
		const overlaps = chords.filter(c => c.start < end - EPSILON && c.end > start + EPSILON);
		let cursor = start;
		let supportedDuration = 0;
		const pc = PITCH_CLASSES[((note.pitch % 12) + 12) % 12];
		for (const chord of overlaps) {
			if (!chord.evidence || chord.start > cursor + EPSILON) return null;
			const through = Math.min(chord.end, end);
			if (chord.evidence.pitchClasses.includes(pc)) supportedDuration += through - cursor;
			cursor = through;
		}
		if (cursor < end - EPSILON || !overlaps.length) return null;
		const position = ((start % bar) + bar) % bar;
		const strong = grid.strong.some(at => Math.abs(position - at) < EPSILON || Math.abs(position - at - bar) < EPSILON);
		const attackSupported = overlaps[0].evidence!.pitchClasses.includes(pc);
		const endingSupported = overlaps.at(-1)!.evidence!.pitchClasses.includes(pc);
		if (strong) { result.strongBeatAttacks++; if (attackSupported) result.strongBeatTargets++; }
		if (end - start >= grid.beat - EPSILON) {
			result.heldBeats += (end - start) / grid.beat;
			result.supportedHeldBeats += supportedDuration / grid.beat;
		}
		events.push({ pitch: note.pitch, start, end, strong, attackSupported, endingSupported });
	}
	for (const [index, event] of events.entries()) {
		if (event.strong || event.attackSupported || event.end - event.start >= grid.beat - EPSILON) continue;
		result.approaches++;
		const next = events[index + 1];
		if (next?.attackSupported && Math.abs(event.end - next.start) < EPSILON &&
			Math.abs(next.pitch - event.pitch) >= 1 && Math.abs(next.pitch - event.pitch) <= 2) result.resolvedApproaches++;
	}
	result.endingOnChordTone = events.at(-1)!.endingSupported;
	const support = 2 * result.strongBeatTargets + result.supportedHeldBeats + result.resolvedApproaches + Number(result.endingOnChordTone);
	const weight = 2 * result.strongBeatAttacks + result.heldBeats + result.approaches + 1;
	result.score = Math.round(Math.max(0, Math.min(1, support / weight)) * 1e6) / 1e6;
	return result;
}

/** Missing evidence is neutral, giving the sorter a stable total order even with unknown chords. */
export function comparePhraseFit(a: PhraseFit | null | undefined, b: PhraseFit | null | undefined): number {
	return (b?.score ?? 0.5) - (a?.score ?? 0.5);
}

/** Selected committed keyboard voices may ring into one compatible next bar. */
import type { RollingBackingDefinition } from './backing-rolling';
import type { BarInfo, CompEvent } from './backing-generation';
import { fractionToFloat } from '$lib/music/intervals';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { pitchClassToNumber } from './voicings';
import { createRng, seedFrom } from './generation-rng';

/** Propose a bounded gate from known harmony/form only; never inspect future played notes. */
export function sustainAcrossBar(
	score: RollingBackingDefinition,
	bar: number,
	info: BarInfo,
	events: readonly CompEvent[],
	previousRelease?: number
): CompEvent[] | undefined {
	const current = score.bars[bar];
	const next = score.bars[bar + 1];
	const plan = info.ensemble;
	if (!score.keyboardSustainVersion || !score.keyboardPhrasing || !next || !plan || previousRelease ||
		current.sourceChorusIndex !== next.sourceChorusIndex || current.sourceSectionIndex !== next.sourceSectionIndex ||
		current.loopIndex !== next.loopIndex || (current.phrase4 && current.phrase4.barIndex === current.phrase4.lengthBars - 1) ||
		current.isFinalBar || current.isChorusFinalBar || current.isSectionFinalBar ||
		plan.coordinatedAccent || plan.setupFor || plan.terminalArrangement || plan.responseOwner !== 'nobody' ||
		['active_soloist', 'dense_soloist', 'under_response'].includes(plan.piano.rootlessTexture?.reason ?? '') ||
		!createRng(seedFrom(score.phraseId, current.pianoPresenceSeed ?? 0, bar, 'keyboard-sustain')).chance(.65)) return;

	const event = events.at(-1);
	if (!event || event.brokenTwo || event.balladThird) return;
	const within = event.absBeat - bar * 4;
	const beats = event.duration * score.tempo / 60;
	// Keep detached jabs detached. Ballad pads can support the seam from their earlier attack.
	if ((within < 2 && !(score.style === 'ballad' && beats >= 2.5)) ||
		beats < (score.style === 'bossa-nova' ? .12 : .4)) return;

	const instrument = score.keyboardPhrasing.instrument;
	let tail = score.pianoContinuityVersion ? 1 : score.style === 'bossa-nova' ? (instrument === 'organ' ? .5 : .25)
		: score.style === 'ballad' ? (instrument === 'organ' ? 1 : .65)
			: (instrument === 'organ' ? .8 : .4);
	const boundary = (bar + 1) * 4;
	// A later hit can anticipate the next written harmony by half a beat.
	// Keep the older short carry when fast changes leave no room for the
	// longer gate, including a small margin for the scheduled microtiming.
	if (score.pianoContinuityVersion && score.harmony.some(h => {
		const start = fractionToFloat(h.startOffset) * 4;
		return start > boundary && start < boundary + 1.6;
	})) tail = .4;
	const releaseTick = Math.round((boundary + tail) * score.ppq);
	if (releaseTick <= boundary * score.ppq) return;
	const source = score.harmony.find(h => event.absBeat >= fractionToFloat(h.startOffset) * 4 &&
		event.absBeat < (fractionToFloat(h.startOffset) + fractionToFloat(h.duration)) * 4);
	if (!source) return;
	const overlaps = score.harmony.filter(h => fractionToFloat(h.startOffset) * 4 < releaseTick / score.ppq &&
		(fractionToFloat(h.startOffset) + fractionToFloat(h.duration)) * 4 > event.absBeat);
	const changed = overlaps.some(h => JSON.stringify(h.chord) !== JSON.stringify(source.chord) || h.scaleId !== source.scaleId);
	if (changed) {
		if (score.keyboardSustainVersion !== 2) return;
		// Only a bar-line change: no anticipation through an intervening harmony.
		if (overlaps.some(h => fractionToFloat(h.startOffset) * 4 > event.absBeat && fractionToFloat(h.startOffset) * 4 !== boundary)) return;
		if (!overlaps.some(h => fractionToFloat(h.startOffset) * 4 === boundary && JSON.stringify(h.chord) !== JSON.stringify(source.chord))) return;
		// Only pitches explicitly in both chords; scale membership alone is insufficient.
		const shared = event.notes.filter(midi => overlaps.every(h => CHORD_DEFINITIONS[h.chord.quality].intervals
			.some(interval => (pitchClassToNumber(h.chord.root) + interval) % 12 === midi % 12))).slice(-2);
		const cleared = event.notes.filter(midi => !shared.includes(midi));
		if (!shared.length || !cleared.length) return;
		return [{ ...event, notes: cleared }, { ...event, notes: shared,
			duration: (releaseTick - parseInt(event.time, 10)) * 60 / score.tempo / score.ppq,
			barLineSustain: { version: 2, releaseTick, instrument, originalDuration: event.duration } }];
	}

	return [{
		...event,
		duration: (releaseTick - parseInt(event.time, 10)) * 60 / score.tempo / score.ppq,
		barLineSustain: { version: 1, releaseTick, instrument, originalDuration: event.duration }
	}];
}

/** Check restored carry pitches against both sides of the authored bar line. */
export function commonToneAtBoundary(score: RollingBackingDefinition, bar: number, midi: number): boolean {
 const boundary=bar*4;
 const sides=[boundary-1e-7,boundary].map(beat=>score.harmony.find(h=>fractionToFloat(h.startOffset)*4<=beat && (fractionToFloat(h.startOffset)+fractionToFloat(h.duration))*4>beat));
 return sides.every(h=>h && CHORD_DEFINITIONS[h.chord.quality].intervals.some(i=>(pitchClassToNumber(h.chord.root)+i)%12===midi%12));
}

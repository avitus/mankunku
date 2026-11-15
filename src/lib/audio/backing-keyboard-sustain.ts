/** A committed last chord may ring into one next bar of the same written harmony. */
import type { RollingBackingDefinition } from './backing-rolling';
import type { BarInfo, CompEvent } from './backing-generation';
import { fractionToFloat } from '$lib/music/intervals';
import { createRng, seedFrom } from './generation-rng';

/** Propose a bounded gate from known harmony/form only; never inspect future played notes. */
export function sustainAcrossBar(
	score: RollingBackingDefinition,
	bar: number,
	info: BarInfo,
	events: readonly CompEvent[],
	previousRelease?: number
): CompEvent | undefined {
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
	if (!event) return;
	const within = event.absBeat - bar * 4;
	const beats = event.duration * score.tempo / 60;
	// Keep detached jabs detached. Ballad pads can support the seam from their earlier attack.
	if ((within < 2 && !(score.style === 'ballad' && beats >= 2.5)) ||
		beats < (score.style === 'bossa-nova' ? .12 : .4)) return;

	const instrument = score.keyboardPhrasing.instrument;
	const tail = score.style === 'bossa-nova' ? (instrument === 'organ' ? .5 : .25)
		: score.style === 'ballad' ? (instrument === 'organ' ? 1 : .65)
			: (instrument === 'organ' ? .8 : .4);
	const boundary = (bar + 1) * 4;
	const releaseTick = Math.round((boundary + tail) * score.ppq);
	const source = score.harmony.find(h => event.absBeat >= fractionToFloat(h.startOffset) * 4 &&
		event.absBeat < (fractionToFloat(h.startOffset) + fractionToFloat(h.duration)) * 4);
	if (!source) return;
	const overlaps = score.harmony.filter(h => fractionToFloat(h.startOffset) * 4 < releaseTick / score.ppq &&
		(fractionToFloat(h.startOffset) + fractionToFloat(h.duration)) * 4 > event.absBeat);
	if (overlaps.some(h => JSON.stringify(h.chord) !== JSON.stringify(source.chord) || h.scaleId !== source.scaleId)) return;

	return {
		...event,
		duration: (releaseTick - parseInt(event.time, 10)) * 60 / score.tempo / score.ppq,
		barLineSustain: { version: 1, releaseTick, instrument, originalDuration: event.duration }
	};
}

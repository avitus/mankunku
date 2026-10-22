import type { Fraction, HarmonicSegment, Phrase } from '$lib/types/music';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	multiplyFraction,
	subtractFractions
} from '$lib/music/intervals';

/**
 * Looping a form the way a band does: bar 1 comes back on the beat after the
 * last bar, and a pickup plays once, on the way in (2026-10-22). The region is
 * in PRINTED bars of the phrase timeline: `startBar` is the form's first full
 * bar (1 after a pickup bar, else 0), `endBar` the bar after its last.
 *
 * One continuous transport carries every pass: the intro (everything before
 * `startBar`) is a plain Part, the form a looping Part, and the backing loops
 * on the form's harmony alone. Re-running the phrase per pass, as the tune
 * desk first did, stopped the transport, played a fresh silent lead-in bar,
 * waited a beat after the last bar and replayed the pickup bar every time.
 */
export interface LoopRegion {
	startBar: number;
	endBar: number;
}

/** The fields of a scheduled melody event this module reads and rewrites. */
export interface LoopEvent {
	sourceIndex: number;
	ticks: number;
	time: string;
}

type ToneModule = typeof import('tone');
type Transport = ReturnType<ToneModule['getTransport']>;
type Context = InstanceType<ToneModule['Context']>;

/** One printed bar of the meter, in whole notes. */
function barWholeNotes(phrase: Phrase): Fraction {
	return [phrase.timeSignature[0], phrase.timeSignature[1]];
}

/** Transport ticks in one printed bar (a 6/8 bar is three quarters, not six). */
export function printedBarTicks(timeSignature: [number, number], ppq: number): number {
	return Math.round((timeSignature[0] * 4 * ppq) / timeSignature[1]);
}

/**
 * Split a phrase's events into the intro, played once, and the form, rebased
 * onto the form's first bar. A note belongs to the form by its WRITTEN offset:
 * humanized timing can put bar 1's downbeat a few ticks early, and that note
 * must still come back every pass. Form ticks are clamped into the loop
 * because Tone's looping Part cancels every event outside [loopStart, loopEnd).
 */
export function splitLoopEvents<E extends LoopEvent>(
	events: readonly E[],
	phrase: Phrase,
	region: LoopRegion,
	ppq: number
): { intro: E[]; body: E[] } {
	const bar = fractionToFloat(barWholeNotes(phrase));
	const barTicks = printedBarTicks(phrase.timeSignature, ppq);
	const startTick = region.startBar * barTicks;
	const loopTicks = (region.endBar - region.startBar) * barTicks;
	const intro: E[] = [];
	const body: E[] = [];
	for (const event of events) {
		const note = phrase.notes[event.sourceIndex];
		const writtenBar = note ? fractionToFloat(note.offset) / bar : event.ticks / barTicks;
		if (writtenBar < region.startBar - 1e-9) {
			intro.push(event);
			continue;
		}
		const ticks = Math.min(loopTicks - 1, Math.max(0, event.ticks - startTick));
		body.push({ ...event, ticks, time: `${ticks}i` });
	}
	return { intro, body };
}

/**
 * The form alone as a phrase, for the backing track: notes and chords inside
 * the region, re-origined on its first bar, the last chord stretched to the
 * form's end (the backing loops on its harmony's length, so a chart whose
 * chords stop short would bring the band back early), and the section map
 * rebased so section-final drum setups still land.
 */
export function loopBodyPhrase(phrase: Phrase, region: LoopRegion): Phrase {
	const barLength = barWholeNotes(phrase);
	const start = multiplyFraction(barLength, region.startBar);
	const end = multiplyFraction(barLength, region.endBar);
	const inForm = (offset: Fraction): boolean =>
		compareFractions(offset, start) >= 0 && compareFractions(offset, end) < 0;

	const notes = phrase.notes
		.filter((n) => inForm(n.offset))
		.map((n) => ({ ...n, offset: subtractFractions(n.offset, start) }));

	const harmony: HarmonicSegment[] = [];
	for (const seg of phrase.harmony) {
		const segEnd = addFractions(seg.startOffset, seg.duration);
		if (compareFractions(segEnd, start) <= 0 || compareFractions(seg.startOffset, end) >= 0) continue;
		const from = compareFractions(seg.startOffset, start) < 0 ? start : seg.startOffset;
		const to = compareFractions(segEnd, end) > 0 ? end : segEnd;
		harmony.push({
			...seg,
			chord: { ...seg.chord },
			startOffset: subtractFractions(from, start),
			duration: subtractFractions(to, from)
		});
	}
	const formLength = subtractFractions(end, start);
	const last = harmony[harmony.length - 1];
	if (last) last.duration = subtractFractions(formLength, last.startOffset);

	const map = phrase.sectionMap ?? [];
	const sectionMap = map
		.filter((entry, i) => {
			const next = map[i + 1]?.barOffset ?? Infinity;
			return next > region.startBar && entry.barOffset < region.endBar;
		})
		.map((entry) => ({ ...entry, barOffset: Math.max(0, entry.barOffset - region.startBar) }));

	return {
		...phrase,
		id: `${phrase.id}:form-${region.startBar}-${region.endBar}`,
		notes,
		harmony,
		sectionMap
	};
}

/** The phrase bar a looping playback is in, wrapping past the end to bar `startBar`. */
export function loopPlaybackBar(bar: number, region: LoopRegion): number {
	if (bar < region.endBar) return bar;
	const length = region.endBar - region.startBar;
	return length > 0 ? region.startBar + ((bar - region.startBar) % length) : bar;
}

/**
 * Schedule the melody's intro and looping form on a running transport, plus
 * the per-pass decision. One tick before each return to the top it asks
 * `shouldContinue`; on a no, the form Part is muted from the top onward and
 * `onLastPass` gets the tick the last pass ends on, so the caller can mute
 * its backing and let the final notes ring before stopping. Deciding a tick
 * early is what makes the mute exact: Tone dispatches ticks in order.
 */
export function scheduleFormLoop<E extends LoopEvent>(args: {
	Tone: ToneModule;
	/** Tone's default context unless given (the headless tests use their own). */
	context?: Context;
	transport: Transport;
	intro: E[];
	body: E[];
	introStartTick: number;
	bodyStartTick: number;
	loopTicks: number;
	play: (time: number, event: E) => void;
	shouldContinue: () => boolean;
	onLastPass: (endTick: number) => void;
}): { parts: import('tone').Part<E>[]; decisionId: number } {
	const { Tone, context, transport, loopTicks, bodyStartTick } = args;
	/** A Part on the caller's context, firing `play` for each of `events`. */
	const part = (events: E[]): import('tone').Part<E> =>
		new Tone.Part<E>({ ...(context ? { context } : {}), callback: (time, event) => args.play(time, event as E), events });

	const parts: import('tone').Part<E>[] = [];
	if (args.intro.length > 0) {
		const intro = part(args.intro);
		intro.start(`${args.introStartTick}i`);
		parts.push(intro);
	}
	let body: import('tone').Part<E> | null = null;
	if (args.body.length > 0) {
		body = part(args.body);
		body.loop = true;
		body.loopStart = 0;
		body.loopEnd = `${loopTicks}i`;
		body.start(`${bodyStartTick}i`);
		parts.push(body);
	}

	let passEnd = bodyStartTick + loopTicks;
	const decisionId = transport.scheduleRepeat(
		() => {
			const endTick = passEnd;
			passEnd += loopTicks;
			if (args.shouldContinue()) return;
			transport.clear(decisionId);
			if (body) body.mute = true;
			args.onLastPass(endTick);
		},
		`${loopTicks}i`,
		`${bodyStartTick + loopTicks - 1}i`
	);
	return { parts, decisionId };
}

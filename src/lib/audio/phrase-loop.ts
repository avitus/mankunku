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
 * bar (1 after a pickup bar, else 0), `endBar` the bar after its last. An
 * optional `coda` is the way out — on a whole-tune repeat, A + second ending,
 * while the loop goes round A + first ending — played once, from the top at
 * which the loop is declined, instead of another pass.
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
	coda?: { startBar: number; endBar: number };
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
 * Split a phrase's events into the intro, played once, the form, rebased
 * onto the form's first bar, and the coda, rebased onto its own. A note goes
 * by its WRITTEN offset: humanized timing can put bar 1's downbeat a few
 * ticks early, and that note must still come back every pass. Form ticks are
 * clamped into the loop because Tone's looping Part cancels every event
 * outside [loopStart, loopEnd). Anything between the form and the coda (a
 * pickup the repeat replays) or past the coda is played by neither.
 */
export function splitLoopEvents<E extends LoopEvent>(
	events: readonly E[],
	phrase: Phrase,
	region: LoopRegion,
	ppq: number
): { intro: E[]; body: E[]; coda: E[] } {
	const bar = fractionToFloat(barWholeNotes(phrase));
	const barTicks = printedBarTicks(phrase.timeSignature, ppq);
	const startTick = region.startBar * barTicks;
	const loopTicks = (region.endBar - region.startBar) * barTicks;
	const intro: E[] = [];
	const body: E[] = [];
	const coda: E[] = [];
	/** The event moved to `fromTick`, kept inside a section `lengthTicks` long. */
	const rebase = (event: E, fromTick: number, lengthTicks: number): E => {
		const ticks = Math.min(lengthTicks - 1, Math.max(0, event.ticks - fromTick));
		return { ...event, ticks, time: `${ticks}i` };
	};
	for (const event of events) {
		const note = phrase.notes[event.sourceIndex];
		const writtenBar = note ? fractionToFloat(note.offset) / bar : event.ticks / barTicks;
		const before = (b: number): boolean => writtenBar < b - 1e-9;
		if (before(region.startBar)) intro.push(event);
		else if (before(region.endBar)) body.push(rebase(event, startTick, loopTicks));
		else if (region.coda && !before(region.coda.startBar) && before(region.coda.endBar)) {
			const { startBar, endBar } = region.coda;
			coda.push(rebase(event, startBar * barTicks, (endBar - startBar) * barTicks));
		}
	}
	return { intro, body, coda };
}

/**
 * The form alone as a phrase, for the backing track: notes and chords inside
 * the region, re-origined on its first bar, the last chord stretched to the
 * form's end (the backing loops on its harmony's length, so a chart whose
 * chords stop short would bring the band back early), and the section map
 * rebased so section-final drum setups still land.
 */
export function loopBodyPhrase(phrase: Phrase, region: LoopRegion): Phrase {
	return phraseSection(phrase, region.startBar, region.endBar);
}

/** The way-out pass as a phrase for the backing (see loopBodyPhrase); null without one. */
export function codaPhrase(phrase: Phrase, region: LoopRegion): Phrase | null {
	return region.coda ? phraseSection(phrase, region.coda.startBar, region.coda.endBar) : null;
}

/** Bars `startBar`..`endBar` of a phrase, re-origined, the last chord reaching the end. */
function phraseSection(phrase: Phrase, startBar: number, endBar: number): Phrase {
	const region = { startBar, endBar };
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

/**
 * The phrase bar a looping playback is in, given the bars played since the
 * form began (`bar`) and how many returns to the top were taken: past the
 * last bar it wraps to `startBar`, and once the returns are used up it is in
 * the coda (or past the end, without one).
 */
export function loopPlaybackBar(bar: number, region: LoopRegion, returns: number): number {
	if (bar < region.endBar) return bar;
	const length = region.endBar - region.startBar;
	if (length <= 0) return bar;
	const after = bar - region.endBar;
	if (after < returns * length) return region.startBar + (after % length);
	return (region.coda?.startBar ?? region.endBar) + after - returns * length;
}

/**
 * Schedule the melody's intro and looping form on a running transport, plus
 * the per-pass decision. One tick before each return to the top it asks
 * `shouldContinue`; on a no, the form Part is muted from the top onward, the
 * coda Part (if any) starts AT that top, and `onLastPass` gets the top and
 * the tick the music ends on, so the caller can hand its backing over the
 * same way and let the final notes ring before stopping. Deciding a tick
 * early is what makes both exact: Tone dispatches ticks in order, so a Part
 * started in the callback for tick T - 1 is on the timeline before T.
 */
export function scheduleFormLoop<E extends LoopEvent>(args: {
	Tone: ToneModule;
	/** Tone's default context unless given (the headless tests use their own). */
	context?: Context;
	transport: Transport;
	intro: E[];
	body: E[];
	/** The way-out pass, rebased onto its first bar; empty without one. */
	coda: E[];
	introStartTick: number;
	bodyStartTick: number;
	loopTicks: number;
	codaTicks: number;
	play: (time: number, event: E) => void;
	shouldContinue: () => boolean;
	onLastPass: (pass: { codaStartTick: number; endTick: number }) => void;
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
			if (args.coda.length > 0) {
				const coda = part(args.coda);
				coda.start(`${endTick}i`);
				parts.push(coda);
			}
			args.onLastPass({ codaStartTick: endTick, endTick: endTick + args.codaTicks });
		},
		`${loopTicks}i`,
		`${bodyStartTick + loopTicks - 1}i`
	);
	return { parts, decisionId };
}

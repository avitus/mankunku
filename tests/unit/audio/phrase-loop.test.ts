import { describe, expect, it } from 'vitest';
import type { Phrase } from '$lib/types/music';
import { createHeadlessTransport } from '../../helpers/headless-tone';
import { guardTickRedelivery } from '$lib/audio/tick-redelivery';
import {
	loopBodyPhrase,
	loopPlaybackBar,
	scheduleFormLoop,
	splitLoopEvents,
	type LoopEvent
} from '$lib/audio/phrase-loop';

/**
 * Looping a tune the way a band does (2026-10-22): the form comes back to
 * bar 1 on the beat after its last bar, and a pickup is played once, on the
 * way in. The tune desk used to re-run the whole phrase per pass, which
 * stopped the transport, played a fresh silent lead-in bar, waited a beat
 * after the last bar and replayed the pickup bar every time.
 */

const PPQ = 192;
const BAR = 4 * PPQ;

/** A 4/4 tune: a one-beat pickup bar, then a two-bar form (C on 1, D on 3 of bar 2). */
function pickupPhrase(): Phrase {
	return {
		id: 'song', name: 'Song', timeSignature: [4, 4], key: 'C',
		notes: [
			{ pitch: null, offset: [0, 1], duration: [3, 4] },
			{ pitch: 67, offset: [3, 4], duration: [1, 4] },
			{ pitch: 60, offset: [1, 1], duration: [1, 1] },
			{ pitch: 62, offset: [5, 2], duration: [1, 2] }
		],
		harmony: [
			{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [1, 1] },
			{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [2, 1], duration: [1, 2] }
		],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 3 },
		category: 'user', tags: [], source: 'tune',
		sectionMap: [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 1, barOffset: 1 }]
	};
}

/** A minimal event at a form-relative tick, carrying the note it sounds. */
function ev(sourceIndex: number, ticks: number): LoopEvent {
	return { sourceIndex, ticks, time: `${ticks}i` };
}

describe('splitLoopEvents', () => {
	it('plays the pickup once and rebases the form onto its first bar', () => {
		const { intro, body } = splitLoopEvents(
			[ev(1, 3 * PPQ), ev(2, BAR), ev(3, BAR + 6 * PPQ)],
			pickupPhrase(), { startBar: 1, endBar: 3 }, PPQ
		);
		expect(intro.map((e) => e.sourceIndex)).toEqual([1]);
		expect(body.map((e) => [e.sourceIndex, e.ticks, e.time])).toEqual([[2, 0, '0i'], [3, 6 * PPQ, `${6 * PPQ}i`]]);
	});

	// Humanized timing can put bar 1's downbeat a few ticks early. Tone's
	// looping Part cancels any event before loopStart, so a negative offset
	// would silence the form's first note on every pass.
	it('keeps a humanized-early downbeat inside the loop', () => {
		const { intro, body } = splitLoopEvents(
			[ev(2, BAR - 3), ev(3, 3 * BAR + 2)], pickupPhrase(), { startBar: 1, endBar: 3 }, PPQ
		);
		expect(intro).toEqual([]);
		expect(body.map((e) => e.ticks)).toEqual([0, 2 * BAR - 1]);
	});

	it('measures bars in the printed meter, not quarter-note beats', () => {
		const sixEight: Phrase = { ...pickupPhrase(), timeSignature: [6, 8] };
		// One 6/8 bar = 3 quarters; note 2 sits at whole-note offset 1 = bar 1⅓.
		const { body } = splitLoopEvents([ev(2, 4 * PPQ)], sixEight, { startBar: 1, endBar: 4 }, PPQ);
		expect(body[0].ticks).toBe(PPQ);
	});
});

describe('loopBodyPhrase', () => {
	it('keeps only the form, re-origined on its first bar, with its own id', () => {
		const body = loopBodyPhrase(pickupPhrase(), { startBar: 1, endBar: 3 });
		expect(body.id).not.toBe('song');
		expect(body.notes.map((n) => [n.pitch, n.offset])).toEqual([[60, [0, 1]], [62, [3, 2]]]);
		expect(body.harmony.map((h) => [h.chord.root, h.startOffset])).toEqual([['C', [0, 1]], ['G', [1, 1]]]);
		expect(body.sectionMap).toEqual([{ sourceSection: 1, barOffset: 0 }]);
	});

	// The backing loops on its harmony's length, so harmony that stops short
	// of the last bar would bring the band back to the top before the melody.
	it('stretches the last chord to the end of the form', () => {
		const body = loopBodyPhrase(pickupPhrase(), { startBar: 1, endBar: 3 });
		const last = body.harmony[body.harmony.length - 1];
		expect(last.duration).toEqual([1, 1]);
	});

	it('keeps the section that opens on a pickup bar as the form\'s first', () => {
		const labelled: Phrase = { ...pickupPhrase(), sectionMap: [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 1, barOffset: 2 }] };
		expect(loopBodyPhrase(labelled, { startBar: 1, endBar: 3 }).sectionMap).toEqual([
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 1 }
		]);
	});
});

describe('loopPlaybackBar', () => {
	it('wraps past the last bar to the first bar of the form, skipping the pickup', () => {
		expect(loopPlaybackBar(0.5, { startBar: 1, endBar: 3 })).toBe(0.5);
		expect(loopPlaybackBar(2.5, { startBar: 1, endBar: 3 })).toBe(2.5);
		expect(loopPlaybackBar(3.25, { startBar: 1, endBar: 3 })).toBe(1.25);
		expect(loopPlaybackBar(5.5, { startBar: 1, endBar: 3 })).toBe(1.5);
	});
});

describe('scheduleFormLoop (real Tone clock)', () => {
	const BPM = 240;

	/** Run a looped form until `passes` passes have been allowed, recording every delivery. */
	async function runLoop(passes: number) {
		const h = await createHeadlessTransport({ sampleRate: 48000, bpm: BPM, startQuantum: 1 });
		guardTickRedelivery(h.transport);
		const heard: [number, number][] = [];
		let decisions = 0;
		let lastPassEnd: number | null = null;
		const leadIn = BAR;
		scheduleFormLoop({
			Tone: h.Tone,
			context: h.context,
			transport: h.transport,
			intro: [ev(1, 3 * PPQ)],
			body: [ev(2, 0), ev(3, 6 * PPQ)],
			introStartTick: leadIn,
			bodyStartTick: leadIn + BAR,
			loopTicks: 2 * BAR,
			play: (time, event) => heard.push([event.sourceIndex, Math.round(h.transport.getTicksAtTime(time))]),
			shouldContinue: () => ++decisions < passes,
			onLastPass: (endTick) => { lastPassEnd = endTick; }
		});
		h.transport.start(h.context.now());
		h.run(((1 + 1 + 2 * (passes + 1)) * 4 * 60) / BPM);
		return { heard, lastPassEnd, decisions };
	}

	it('returns to bar 1 on the beat after the last bar, every pass, with the pickup played once', async () => {
		const { heard, lastPassEnd, decisions } = await runLoop(3);
		const body = BAR + BAR;
		expect(heard).toEqual([
			[1, BAR + 3 * PPQ],
			[2, body], [3, body + 6 * PPQ],
			[2, body + 2 * BAR], [3, body + 2 * BAR + 6 * PPQ],
			[2, body + 4 * BAR], [3, body + 4 * BAR + 6 * PPQ]
		]);
		expect(decisions).toBe(3);
		expect(lastPassEnd).toBe(body + 6 * BAR);
	});

	it('plays the form once when looping is off', async () => {
		const { heard, lastPassEnd } = await runLoop(1);
		expect(heard.map(([i]) => i)).toEqual([1, 2, 3]);
		expect(lastPassEnd).toBe(4 * BAR);
	});
});

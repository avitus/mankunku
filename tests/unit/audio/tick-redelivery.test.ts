import { describe, it, expect } from 'vitest';
import { createHeadlessTransport, type HeadlessTransport } from '../../helpers/headless-tone';
import { guardTickRedelivery } from '$lib/audio/tick-redelivery';

/**
 * Tone's clock can hand ONE transport tick to two consecutive passes (found
 * 2026-10-01, when the metronome ride threw on a beat it was started on
 * twice). Each pass covers [previous end, currentTime + lookAhead) and walks
 * it by adding tick durations; a pass that ends exactly on a tick holds it,
 * and the next pass, recomputing from its own start, holds it again. Any
 * transport event that is not a once-event then fires twice: a melody note's
 * attack doubles, a backing hit doubles, a synth start throws.
 *
 * These tests run Tone's REAL Transport/Clock/TickSource (see headless-tone),
 * because the bug lives in what the clock delivers, which a mocked Tone can
 * never show. 48 kHz at 240 BPM from the first render quantum re-delivers
 * beat 4's tick; the arithmetic is deterministic, so so is the test.
 */

const BPM = 240;
const BEATS = 16;
const PPQ = 192;

async function headless(): Promise<HeadlessTransport> {
	return createHeadlessTransport({ sampleRate: 48000, bpm: BPM, startQuantum: 1 });
}

function play(h: HeadlessTransport): void {
	h.transport.start(h.context.now());
	h.run((BEATS * 60) / BPM + 0.5);
}

function tally(counts: Map<number, number>, key: number): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** A non-looping Part with one event per beat, as the melody and backing Parts are built. */
function beatPart(h: HeadlessTransport, counts: Map<number, number>): void {
	const events = Array.from({ length: BEATS }, (_, beat) => ({ time: `${beat * PPQ}i`, beat }));
	new h.Tone.Part<{ time: string; beat: number }>({
		context: h.context,
		callback: (_time, event) => tally(counts, event.beat),
		events
	}).start(0);
}

function doubled(counts: Map<number, number>): number[] {
	return [...counts].filter(([, n]) => n > 1).map(([beat]) => beat);
}

describe('Tone tick re-delivery (real Tone clock)', () => {
	it('unguarded, Tone fires a non-looping Part event twice when a pass ends on its tick', async () => {
		// Pins Tone's behaviour, not ours: if an upgrade stops re-delivering,
		// this fails and the guard can be reconsidered.
		const h = await headless();
		const counts = new Map<number, number>();
		beatPart(h, counts);
		play(h);
		expect(doubled(counts)).toContain(4);
	});

	it('guarded, a non-looping Part plays every beat exactly once', async () => {
		const h = await headless();
		guardTickRedelivery(h.transport);
		const counts = new Map<number, number>();
		beatPart(h, counts);
		play(h);
		expect(counts.size).toBe(BEATS);
		expect(doubled(counts)).toEqual([]);
	});

	it('guarded, transport.schedule fires once on a re-delivered tick', async () => {
		const h = await headless();
		guardTickRedelivery(h.transport);
		const counts = new Map<number, number>();
		for (let beat = 0; beat < BEATS; beat++) {
			h.transport.schedule(() => tally(counts, beat), `${beat * PPQ}i`);
		}
		play(h);
		expect(counts.size).toBe(BEATS);
		expect(doubled(counts)).toEqual([]);
	});

	it('guarded, simultaneous events on one tick all still fire — chord tones, kick + ride', async () => {
		// The guard drops a repeated TICK, never a repeated time: three events
		// sharing every beat are three sounds, each once.
		const h = await headless();
		guardTickRedelivery(h.transport);
		const counts = new Map<number, number>();
		const events = Array.from({ length: BEATS * 3 }, (_, i) => ({
			time: `${Math.floor(i / 3) * PPQ}i`,
			id: i
		}));
		new h.Tone.Part<{ time: string; id: number }>({
			context: h.context,
			callback: (_time, event) => tally(counts, event.id),
			events
		}).start(0);
		play(h);
		expect(counts.size).toBe(BEATS * 3);
		expect(doubled(counts)).toEqual([]);
	});

	/**
	 * Expected failure, pinned: the loop wrap renumbers the tick. Tone hands
	 * over loopEnd and rewrites it to loopStart, so a re-delivery of that
	 * instant comes back as loopStart and the guard, matching the previous
	 * tick's number, lets it through. A time-only key would catch it but drops
	 * the restarted downbeat below, and at the clock the two are the same
	 * (time, ticks) pair. The app never loops the transport (Parts loop, which
	 * is immune); whoever turns `transport.loop` on owns this.
	 */
	it.fails('guarded, a looping transport plays its loop-start events once per pass (OPEN)', async () => {
		const h = await headless();
		guardTickRedelivery(h.transport);
		const downbeats: number[] = [];
		h.transport.schedule((time) => downbeats.push(time), 0);
		h.transport.loop = true;
		h.transport.loopStart = 0;
		h.transport.loopEnd = '1m';
		h.transport.start(h.context.now());
		h.run(4.6);
		const gaps = downbeats.slice(1).map((time, i) => time - downbeats[i]);
		expect(downbeats.length).toBeGreaterThanOrEqual(4);
		for (const gap of gaps) expect(gap).toBeCloseTo((4 * 60) / BPM, 6);
	});

	it('guarded, a stop and restart at the same instant plays tick 0 again', async () => {
		// Tick numbers legitimately repeat after a stop, and here the restart is
		// at the very instant beat 4's tick was played: the stop lands on the end
		// of the pass that just delivered it. A time-only guard drops this
		// downbeat; only the tick number tells the two apart.
		const h = await headless();
		guardTickRedelivery(h.transport);
		let downbeats = 0;
		h.transport.schedule(() => downbeats++, 0);
		h.transport.start(h.context.now());
		h.run(1);
		h.transport.stop(h.context.now());
		h.transport.start(h.context.now());
		h.run(1);
		expect(downbeats).toBe(2);
	});

	it('unguarded, scheduleRepeat and a looping Part are immune — each occurrence is a once-event', async () => {
		// Why the guard is not needed for them, and why the doubled beat must be
		// a NON-looping event: TransportRepeatEvent books every occurrence with
		// scheduleOnce, which removes itself when it fires, so the second pass
		// finds nothing on the tick. A looping Part/Sequence schedules through
		// scheduleRepeat.
		const h = await headless();
		const repeat = new Map<number, number>();
		const loop = new Map<number, number>();
		const beatAt = (time: number): number => Math.round(h.transport.getTicksAtTime(time) / PPQ);
		h.transport.scheduleRepeat((time) => tally(repeat, beatAt(time)), '4n', 0);
		const part = new h.Tone.Part<{ time: number }>({
			context: h.context,
			callback: (time) => tally(loop, beatAt(time)),
			events: [{ time: 0 }]
		});
		part.loop = true;
		part.loopEnd = '4n';
		part.start(0);
		play(h);
		expect(repeat.size).toBeGreaterThanOrEqual(BEATS);
		expect(doubled(repeat)).toEqual([]);
		expect(loop.size).toBeGreaterThanOrEqual(BEATS);
		expect(doubled(loop)).toEqual([]);
	});

	it('does nothing to a transport without the clock it expects', () => {
		// Production never throws over this: an upgrade that moves Tone's clock
		// is caught by the tests above, not by a user's silent session.
		expect(() => guardTickRedelivery({})).not.toThrow();
	});
});

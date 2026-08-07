import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Phrase, HarmonicSegment, Note } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';

/**
 * The backing track must cover the whole phrase.
 *
 * Bass, comp and drum lengths were all derived from the HARMONY duration
 * alone. When a melody outruns its harmony the backing stopped short and the
 * phrase's final bar played dry — `ballad-005` (melody 12 beats, harmony 8)
 * and `ballad-006` (8.5 vs 8) in the curated catalog.
 *
 * Lick practice never hit this because it extends the harmony tail itself
 * before scheduling; the ear-training path did not.
 */

interface Recorded {
	kind: 'part' | 'sequence';
	events: unknown[];
	started: boolean;
}

const recorded: Recorded[] = [];

function record(kind: 'part' | 'sequence', events: unknown[]) {
	const r: Recorded = { kind, events, started: false };
	recorded.push(r);
	return {
		start() {
			r.started = true;
			return this;
		},
		stop() {
			return this;
		},
		dispose() {
			return this;
		},
		loop: false,
		loopStart: 0,
		loopEnd: 0
	};
}

vi.mock('tone', () => ({
	Part: class {
		constructor(_cb: unknown, events: unknown[]) {
			return record('part', events) as unknown as never;
		}
	},
	Sequence: class {
		constructor(_cb: unknown, events: unknown[], _sub: unknown) {
			return record('sequence', events) as unknown as never;
		}
	},
	getTransport: () => ({ PPQ: 480 })
}));

class FakeInstrument {
	load = Promise.resolve();
	start = vi.fn();
	stop = vi.fn();
	disconnect = vi.fn();
}

vi.mock('smplr', () => ({
	Sampler: class extends FakeInstrument {},
	Smolken: class extends FakeInstrument {},
	SplendidGrandPiano: class extends FakeInstrument {},
	Soundfont: class extends FakeInstrument {},
	CacheStorage: class {}
}));

function fakeGain() {
	return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
}

vi.mock('$lib/audio/audio-context', async () => {
	const { fakeAudioContext } = await import('../../helpers/fake-audio-context');
	return {
		initAudio: async () => fakeAudioContext(),
		getAudioContext: () => fakeAudioContext(),
		getMasterGain: () => fakeGain()
	};
});

// ── Fixture: 3 bars of melody over 2 bars of harmony (the ballad-005 shape) ──

// Fractions are in WHOLE notes: [1,1] is a semibreve — one 4/4 bar — and
// [1,4] a quarter note. So a one-bar chord is [1,1], not [1,4].
const HARMONY_2_BARS: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 1] // bar 1
	},
	{
		chord: { root: 'F', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [1, 1],
		duration: [1, 1] // bar 2 → harmony ends at 2 bars
	}
];

/** Quarter notes running to the end of bar 3. */
const MELODY_3_BARS: Note[] = Array.from({ length: 12 }, (_, i) => ({
	pitch: 60 + (i % 5),
	duration: [1, 4] as [number, number],
	offset: [i, 4] as [number, number]
}));

const PHRASE: Phrase = {
	id: 'coverage-probe',
	name: 'Melody Outruns Harmony',
	timeSignature: [4, 4],
	key: 'C',
	notes: MELODY_3_BARS,
	harmony: HARMONY_2_BARS,
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 3 },
	category: 'ballad',
	tags: [],
	source: 'user-entered'
};

const OPTIONS = {
	tempo: 120,
	swing: 0,
	countInBeats: 0,
	backingTrackEnabled: true,
	backingStyle: 'swing',
	backingInstrument: 'piano',
	backingTrackVolume: 0.5
} as PlaybackOptions;

const PPQ = 480;
const BEATS_PER_BAR = 4;

/** Latest tick any event in a Part is scheduled at. */
function lastEventTick(events: unknown[]): number {
	let max = 0;
	for (const e of events as Array<{ time: string }>) {
		const ticks = Number(String(e.time).replace('i', ''));
		if (Number.isFinite(ticks)) max = Math.max(max, ticks);
	}
	return max;
}

interface DrumEventLike {
	drum?: string;
	absBeat?: number;
}

/** Drums are the Part whose events carry a `drum` voice (bass/comp carry midi). */
function findDrums(): Recorded | undefined {
	return recorded.find(
		(r) => r.kind === 'part' && (r.events[0] as DrumEventLike | undefined)?.drum !== undefined
	);
}

/** Distinct integer beats carrying a ride hit — the quarter-note pulse. */
function rideBeats(events: unknown[]): Set<number> {
	const beats = new Set<number>();
	for (const e of events as DrumEventLike[]) {
		if (e.drum === 'ride' && e.absBeat !== undefined && Number.isInteger(e.absBeat)) {
			beats.add(e.absBeat);
		}
	}
	return beats;
}

describe('backing track covers the full phrase', () => {
	beforeEach(() => {
		vi.resetModules();
		recorded.length = 0;
	});

	it('schedules drums for every bar of the melody, not just the harmony', async () => {
		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');
		await mod.scheduleBackingTrack(PHRASE, OPTIONS, PPQ * BEATS_PER_BAR, false, () => true);

		const drums = findDrums();
		expect(drums).toBeDefined();
		// Ride pulse on all 3 bars × 4 beats. Harmony alone would have given 8.
		expect(rideBeats(drums!.events)).toEqual(new Set(Array.from({ length: 12 }, (_, i) => i)));
	});

	it('carries bass and comp into the final bar', async () => {
		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');
		await mod.scheduleBackingTrack(PHRASE, OPTIONS, PPQ * BEATS_PER_BAR, false, () => true);

		const [bass, comp] = recorded.filter((r) => r.kind === 'part');
		const bar3Start = 2 * BEATS_PER_BAR * PPQ;

		expect(lastEventTick(bass.events)).toBeGreaterThanOrEqual(bar3Start);
		expect(lastEventTick(comp.events)).toBeGreaterThanOrEqual(bar3Start);
	});

	it.each([
		['ballad-005', 3],
		['ballad-006', 3]
	])('covers every bar of the real %s, which outruns its harmony', async (id, bars) => {
		const { ALL_CURATED_LICKS } = await import('$lib/data/licks');
		const lick = ALL_CURATED_LICKS.find((l) => l.id === id);
		expect(lick, `${id} missing from the catalog`).toBeDefined();

		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');
		await mod.scheduleBackingTrack(lick!, OPTIONS, PPQ * BEATS_PER_BAR, false, () => true);

		const drums = findDrums();
		expect(rideBeats(drums!.events).size).toBe(bars * lick!.timeSignature[0]);
	});

	it('leaves a phrase whose harmony already covers the melody unchanged', async () => {
		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');

		const shortMelody: Phrase = { ...PHRASE, notes: MELODY_3_BARS.slice(0, 8) };
		await mod.scheduleBackingTrack(shortMelody, OPTIONS, PPQ * BEATS_PER_BAR, false, () => true);

		const drums = findDrums();
		// 2 bars, no spurious extension.
		expect(rideBeats(drums!.events)).toEqual(new Set(Array.from({ length: 8 }, (_, i) => i)));
	});
});

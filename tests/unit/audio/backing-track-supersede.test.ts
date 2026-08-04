import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';

/**
 * Supersession safety for `scheduleBackingTrack`.
 *
 * The function has an `isStillCurrent()` bailout because a newer schedule can
 * take over while it is awaiting. The invariant that matters is that the bailout
 * is ATOMIC with respect to audible output: if a schedule is superseded, it must
 * not have started ANY part. Bass and comp used to be created *and started*
 * before `await ensureDrums()`, so a supersession during the drum await left
 * them playing with no drums — audible bass and comp over silence.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

/** Every Part/Sequence the module constructs, so we can inspect start() calls. */
interface FakePart {
	kind: 'part' | 'sequence';
	started: boolean;
	disposed: boolean;
	loop: boolean;
	start: (when?: unknown) => FakePart;
	stop: () => FakePart;
	dispose: () => FakePart;
}

const parts: FakePart[] = [];

function makePart(kind: 'part' | 'sequence'): FakePart {
	const p: FakePart = {
		kind,
		started: false,
		disposed: false,
		loop: false,
		start(_when?: unknown) {
			p.started = true;
			return p;
		},
		stop() {
			return p;
		},
		dispose() {
			p.disposed = true;
			return p;
		}
	};
	parts.push(p);
	return p;
}

vi.mock('tone', () => ({
	Part: class {
		constructor(_cb: unknown, _events: unknown) {
			return makePart('part') as unknown as never;
		}
	},
	Sequence: class {
		constructor(_cb: unknown, _events: unknown, _sub: unknown) {
			return makePart('sequence') as unknown as never;
		}
	},
	getTransport: () => ({ PPQ: 480 })
}));

/** How many Sampler (drum kit) instances were constructed. */
let drumKitLoads = 0;
/** When true the kit load rejects, so the kit stays unloaded after preload. */
let failDrumLoad = false;

class FakeInstrument {
	load = Promise.resolve();
	start = vi.fn();
	stop = vi.fn();
	disconnect = vi.fn();
}

vi.mock('smplr', () => ({
	Sampler: class {
		load: Promise<void>;
		constructor() {
			drumKitLoads++;
			this.load = failDrumLoad
				? Promise.reject(new Error('kit unavailable'))
				: Promise.resolve();
		}
		start = vi.fn();
		stop = vi.fn();
		disconnect = vi.fn();
	},
	Smolken: class extends FakeInstrument {},
	SplendidGrandPiano: class extends FakeInstrument {},
	Soundfont: class extends FakeInstrument {}
}));

/**
 * Supersession that trips at the Nth `isStillCurrent()` check, independent of
 * how long any load actually takes. `scheduleBackingTrack` checks after
 * `getTone()` and again after `ensureDrums()`; tripping the second models "a
 * newer schedule took over while we were awaiting the kit". Driving it by
 * checkpoint rather than by timing keeps the test pinned to the invariant
 * rather than to whichever await happens to be slow today.
 */
function supersedeAtCheck(n: number): () => boolean {
	let calls = 0;
	return () => ++calls < n;
}

function fakeGain() {
	return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
}

vi.mock('$lib/audio/audio-context', () => ({
	initAudio: async () => ({ createGain: fakeGain, currentTime: 0 }),
	getAudioContext: () => ({ createGain: fakeGain, currentTime: 0 }),
	getMasterGain: () => fakeGain()
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PHRASE: Phrase = {
	id: 'p1',
	name: 'Supersede Probe',
	timeSignature: [4, 4],
	key: 'C',
	notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
	harmony: [
		{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [1, 1]
		}
	],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
	category: 'ii-V-I-major',
	tags: [],
	source: 'user-entered'
};

const OPTIONS: PlaybackOptions = {
	tempo: 120,
	swing: 0,
	countInBeats: 0,
	backingTrackEnabled: true,
	backingStyle: 'swing',
	backingInstrument: 'piano',
	backingTrackVolume: 0.5
} as PlaybackOptions;

describe('scheduleBackingTrack supersession', () => {
	beforeEach(async () => {
		vi.resetModules();
		parts.length = 0;
		drumKitLoads = 0;
		failDrumLoad = false;
	});

	it('starts bass, comp and drums when it is not superseded', async () => {
		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');
		await mod.scheduleBackingTrack(PHRASE, OPTIONS, 480, false, () => true);

		// Bass, comp and drums are all tick-placed Parts (drums moved off
		// Sequence so their swung eighths share the swing grid).
		const started = parts.filter((p) => p.started);
		expect(started.filter((p) => p.kind === 'part')).toHaveLength(3);
		expect(started.filter((p) => p.kind === 'sequence')).toHaveLength(0);
	});

	it('starts NOTHING when superseded at the kit checkpoint', async () => {
		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');

		// Trip the second check — the one guarding the kit await.
		await mod.scheduleBackingTrack(PHRASE, OPTIONS, 480, false, supersedeAtCheck(2));

		// The bailout must be atomic: a superseded schedule leaves nothing
		// audible running. Bass + comp playing over no drums is the bug.
		expect(parts.filter((p) => p.started && !p.disposed)).toEqual([]);
	});

	it('starts NOTHING when superseded at the kit checkpoint on a cold kit', async () => {
		// Preload fails, so the kit is genuinely unloaded when scheduling runs —
		// the original bug's real-world shape, not just a simulated checkpoint.
		failDrumLoad = true;
		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');

		await expect(
			mod.scheduleBackingTrack(PHRASE, OPTIONS, 480, false, supersedeAtCheck(2))
		).rejects.toThrow(/kit unavailable/);

		expect(parts.filter((p) => p.started && !p.disposed)).toEqual([]);
	});

	it('preloads the drum kit with the pitched instruments', async () => {
		// The kit await now precedes the first audible commit, so it must not be
		// a cold sample fetch on a running transport.
		const mod = await import('$lib/audio/backing-track');
		await mod.loadBackingInstruments('piano');
		expect(drumKitLoads).toBe(1);

		await mod.scheduleBackingTrack(PHRASE, OPTIONS, 480, false, () => true);
		expect(drumKitLoads).toBe(1); // scheduling reused it, no second load
	});

	it('survives a drum kit preload failure without blocking bass and comp', async () => {
		failDrumLoad = true;
		const mod = await import('$lib/audio/backing-track');
		await expect(mod.loadBackingInstruments('piano')).resolves.toBeUndefined();
		expect(mod.isBackingLoaded()).toBe(true);
	});
});

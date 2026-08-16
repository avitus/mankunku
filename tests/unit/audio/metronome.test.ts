import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the Tone.js metronome wrapper.
 *
 * The testable surface is scheduling arithmetic and lifecycle, not sound:
 * which events each Sequence is built from, where it starts (the `startAt`
 * tick contract that record-a-lick depends on), which voice fires per beat,
 * the METRONOME_TRIM applied under the volume knob, and that disposal
 * covers BOTH sequences — a leaked count-in sequence means woodblocks
 * bleeding into the next take and corrupting its bleed grid.
 */

interface FakeSequence {
	cb: (time: number, beat: number) => void;
	events: number[];
	subdivision: string;
	startedAt: Array<string | number>;
	loop: boolean;
	disposed: boolean;
}

const sequences: FakeSequence[] = [];

interface Triggered {
	synth: string;
	args: unknown[];
}

/** Every triggerAttackRelease call across all synths, in order. */
let triggered: Triggered[] = [];

function fakeSynth(name: string) {
	const synth: { connect: () => unknown; triggerAttackRelease: (...args: unknown[]) => void } = {
		connect: () => synth,
		triggerAttackRelease: (...args: unknown[]) => {
			triggered.push({ synth: name, args });
		}
	};
	return synth;
}

let gains: Array<{ gain: { value: number } }> = [];
// Construction order in ensureSynths is fixed: NoiseSynth ride then hihat,
// MembraneSynth kick then woodblock.
let noiseCount = 0;
let membraneCount = 0;

vi.mock('tone', () => ({
	Gain: class {
		gain: { value: number };
		connect = vi.fn();
		constructor(value: number) {
			this.gain = { value };
			gains.push(this);
		}
	},
	Filter: class {
		connect = () => this;
	},
	NoiseSynth: class {
		constructor() {
			noiseCount += 1;
			return fakeSynth(noiseCount === 1 ? 'ride' : 'hihat') as unknown as never;
		}
	},
	MembraneSynth: class {
		constructor() {
			membraneCount += 1;
			return fakeSynth(membraneCount === 1 ? 'kick' : 'woodblock') as unknown as never;
		}
	},
	Sequence: class {
		constructor(cb: (time: number, beat: number) => void, events: number[], subdivision: string) {
			const seq: FakeSequence = {
				cb,
				events,
				subdivision,
				startedAt: [],
				// Tone.js Sequence defaults to loop = true, so the SUT's explicit
				// `loop = false` lines are load-bearing — a mock defaulting to
				// false would let their deletion pass silently.
				loop: true,
				disposed: false
			};
			sequences.push(seq);
			return {
				start: (at: string | number) => {
					seq.startedAt.push(at);
				},
				get loop() {
					return seq.loop;
				},
				set loop(v: boolean) {
					seq.loop = v;
				},
				dispose: () => {
					seq.disposed = true;
				}
			} as unknown as never;
		}
	}
}));

vi.mock('$lib/audio/audio-context', () => ({
	getMasterGain: () => ({ connect: vi.fn() })
}));

type Metronome = typeof import('$lib/audio/metronome');
let metronome: Metronome;

beforeEach(async () => {
	vi.resetModules();
	sequences.length = 0;
	triggered = [];
	gains = [];
	noiseCount = 0;
	membraneCount = 0;
	metronome = await import('$lib/audio/metronome');
});

describe('scheduleMetronome', () => {
	it('passes startAt through to Sequence.start verbatim — tick notation stays ticks', async () => {
		// Record-a-lick passes `${8 * PPQ}i` because bar notation ('2m') would
		// resolve through the sticky global Transport.timeSignature. The wrapper
		// must not reinterpret it.
		await metronome.scheduleMetronome(4, null, '3840i');
		expect(sequences).toHaveLength(1);
		expect(sequences[0].startedAt).toEqual(['3840i']);
	});

	it('defaults startAt to transport 0', async () => {
		await metronome.scheduleMetronome(4, null);
		expect(sequences[0].startedAt).toEqual([0]);
	});

	it('finite bars build beatsPerBar × bars events on the quarter grid, no loop', async () => {
		await metronome.scheduleMetronome(4, 2);
		expect(sequences[0].events).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
		expect(sequences[0].subdivision).toBe('4n');
		expect(sequences[0].loop).toBe(false);
	});

	it('null bars build one bar of events and loop', async () => {
		await metronome.scheduleMetronome(4, null);
		expect(sequences[0].events).toEqual([0, 1, 2, 3]);
		expect(sequences[0].loop).toBe(true);
	});

	it('kick replaces ride on the downbeat; hi-hat chicks on 2 and 4', async () => {
		await metronome.scheduleMetronome(4, 1);
		// Times chosen so they can't collide with any velocity value when
		// filtering calls by argument.
		for (const beat of [0, 1, 2, 3]) sequences[0].cb(10 + beat, beat);

		const byBeat = (i: number) => triggered.filter((t) => t.args.includes(10 + i));
		expect(byBeat(0).map((t) => t.synth)).toEqual(['kick']);
		expect(byBeat(1).map((t) => t.synth)).toEqual(['ride', 'hihat']);
		expect(byBeat(2).map((t) => t.synth)).toEqual(['ride']);
		expect(byBeat(3).map((t) => t.synth)).toEqual(['ride', 'hihat']);
	});

	it('rescheduling disposes the previous kit sequence', async () => {
		await metronome.scheduleMetronome(4, null);
		await metronome.scheduleMetronome(4, 2);
		expect(sequences).toHaveLength(2);
		expect(sequences[0].disposed).toBe(true);
		expect(sequences[1].disposed).toBe(false);
	});
});

describe('scheduleCountInClicks', () => {
	it('starts at transport 0, finite, on the same quarter grid as the kit', async () => {
		await metronome.scheduleCountInClicks(4, 2);
		expect(sequences).toHaveLength(1);
		expect(sequences[0].startedAt).toEqual([0]);
		expect(sequences[0].loop).toBe(false);
		expect(sequences[0].events).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
		expect(sequences[0].subdivision).toBe('4n');
	});

	it('accents the downbeat: A5 at 0.9, other beats E5 at 0.6, all woodblock', async () => {
		await metronome.scheduleCountInClicks(4, 1);
		for (const beat of [0, 1, 2, 3]) sequences[0].cb(beat * 0.5, beat);

		expect(triggered.every((t) => t.synth === 'woodblock')).toBe(true);
		expect(triggered[0].args).toEqual(['A5', '32n', 0, 0.9]);
		expect(triggered[1].args).toEqual(['E5', '32n', 0.5, 0.6]);
		expect(triggered[2].args).toEqual(['E5', '32n', 1.0, 0.6]);
		expect(triggered[3].args).toEqual(['E5', '32n', 1.5, 0.6]);
	});

	it('rescheduling disposes the previous count-in sequence', async () => {
		await metronome.scheduleCountInClicks(4, 2);
		await metronome.scheduleCountInClicks(4, 2);
		expect(sequences).toHaveLength(2);
		expect(sequences[0].disposed).toBe(true);
		expect(sequences[1].disposed).toBe(false);
	});
});

describe('disposeMetronome', () => {
	it('disposes BOTH the kit and count-in sequences', async () => {
		await metronome.scheduleCountInClicks(4, 2);
		await metronome.scheduleMetronome(4, null, '3840i');
		metronome.disposeMetronome();
		expect(sequences).toHaveLength(2);
		expect(sequences.every((s) => s.disposed)).toBe(true);
	});

	it('is safe to call with nothing scheduled', () => {
		expect(() => metronome.disposeMetronome()).not.toThrow();
	});
});

describe('setMetronomeVolume', () => {
	it('applies METRONOME_TRIM (0.6) under the knob value', async () => {
		await metronome.warmUpMetronome();
		await metronome.setMetronomeVolume(0.5);
		expect(gains[0].gain.value).toBeCloseTo(0.5 * 0.6, 10);
	});

	it('clamps the knob to [0, 1] before trimming', async () => {
		await metronome.warmUpMetronome();
		await metronome.setMetronomeVolume(1.7);
		expect(gains[0].gain.value).toBeCloseTo(0.6, 10);
		await metronome.setMetronomeVolume(-0.3);
		expect(gains[0].gain.value).toBe(0);
	});

	it('boots the synth graph with the default knob position trimmed', async () => {
		await metronome.warmUpMetronome();
		expect(gains[0].gain.value).toBeCloseTo(0.5 * 0.6, 10);
	});
});

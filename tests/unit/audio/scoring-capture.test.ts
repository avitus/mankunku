import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { createScoringCapture, prepareScoringCapture } from '$lib/audio/scoring-capture';

const { native } = vi.hoisted(() => ({ native: { sampleRate: 48000, destination: {}, createMediaStreamSource: vi.fn(), audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) } } }));
vi.mock('$lib/audio/audio-context', () => ({ getNativeAudioContext: async () => native }));
afterEach(() => vi.unstubAllGlobals());

/** Execute the actual worklet with a controllable sample clock. */
function processor() {
	const messages: { samples?: Float32Array; failed?: boolean }[] = [];
	let construct!: new () => { port: { onmessage: (event: { data: object }) => void }; process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
	const scope = {
		currentFrame: 100, sampleRate: 100,
		registerProcessor: (_: string, ctor: typeof construct) => { construct = ctor; },
		AudioWorkletProcessor: class { port = { postMessage: (data: typeof messages[number]) => messages.push(data) }; }
	};
	runInNewContext(readFileSync(new URL('../../../src/lib/audio/scoring-capture-worklet.js', import.meta.url), 'utf8'), scope);
	const node = new construct();
	return { scope, messages, node,
		send: (data: object) => node.port.onmessage({ data }),
		block: (samples: number[]) => node.process([[Float32Array.from(samples)]], [[new Float32Array(samples.length)]]) };
}

it('preserves the arm clock, silence and note attacks even when the start message arrives late', () => {
	const p = processor();
	p.send({ type: 'start', frame: 98 });
	p.block([0, 0, 0.5, 0.5]);
	p.scope.currentFrame = 104;
	p.send({ type: 'stop', frame: 106 });
	expect(p.block([0.25, 0.25, 0.9, 0.9])).toBe(false);
	expect([...p.messages[0].samples!]).toEqual([0, 0, 0, 0, 0.5, 0.5, 0.25, 0.25]);
	// The first attack remains 4 samples after arm, not 2 after message delivery.
	expect(p.messages[0].samples!.findIndex(value => value > 0)).toBe(4);
});

it('retains notes across chunk boundaries and returns no truncated take after the capture limit', () => {
	const p = processor();
	p.send({ type: 'start', frame: 100 });
	p.block(Array(100).fill(0.2));
	p.scope.currentFrame = 200;
	p.send({ type: 'stop', frame: 202 });
	p.block([0.7, 0.7, 0, 0]);
	expect(p.messages[0].samples).toHaveLength(102);
	expect(p.messages[0].samples![100]).toBeCloseTo(0.7);
	const long = processor();
	long.send({ type: 'start', frame: 100 });
	long.scope.currentFrame = 18100;
	expect(long.block([0.2])).toBe(false);
	expect(long.messages).toEqual([{ failed: true }]);
});

it('cancellation releases a pending take without returning audio', () => {
	const p = processor();
	p.send({ type: 'start', frame: 100 });
	p.block([0.5, 0.5]);
	p.send({ type: 'dispose' });
	expect(p.block([0.5])).toBe(false);
	expect(p.messages).toEqual([]);
});

/** Minimal native worklet, to exercise shutdown and WAV delivery. */
function fakeNode() {
	const node = { port: { postMessage: vi.fn(), close: vi.fn(), onmessage: (_: { data: object }) => {} }, connect: vi.fn(), disconnect: vi.fn(), onprocessorerror: () => {} };
	vi.stubGlobal('AudioWorkletNode', class { constructor() { return node; } });
	return node;
}

it('connects only the untrimmed mic and returns its WAV at the scheduled clock boundaries', async () => {
	const context = {} as AudioContext;
	const source = { mediaStream: {}, connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
	const mic = { connect: vi.fn(), disconnect: vi.fn() };
	native.createMediaStreamSource.mockReturnValue(mic);
	const node = fakeNode();
	await prepareScoringCapture(context);
	const capture = createScoringCapture(source, context)!;
	capture.start(1.25);
	expect(native.createMediaStreamSource).toHaveBeenCalledWith(source.mediaStream);
	expect(mic.connect).toHaveBeenCalledWith(node);
	expect(source.connect).not.toHaveBeenCalled();
	expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'start', frame: 60000 });
	const finished = capture.stop(1.75);
	expect(node.port.postMessage).toHaveBeenLastCalledWith({ type: 'stop', frame: 84000 });
	node.port.onmessage({ data: { samples: Float32Array.of(0, 0.5, -0.5) } });
	const wav = await finished;
	expect(wav?.type).toBe('audio/wav');
	const bytes = new DataView(await wav!.arrayBuffer());
	expect(bytes.getUint32(24, true)).toBe(48000);
	expect(bytes.getInt16(46, true)).toBe(16383);
	capture.dispose();
	expect(mic.disconnect).toHaveBeenCalledOnce();
	expect(node.port.close).toHaveBeenCalledOnce();
});

it('returns no audio after processor failure or disposal while stop is pending', async () => {
	const context = {} as AudioContext;
	const source = { mediaStream: {}, connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
	const mic = { connect: vi.fn(), disconnect: vi.fn() };
	native.createMediaStreamSource.mockReturnValue(mic);
	await prepareScoringCapture(context);
	const node = fakeNode();
	const capture = createScoringCapture(source, context)!;
	capture.start(1);
	const pending = capture.stop(2);
	capture.dispose();
	expect(await pending).toBeNull();
	const second = createScoringCapture(source, context)!;
	node.onprocessorerror();
	expect(await second.stop(2)).toBeNull();
	second.dispose();
});

it('still scores note timing without recorded clicks, and penalizes an uneven entrance', async () => {
	const { replayFromAudioBuffer } = await import('$lib/audio/replay');
	const { scoreAttempt } = await import('$lib/scoring/scorer');
	const { makeFakeAudioBuffer, makeSine } = await import('../../helpers/audio-fixtures');
	const { encodeWavMono16 } = await import('$lib/audio/wav');
	const phrase: import('$lib/types/music').Phrase = {
		id: 'mic-rhythm', name: 'Microphone rhythm', key: 'C', timeSignature: [4, 4],
		notes: [60, 62, 64].map((pitch, index) => ({ pitch, offset: [index, 4], duration: [1, 4] })),
		harmony: [], category: 'ii-V-I-major', tags: [], source: 'curated',
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 }
	};
	/** Reprocess the same PCM16 format stored by microphone capture. */
	async function score(secondDelay: number) {
		const sampleRate = 48000;
		const samples = new Float32Array(sampleRate * 2.2);
		for (const [index, frequency] of [261.63, 293.66, 329.63].entries()) {
			const start = 0.4 + index * 0.5 + (index === 1 ? secondDelay : 0);
			const note = makeSine(frequency, 0.2, sampleRate, 0.3);
			for (let i = 0; i < note.length; i++) note[i] *= Math.min(1, i / 480, (note.length - 1 - i) / 480);
			samples.set(note, Math.round(start * sampleRate));
		}
		const wav = new DataView(encodeWavMono16(samples, sampleRate));
		const decoded = Float32Array.from(samples, (_, index) => wav.getInt16(44 + index * 2, true) / 32768);
		const replay = await replayFromAudioBuffer(makeFakeAudioBuffer(decoded, sampleRate));
		// Isolate clock/rhythm fidelity: the real onset detector supplies attacks,
		// and the sustained frames after each attack supply its pitch.
		const notes = replay.onsets.map(onsetTime => {
			const reading = replay.readings.find(frame => frame.time >= onsetTime + 0.1)!;
			return { midi: reading.midi, cents: reading.cents, clarity: reading.clarity, onsetTime, duration: 0.2 };
		});
		expect(notes.map(note => note.midi)).toEqual([60, 62, 64]);
		return scoreAttempt(phrase, notes, 120, 0, 0.5);
	}
	const steady = await score(0);
	const uneven = await score(0.15);
	expect(steady.pitchAccuracy).toBe(1);
	expect(steady.rhythmAccuracy).toBeGreaterThan(0.95);
	expect(steady.timing.stdDevMs).toBeLessThan(20);
	expect(uneven.timing.perNoteOffsetMs[1]).toBeGreaterThan(130);
	expect(uneven.rhythmAccuracy).toBeLessThan(steady.rhythmAccuracy - 0.05);
});

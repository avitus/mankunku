/**
 * Real Tone.js scheduling, headless in Node: Tone's own Context, Transport,
 * Clock and TickSource over a stub AudioContext whose `currentTime` the test
 * drives. Tone's scheduler is pure arithmetic over that clock, so this
 * reproduces its timing exactly; nothing renders audio.
 *
 * Every other audio test mocks 'tone' away, which is right for testing what
 * OUR code schedules but can never show what Tone's clock DELIVERS — and the
 * 2026-10-01 tick re-delivery is a property of the clock alone.
 *
 * standardized-audio-context reads `window` once, when it is first imported,
 * to recognise native AudioParams and AudioNodes; the stub classes are put on
 * `globalThis.window` before Tone loads and removed again afterwards. Vitest
 * runs each test file in its own process, so the import-time capture cannot
 * leak into, or be pre-empted by, another file.
 */

type ToneModule = typeof import('tone');

class StubAudioParam {
	value: number;
	defaultValue: number;
	minValue = -3.4e38;
	maxValue = 3.4e38;
	constructor(value: number) {
		this.value = value;
		this.defaultValue = value;
	}
	setValueAtTime(): this {
		return this;
	}
	linearRampToValueAtTime(): this {
		return this;
	}
	exponentialRampToValueAtTime(): this {
		return this;
	}
	setTargetAtTime(): this {
		return this;
	}
	setValueCurveAtTime(): this {
		return this;
	}
	cancelScheduledValues(): this {
		return this;
	}
	cancelAndHoldAtTime(): this {
		return this;
	}
}

class StubAudioNode {
	numberOfInputs = 1;
	numberOfOutputs = 1;
	channelCount = 2;
	channelCountMode = 'max';
	channelInterpretation = 'speakers';
	constructor(extra: Record<string, unknown> = {}) {
		Object.assign(this, extra);
	}
	connect(): this {
		return this;
	}
	disconnect(): void {}
}

const LISTENER_PARAMS = [
	'positionX',
	'positionY',
	'positionZ',
	'forwardX',
	'forwardY',
	'forwardZ',
	'upX',
	'upY',
	'upZ'
];

function stubAudioContext(sampleRate: number): Record<string, unknown> {
	return {
		sampleRate,
		currentTime: 0,
		state: 'running',
		destination: new StubAudioNode({ maxChannelCount: 2 }),
		listener: Object.fromEntries(LISTENER_PARAMS.map((k) => [k, new StubAudioParam(0)])),
		createGain: () => new StubAudioNode({ gain: new StubAudioParam(1) }),
		createConstantSource: () =>
			new StubAudioNode({ offset: new StubAudioParam(1), start() {}, stop() {} }),
		createBuffer: (channels: number, length: number, rate: number) => ({
			getChannelData: () => new Float32Array(length),
			numberOfChannels: channels,
			length,
			sampleRate: rate
		}),
		createBufferSource: () =>
			new StubAudioNode({ playbackRate: new StubAudioParam(1), start() {}, stop() {} }),
		addEventListener() {},
		removeEventListener() {},
		resume: async () => {},
		close: async () => {}
	};
}

let tone: ToneModule | null = null;

async function loadTone(): Promise<ToneModule> {
	if (tone) return tone;
	const g = globalThis as { window?: unknown };
	g.window = { AudioParam: StubAudioParam, AudioNode: StubAudioNode };
	try {
		tone = await import('tone');
	} finally {
		delete g.window;
	}
	return tone;
}

/** Frames per Web Audio render quantum: `currentTime` only ever moves in these steps. */
const RENDER_QUANTUM_FRAMES = 128;

export interface HeadlessTransport {
	Tone: ToneModule;
	context: InstanceType<ToneModule['Context']>;
	transport: ReturnType<ToneModule['getTransport']>;
	/**
	 * Advance the audio clock one render quantum at a time for `seconds`,
	 * running Tone's scheduler at every step. A browser runs it every ~25 ms,
	 * so its passes end on SOME quantum boundaries; running it at every one
	 * makes each boundary a pass end, so every tick a browser could deliver
	 * twice is exercised.
	 */
	run: (seconds: number) => void;
}

export async function createHeadlessTransport(options: {
	sampleRate: number;
	bpm: number;
	/** The render quantum the transport starts on; picks where pass ends fall. */
	startQuantum: number;
}): Promise<HeadlessTransport> {
	const Tone = await loadTone();
	const context = new Tone.Context({
		context: stubAudioContext(options.sampleRate) as unknown as AudioContext,
		clockSource: 'offline',
		lookAhead: 0.1,
		updateInterval: 0.025
	});
	// Tone deep-copies a plain options object, so drive the copy it kept.
	const raw = context.rawContext as unknown as { currentTime: number };
	const quantum = RENDER_QUANTUM_FRAMES / options.sampleRate;
	let step = options.startQuantum;
	raw.currentTime = step * quantum;

	const transport = context.transport;
	transport.bpm.value = options.bpm;

	return {
		Tone,
		context,
		transport,
		run(seconds) {
			const end = raw.currentTime + seconds;
			while (raw.currentTime < end) {
				raw.currentTime = ++step * quantum;
				context.emit('tick');
			}
		}
	};
}

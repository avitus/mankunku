import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecorder } from '$lib/audio/recorder';

/**
 * The mic + monitor mix that every saved recording is made of. The mic trim
 * sets the mic-to-monitor ratio the bleed analysis then sees, so it is pinned
 * alongside the container negotiation and the stop/dispose contracts.
 */

type DataListener = ((e: { data: Blob }) => void) | null;

interface FakeRecorderInstance {
	stream: unknown;
	options: { mimeType?: string } | undefined;
	state: string;
	mimeType: string;
	ondataavailable: DataListener;
	onstop: (() => void) | null;
	stop: ReturnType<typeof vi.fn>;
}

const instances: FakeRecorderInstance[] = [];
let supported: string[] = [];

class FakeMediaRecorder {
	state = 'inactive';
	mimeType: string;
	ondataavailable: DataListener = null;
	onstop: (() => void) | null = null;
	start = vi.fn(() => {
		this.state = 'recording';
	});
	stop = vi.fn(() => {
		this.state = 'inactive';
		this.onstop?.();
	});
	constructor(
		public stream: unknown,
		public options?: { mimeType?: string }
	) {
		this.mimeType = options?.mimeType ?? 'audio/webm';
		instances.push(this as unknown as FakeRecorderInstance);
	}
	static isTypeSupported(type: string): boolean {
		return supported.includes(type);
	}
}

function graph() {
	const dest = { stream: { id: 'mixed' } };
	const micGain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
	const ctx = {
		createMediaStreamDestination: vi.fn(() => dest),
		createGain: vi.fn(() => micGain)
	} as unknown as AudioContext;
	const mic = { connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
	const master = { connect: vi.fn(), disconnect: vi.fn() } as unknown as GainNode;
	return { dest, micGain, ctx, mic, master };
}

beforeEach(() => {
	instances.length = 0;
	supported = ['audio/webm;codecs=opus'];
	vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(() => vi.unstubAllGlobals());

describe('createRecorder', () => {
	it('mixes the mic through a −8 dB trim and the master at unity into one destination', () => {
		const g = graph();
		createRecorder(g.mic, g.master, g.ctx);
		expect(g.micGain.gain.value).toBeCloseTo(0.4, 10);
		expect(g.mic.connect).toHaveBeenCalledWith(g.micGain);
		expect(g.micGain.connect).toHaveBeenCalledWith(g.dest);
		expect(g.master.connect).toHaveBeenCalledWith(g.dest);
	});

	it('negotiates the container: Opus in WebM, else MP4, else the browser default', () => {
		const g = graph();
		const rec = createRecorder(g.mic, g.master, g.ctx);
		rec.start();
		expect(instances[0].options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
		expect(instances[0].stream).toBe(g.dest.stream);
		supported = ['audio/mp4'];
		rec.start();
		expect(instances[1].options).toEqual({ mimeType: 'audio/mp4' });
		supported = [];
		rec.start();
		expect(instances[2].options).toBeUndefined();
	});

	it('stop with nothing recording resolves an empty blob', async () => {
		const g = graph();
		const rec = createRecorder(g.mic, g.master, g.ctx);
		const blob = await rec.stop();
		expect(blob.size).toBe(0);
		expect(blob.type).toBe('audio/webm');
	});

	it('stop after start resolves the non-empty chunks under the negotiated type, then is empty again', async () => {
		const g = graph();
		const rec = createRecorder(g.mic, g.master, g.ctx);
		rec.start();
		const r = instances[0];
		r.ondataavailable!({ data: new Blob(['abc']) });
		r.ondataavailable!({ data: new Blob([]) });
		r.ondataavailable!({ data: new Blob(['de']) });

		const blob = await rec.stop();
		expect(r.stop).toHaveBeenCalled();
		expect(blob.type).toBe('audio/webm;codecs=opus');
		expect(blob.size).toBe(5);

		const again = await rec.stop();
		expect(again.size).toBe(0);
	});

	it('start after dispose is a no-op, and dispose is idempotent even when a disconnect throws', () => {
		const g = graph();
		(g.mic.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error('already disconnected');
		});
		const rec = createRecorder(g.mic, g.master, g.ctx);
		rec.dispose();
		rec.dispose();
		rec.start();
		expect(instances).toHaveLength(0);
		expect(g.micGain.disconnect).toHaveBeenCalledTimes(1);
		expect(g.master.disconnect).toHaveBeenCalledTimes(1);
	});
});

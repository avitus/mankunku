import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Main-thread side of the onset worklet: module registration, the onset
 * message contract with the processor, and the clear/reset distinction the
 * practice routes rely on (clear keeps the clock, reset re-origins it).
 */

let nativeCtx: { audioWorklet: { addModule: ReturnType<typeof vi.fn> } };

vi.mock('$lib/audio/audio-context', () => ({
	getNativeAudioContext: async () => nativeCtx
}));

interface FakePort {
	onmessage: ((e: { data: { type: string; time: number } }) => void) | null;
	close: ReturnType<typeof vi.fn>;
}

const nodes: Array<{ port: FakePort; disconnect: ReturnType<typeof vi.fn>; ctx: unknown; name: string }> = [];

class FakeWorkletNode {
	port: FakePort = { onmessage: null, close: vi.fn() };
	disconnect = vi.fn();
	constructor(ctx: unknown, name: string) {
		nodes.push({ port: this.port, disconnect: this.disconnect, ctx, name });
	}
}

function source() {
	return { connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
}

const context = {} as AudioContext;

type Mod = typeof import('$lib/audio/onset-detector');
let mod: Mod;

beforeEach(async () => {
	vi.resetModules();
	nodes.length = 0;
	nativeCtx = { audioWorklet: { addModule: vi.fn(async () => {}) } };
	vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
	mod = await import('$lib/audio/onset-detector');
});

afterEach(() => vi.unstubAllGlobals());

describe('createOnsetDetector', () => {
	it('registers the worklet module once and builds every node on the NATIVE context', async () => {
		const src = source();
		await mod.createOnsetDetector(context, src);
		await mod.createOnsetDetector(context, source());

		expect(nativeCtx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
		expect(String(nativeCtx.audioWorklet.addModule.mock.calls[0][0])).toMatch(/onset-worklet\.js$/);
		expect(nodes).toHaveLength(2);
		expect(nodes[0].ctx).toBe(nativeCtx);
		expect(nodes[0].name).toBe('onset-detector');
		expect(src.connect).toHaveBeenCalledWith(expect.objectContaining({ port: nodes[0].port }));
	});

	it('collects onset messages relative to the reset start time and ignores other messages', async () => {
		const seen: number[] = [];
		const handle = await mod.createOnsetDetector(context, source(), (t) => seen.push(t));
		const port = nodes[0].port;

		handle.reset(10);
		port.onmessage!({ data: { type: 'onset', time: 10.5 } });
		port.onmessage!({ data: { type: 'level', time: 11 } });
		port.onmessage!({ data: { type: 'onset', time: 12 } });

		expect(handle.getOnsets()).toEqual([0.5, 2]);
		expect(seen).toEqual([0.5, 2]);
	});

	it('getOnsets hands out a copy', async () => {
		const handle = await mod.createOnsetDetector(context, source());
		nodes[0].port.onmessage!({ data: { type: 'onset', time: 1 } });
		const first = handle.getOnsets();
		first.push(99);
		expect(handle.getOnsets()).toEqual([1]);
	});

	it('clear keeps the start time; reset moves it', async () => {
		const handle = await mod.createOnsetDetector(context, source());
		const port = nodes[0].port;

		handle.reset(10);
		port.onmessage!({ data: { type: 'onset', time: 11 } });
		handle.clear();
		expect(handle.getOnsets()).toEqual([]);
		port.onmessage!({ data: { type: 'onset', time: 12 } });
		expect(handle.getOnsets()).toEqual([2]);

		handle.reset(12);
		port.onmessage!({ data: { type: 'onset', time: 12.25 } });
		expect(handle.getOnsets()).toEqual([0.25]);
	});

	it('dispose tolerates an already-disconnected source and still tears the node down', async () => {
		const src = source();
		(src.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error('not connected');
		});
		const handle = await mod.createOnsetDetector(context, src);

		expect(() => handle.dispose()).not.toThrow();
		expect(nodes[0].disconnect).toHaveBeenCalled();
		expect(nodes[0].port.close).toHaveBeenCalled();
	});
});

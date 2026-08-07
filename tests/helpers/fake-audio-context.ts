import { vi } from 'vitest';

/**
 * Minimal Web Audio context stub covering every node the backing graph
 * builds (gain, panner, compressor, convolver). Factories return inert
 * nodes carrying the AudioParams the production code assigns, so graph
 * construction runs in Node without a real audio stack.
 */
export function fakeAudioContext() {
	const param = () => ({ value: 0 });
	return {
		currentTime: 0,
		createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
		createStereoPanner: () => ({ pan: param(), connect: vi.fn(), disconnect: vi.fn() }),
		createDynamicsCompressor: () => ({
			threshold: param(),
			knee: param(),
			ratio: param(),
			attack: param(),
			release: param(),
			connect: vi.fn(),
			disconnect: vi.fn()
		}),
		createConvolver: () => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn() }),
		decodeAudioData: vi.fn(async () => {
			throw new Error('no decodeAudioData in the Node test stub');
		})
	};
}

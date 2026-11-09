import { describe, expect, it, vi } from 'vitest';
import { createSignalMonitor } from '$lib/audio/backing-signal-monitor';

function source(samples: number[] = []) {
	let pcm = samples, level = 1;
	const analyser = { fftSize: 2048, disconnect: vi.fn(), getFloatTimeDomainData: vi.fn((target: Float32Array) => {
		target.fill(0); pcm.forEach((value, index) => { target[index] = value * level; });
	}) };
	const context = { state: 'running', createAnalyser: vi.fn(() => analyser) };
	const node = { context, connect: vi.fn(), disconnect: vi.fn() };
	return { node: node as unknown as AudioNode, analyser, context, connect: node.connect, disconnect: node.disconnect,
		setSamples(value: number[]) { pcm = value; }, mute() { level = 0; } };
}

describe('post-mix backing PCM evidence', () => {
	it('reports measured signed waveform peaks, silence and muted output independently', () => {
		const bass = source([0, -.25, .1]), comp = source([0, .125, -.5]), drums = source();
		const monitor = createSignalMonitor({ bass: bass.node, comp: comp.node, drums: drums.node })!;
		expect(monitor.read()).toEqual({ bass: { peak: .25, peakSoFar: .25 }, comp: { peak: .5, peakSoFar: .5 }, drums: { peak: 0, peakSoFar: 0 } });
		bass.mute(); comp.setSamples([.0625]); drums.setSamples([-.75]);
		expect(monitor.read()).toEqual({ bass: { peak: 0, peakSoFar: .25 }, comp: { peak: .0625, peakSoFar: .5 }, drums: { peak: .75, peakSoFar: .75 } });
	});
	it('only connects side taps and disconnects those owned edges, once', () => {
		const bass = source([.25]);
		const monitor = createSignalMonitor({ bass: bass.node })!;
		expect(bass.connect).toHaveBeenCalledExactlyOnceWith(bass.analyser);
		monitor.dispose(); monitor.dispose();
		expect(bass.disconnect).toHaveBeenCalledExactlyOnceWith(bass.analyser);
		expect(bass.analyser.disconnect).toHaveBeenCalledExactlyOnceWith();
		expect(monitor.read()).toBeNull();
	});
	it('does not present a missing or suspended source as measured silence', () => {
		const bass = source([.25]);
		const monitor = createSignalMonitor({ bass: bass.node })!;
		expect(monitor.read()).toEqual({ bass: { peak: .25, peakSoFar: .25 }, comp: null, drums: null });
		bass.context.state = 'suspended';
		expect(monitor.read()).toEqual({ bass: null, comp: null, drums: null });
		expect(createSignalMonitor({})).toBeNull();
	});
	it('disposes stale graph taps without sampling or touching replacement audio', () => {
		const bass = source([.25]); let current = true;
		const monitor = createSignalMonitor({ bass: bass.node }, () => current)!;
		current = false;
		expect(monitor.read()).toBeNull();
		expect(bass.analyser.getFloatTimeDomainData).not.toHaveBeenCalled();
		expect(bass.disconnect).toHaveBeenCalledExactlyOnceWith(bass.analyser);
	});
	it('keeps healthy evidence when an analyser fails and never publishes nonfinite PCM', () => {
		const bass = source([NaN]), comp = source([.5]);
		const monitor = createSignalMonitor({ bass: bass.node, comp: comp.node })!;
		expect(monitor.read()).toEqual({ bass: null, comp: { peak: .5, peakSoFar: .5 }, drums: null });
		bass.analyser.getFloatTimeDomainData.mockImplementation(() => { throw new Error('unavailable'); });
		expect(monitor.read()?.bass).toBeNull();
	});
	it('cleans partially connected taps and returns unavailable if none can be created', () => {
		const bass = source([.25]); bass.connect.mockImplementation(() => { throw new Error('closed'); });
		expect(createSignalMonitor({ bass: bass.node })).toBeNull();
		expect(bass.disconnect).toHaveBeenCalledExactlyOnceWith(bass.analyser);
		expect(bass.analyser.disconnect).toHaveBeenCalledOnce();
	});
});

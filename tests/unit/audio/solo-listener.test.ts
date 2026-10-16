import { describe, expect, it, vi } from 'vitest';
import { createSoloListener, type SoloListenerOptions, type SoloListenerDependencies } from '$lib/audio/solo-listener';
import { createSoloObserver, type SoloObservationFrame, type SoloObservationWindow, type SoloObserver } from '$lib/audio/solo-observer';
import { buildSchedule } from '$lib/audio/backing-track-schedule';
import { PitchDetector } from 'pitchy';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };

function stream() {
	const track = { kind: 'audio', readyState: 'live', enabled: true, muted: false, stop: vi.fn() };
	return {
		track,
		value: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
	};
}

function harness(extra: Partial<SoloListenerOptions> = {}, dependencies: Partial<SoloListenerDependencies> = {}) {
	const pendingFrames = new Map<number, FrameRequestCallback>();
	let nextId = 0;
	let playing = false;
	let amplitude = 0.1;
	const context = { currentTime: 100, sampleRate: 48_000, state: 'running' };
	const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
	const analysers: { fftSize: number; smoothingTimeConstant: number; getFloatTimeDomainData: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
	const audioContext = {
		...context,
		createMediaStreamSource: vi.fn(() => {
			const node = { connect: vi.fn(), disconnect: vi.fn() };
			sources.push(node);
			return node;
		}),
		createAnalyser: vi.fn(() => {
			const node = {
				fftSize: 2048, smoothingTimeConstant: 0.8,
				getFloatTimeDomainData: vi.fn((buffer: Float32Array) => {
					for (let i = 0; i < buffer.length; i++) buffer[i] = amplitude * Math.sin(2 * Math.PI * 440 * i / 48_000);
				}), disconnect: vi.fn()
			};
			analysers.push(node);
			return node;
		})
	};
	const captures: ReturnType<typeof stream>[] = [];
	const getUserMedia = vi.fn(async () => {
		const owned = stream(); captures.push(owned); return owned.value;
	});
	const observers: { frames: SoloObservationFrame[]; finish: ReturnType<typeof vi.fn>; handle: SoloObserver }[] = [];
	const createObserver = vi.fn(() => {
		const frames: SoloObservationFrame[] = [];
		const windows: SoloObservationWindow[] = [];
		const complete = (time: number) => {
			const added: SoloObservationWindow[] = [];
			for (let bar = windows.length; bar < Math.min(4, Math.floor(time / 2)); bar++) {
				const window = Object.freeze({ barIndex: bar, availableAtSeconds: time }) as SoloObservationWindow;
				windows.push(window); added.push(window);
			}
			return Object.freeze(added);
		};
		const finish = vi.fn(complete);
		const handle: SoloObserver = {
			push(frame) { frames.push(frame); return complete(frame.timeSeconds); },
			finish, snapshot: () => Object.freeze([...windows])
		};
		observers.push({ frames, finish, handle });
		return handle;
	});
	const onWindow = vi.fn();
	const onComplete = vi.fn();
	const getPositionSeconds = vi.fn((time: number) => playing ? time - 100 : null);
	const schedule = buildSchedule([{ time: '192i', midi: 69, duration: 0.5 }], [], [{ time: '192i' }], 0, 192, 120);
	const createDetector = vi.fn(async () => ({ findPitch: () => [440, 0.99] as [number, number] }) as never);
	const listener = createSoloListener({
		sessionId: 'owned-lab-take', tempo: 120, beatsPerBar: 4, totalBars: 4,
		getPositionSeconds, getBackingSchedule: () => schedule, onWindow, onComplete, ...extra
	}, {
		initAudio: async () => audioContext as unknown as AudioContext,
		getUserMedia, createDetector, createObserver,
		requestFrame(callback) { const id = ++nextId; pendingFrames.set(id, callback); return id; },
		cancelFrame(id) { pendingFrames.delete(id); },
		...dependencies
	});
	function tick(position: number) {
		audioContext.currentTime = 100 + position;
		const pending = [...pendingFrames.entries()];
		for (const [id, callback] of pending) { pendingFrames.delete(id); callback(0); }
	}
	return {
		listener, getUserMedia, getPositionSeconds, onWindow, onComplete, createObserver, createDetector,
		audioContext, sources, analysers, captures, observers, pendingFrames, tick,
		play() { playing = true; }, amplitude(value: number) { amplitude = value; }
	};
}

describe('owned listening-lab microphone lifecycle', () => {
	it('cancels a pending permission promise immediately and stops only its late stream', async () => {
		const h = harness();
		const permission = deferred<MediaStream>();
		h.getUserMedia.mockReturnValueOnce(permission.promise);
		const start = h.listener.start();
		const outcome = start.catch((error) => error);
		await flush();
		expect(h.getUserMedia).toHaveBeenCalledOnce();
		expect(h.listener.stop()).toEqual([]);
		expect(await outcome).toMatchObject({ name: 'AbortError' });
		const late = stream(); permission.resolve(late.value); await flush();
		expect(late.track.stop).toHaveBeenCalledOnce();
		expect(h.sources).toHaveLength(0);
		expect(h.pendingFrames.size).toBe(0);
		expect(h.onWindow).not.toHaveBeenCalled();
		expect(h.onComplete).not.toHaveBeenCalled();
	});

	it('does not let an old permission completion release a restarted listener', async () => {
		const h = harness();
		const oldPermission = deferred<MediaStream>();
		h.getUserMedia.mockReturnValueOnce(oldPermission.promise);
		const oldStart = h.listener.start().catch((error) => error);
		await flush(); h.listener.stop(); await oldStart;
		await h.listener.start();
		const current = h.captures[0];
		const late = stream(); oldPermission.resolve(late.value); await flush();
		expect(late.track.stop).toHaveBeenCalledOnce();
		expect(current.track.stop).not.toHaveBeenCalled();
		h.play(); h.tick(0.1);
		expect(h.observers.at(-1)!.frames).toHaveLength(1);
		h.listener.stop();
		expect(current.track.stop).toHaveBeenCalledOnce();
	});

	it('deduplicates starts and releases connected nodes once without touching shared audio', async () => {
		const h = harness();
		await Promise.all([h.listener.start(), h.listener.start()]);
		expect(h.getUserMedia).toHaveBeenCalledOnce();
		expect(h.analysers[0]).toMatchObject({ fftSize: 4096, smoothingTimeConstant: 0 });
		expect(h.sources[0].connect).toHaveBeenCalledWith(h.analysers[0]);
		h.listener.stop(); h.listener.stop();
		expect(h.sources[0].disconnect).toHaveBeenCalledOnce();
		expect(h.analysers[0].disconnect).toHaveBeenCalledOnce();
		expect(h.captures[0].track.stop).toHaveBeenCalledOnce();
		expect(h.pendingFrames.size).toBe(0);
	});

	it('releases a stream when audio graph creation fails and permits retry', async () => {
		const h = harness();
		h.audioContext.createAnalyser.mockImplementationOnce(() => { throw new Error('graph failure'); });
		await expect(h.listener.start()).rejects.toThrow('graph failure');
		expect(h.captures[0].track.stop).toHaveBeenCalledOnce();
		expect(h.sources[0].disconnect).toHaveBeenCalledOnce();
		await h.listener.start(); h.listener.stop();
		expect(h.captures[1].track.stop).toHaveBeenCalledOnce();
	});

	it('does not request permission after cancellation during detector loading', async () => {
		const h = harness(); const detector = deferred<never>();
		h.createDetector.mockReturnValueOnce(detector.promise);
		const result = h.listener.start().catch((error) => error);
		await flush(); h.listener.stop();
		expect(await result).toMatchObject({ name: 'AbortError' });
		detector.resolve({ findPitch: () => [440, 0.99] } as never); await flush();
		expect(h.getUserMedia).not.toHaveBeenCalled();
	});
});

describe('audio-clock evidence and finite capture', () => {
	it('ignores pre-playback frames then sends raw RMS, end-anchored clock and committed bleed evidence', async () => {
		const h = harness(); await h.listener.start();
		h.tick(0.2);
		expect(h.observers[0].frames).toEqual([]);
		h.play(); h.tick(0.5);
		const frame = h.observers[0].frames[0];
		expect(frame.timeSeconds).toBeCloseTo(0.5, 8);
		expect(frame.availableAtSeconds).toBeGreaterThanOrEqual(frame.timeSeconds);
		expect(frame.rms).toBeCloseTo(0.1 / Math.sqrt(2), 3);
		expect(frame).toMatchObject({ inputAvailable: true, backingMidi: [69], nearBackingTransient: true });
		expect(h.getPositionSeconds).toHaveBeenCalledWith(100.5);
		h.listener.stop();
	});

	it('marks ended, muted and suspended input unavailable without treating analyser zeroes as rest', async () => {
		const h = harness(); await h.listener.start(); h.play();
		h.captures[0].track.muted = true; h.tick(0.1);
		h.captures[0].track.muted = false; h.audioContext.state = 'suspended'; h.tick(0.2);
		h.audioContext.state = 'running'; h.captures[0].track.readyState = 'ended'; h.tick(0.3);
		expect(h.observers[0].frames).toHaveLength(3);
		for (const frame of h.observers[0].frames) expect(frame).toMatchObject({ inputAvailable: false, midi: null, clarity: 0 });
		expect(h.analysers[0].getFloatTimeDomainData).not.toHaveBeenCalled();
		h.listener.stop();
	});

	it('marks read failures unavailable, and rejects duplicate or backwards audio times', async () => {
		const h = harness(); await h.listener.start(); h.play();
		h.analysers[0].getFloatTimeDomainData.mockImplementationOnce(() => { throw new Error('lost device'); });
		h.tick(0.4); h.tick(0.4); h.tick(0.3); h.tick(0.5);
		expect(h.observers[0].frames).toHaveLength(2);
		expect(h.observers[0].frames[0].inputAvailable).toBe(false);
		expect(h.observers[0].frames[1].inputAvailable).toBe(true);
		h.listener.stop();
	});

	it('does not classify input while the committed backing schedule is unavailable', async () => {
		const h = harness({ getBackingSchedule: () => null });
		await h.listener.start(); h.play(); h.amplitude(0); h.tick(0.1);
		expect(h.observers[0].frames[0].inputAvailable).toBe(false);
		h.listener.stop();
	});

	it('marks out-of-range samples and nonfinite detector results unavailable instead of poisoning the observer', async () => {
		const h = harness();
		h.createDetector.mockImplementationOnce(async () => ({ findPitch: () => [440, Number.NaN] }) as never);
		await h.listener.start(); h.play();
		h.analysers[0].getFloatTimeDomainData.mockImplementationOnce((buffer: Float32Array) => buffer.fill(2));
		h.tick(0.1); h.tick(0.2);
		expect(h.observers[0].frames).toHaveLength(2);
		for (const frame of h.observers[0].frames) expect(frame).toMatchObject({ inputAvailable: false, rms: 0, midi: null, clarity: 0 });
		h.listener.stop();
	});

	it('finishes at the finite audible end once, releases capture and never samples another loop', async () => {
		const h = harness(); await h.listener.start(); h.play();
		h.tick(0.1); h.tick(2.1); h.tick(4.1); h.tick(6.1); h.tick(8.04);
		expect(h.onComplete).toHaveBeenCalledOnce();
		expect(h.onComplete.mock.calls[0][0]).toHaveLength(4);
		expect(h.onWindow).toHaveBeenCalledTimes(4);
		expect(h.observers[0].finish).toHaveBeenCalledWith(expect.closeTo(8.04, 8));
		expect(h.pendingFrames.size).toBe(0);
		expect(h.captures[0].track.stop).toHaveBeenCalledOnce();
		h.tick(10); h.listener.stop();
		expect(h.onComplete).toHaveBeenCalledOnce();
		expect(h.listener.snapshot()).toHaveLength(4);
	});

	it('manual stop keeps only completed bars and prevents an already queued callback from publishing', async () => {
		const h = harness(); await h.listener.start(); h.play();
		h.tick(2.5);
		const staleCallback = [...h.pendingFrames.values()][0];
		const beforeStop = h.onWindow.mock.calls.length;
		expect(h.listener.stop()).toHaveLength(1);
		h.audioContext.currentTime = 108; staleCallback(0);
		expect(h.onWindow).toHaveBeenCalledTimes(beforeStop);
		expect(h.onComplete).not.toHaveBeenCalled();
		expect(h.pendingFrames.size).toBe(0);
	});

	it('stopping inside a window callback prevents later callbacks and rescheduling', async () => {
		const h = harness(); await h.listener.start(); h.play();
		h.onWindow.mockImplementationOnce(() => h.listener.stop());
		h.tick(4.1);
		expect(h.onWindow).toHaveBeenCalledOnce();
		expect(h.onComplete).not.toHaveBeenCalled();
		expect(h.pendingFrames.size).toBe(0);
	});

	it('releases capture even when a consumer window callback throws', async () => {
		const h = harness(); await h.listener.start(); h.play();
		h.onWindow.mockImplementationOnce(() => { throw new Error('consumer failure'); });
		expect(() => h.tick(2.1)).toThrow('consumer failure');
		expect(h.captures[0].track.stop).toHaveBeenCalledOnce();
		expect(h.pendingFrames.size).toBe(0);
		h.listener.stop();
		expect(h.captures[0].track.stop).toHaveBeenCalledOnce();
	});

	it('retains actual detector availability after analysis instead of claiming a boundary was observed early', async () => {
		const h = harness();
		h.createDetector.mockImplementationOnce(async () => ({ findPitch() {
			h.audioContext.currentTime += 0.03;
			return [440, 0.99];
		} }) as never);
		await h.listener.start(); h.play(); h.tick(1.99);
		const frame = h.observers[0].frames[0];
		expect(frame.timeSeconds).toBeCloseTo(1.99, 8);
		expect(frame.availableAtSeconds).toBeCloseTo(2.02, 8);
		h.listener.stop();
	});

	it('feeds real Pitchy and observer with bounded quiet and active windows without saving audio frames', async () => {
		const h = harness({ getBackingSchedule: () => buildSchedule([], [], [], 0, 192, 120) }, {
			createObserver: createSoloObserver,
			createDetector: async (size) => PitchDetector.forFloat32Array(size)
		});
		await h.listener.start(); h.play();
		// Actual browser sampling starts after the downbeat. Do not manufacture
		// a time-zero quiet frame to fill that initial, genuinely unknown gap.
		for (let frame = 1; frame <= 481; frame++) {
			const seconds = frame / 60;
			h.amplitude(seconds >= 2 && seconds < 6 ? 0.1 : 0);
			h.tick(seconds);
		}
		const windows = h.listener.snapshot();
		expect(windows).toHaveLength(4);
		expect(windows.map((window) => window.status)).toEqual(['unknown', 'active', 'active', 'resting']);
		expect(windows[0].reason).toBe('missing_frames');
		expect(windows[1].registerCenter).toBe(69);
		expect(windows[1].noteDensity).toBeGreaterThan(0);
		expect(windows[1].feature?.barIndex).toBeGreaterThan(windows[1].barIndex);
		expect(windows.every((window) => Object.isFrozen(window))).toBe(true);
		expect(Object.isFrozen(windows)).toBe(true);
		expect(h.onComplete).toHaveBeenCalledOnce();
		expect(h.pendingFrames.size).toBe(0);
	});

	it('keeps a clear nonmatching live pitch usable through actual backing transient masks', async () => {
		const bass = Array.from({ length: 16 }, (_, beat) => ({ time: `${beat * 192}i`, midi: 48, duration: 0.4 }));
		const comp = Array.from({ length: 4 }, (_, bar) => ({ time: `${(bar * 4 + 1.5) * 192}i`, notes: [60, 64, 67], duration: 0.2 }));
		const drums = Array.from({ length: 4 }, (_, bar) => [0, 1, 1 + 2 / 3, 2, 3, 3 + 2 / 3]
			.map((beat) => ({ time: `${Math.round((bar * 4 + beat) * 192)}i` }))).flat();
		const schedule = buildSchedule(bass, comp, drums, 0, 192, 120);
		const h = harness({ getBackingSchedule: () => schedule }, {
			createObserver: createSoloObserver,
			createDetector: async (size) => PitchDetector.forFloat32Array(size)
		});
		await h.listener.start(); h.play();
		for (let frame = 1; frame <= 481; frame++) {
			const seconds = frame / 60;
			h.amplitude(seconds >= 2 && seconds < 6 ? 0.1 : 0);
			h.tick(seconds);
		}
		const windows = h.listener.snapshot();
		expect(windows[1].status).toBe('active');
		expect(windows[1].feature).toBeDefined();
		expect(windows[2].status).toBe('active');
		expect(windows[2].registerCenter).toBe(69);
		expect(windows[2].attackCount).toBe(0); // Mask crossings do not invent repeated attacks.
		expect(windows[3].status).toBe('resting');
	});
});

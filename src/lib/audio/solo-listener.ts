/** Owned microphone capture for a finite listening-lab take; independent of scoring. */
import type { BackingTrackSchedule } from './backing-track-schedule';
import { initAudio } from './audio-context';
import { createOctaveStabilizer, detectFrame } from './pitch-frame';
import { createSoloObserver, type SoloObservationWindow, type SoloObserver, type SoloObserverConfig } from './solo-observer';

export interface SoloListenerOptions extends SoloObserverConfig {
	/** Map this exact audio-clock instant to performance seconds; null before playback. */
	getPositionSeconds(contextTime: number): number | null;
	/** Null means unavailable evidence, not a known silent backing track. */
	getBackingSchedule(): BackingTrackSchedule | null;
	onWindow?(window: SoloObservationWindow): void;
	onComplete?(windows: readonly SoloObservationWindow[]): void;
}

export interface SoloListenerDependencies {
	initAudio(): Promise<AudioContext>;
	getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
	requestFrame(callback: FrameRequestCallback): number;
	cancelFrame(id: number): void;
	createDetector(size: number): Promise<Parameters<typeof detectFrame>[2]>;
	createObserver(config: SoloObserverConfig): SoloObserver;
}

export interface SoloListener {
	/** Ready for playback once resolved. Cancellation rejects with AbortError. */
	start(): Promise<void>;
	/** Release only this listener's resources; never publish callbacks after stopping. */
	stop(): readonly SoloObservationWindow[];
	snapshot(): readonly SoloObservationWindow[];
}

const FFT_SIZE = 4096;
const EMPTY: readonly SoloObservationWindow[] = Object.freeze([]);

const defaults: SoloListenerDependencies = {
	initAudio,
	getUserMedia: (constraints) => {
		if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
			return Promise.reject(new Error('Microphone capture is unavailable in this browser.'));
		}
		return navigator.mediaDevices.getUserMedia(constraints);
	},
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (id) => cancelAnimationFrame(id),
	createDetector: async (size) => (await import('pitchy')).PitchDetector.forFloat32Array(size),
	createObserver: createSoloObserver
};

interface CaptureRun {
	active: boolean;
	ready: boolean;
	promise: Promise<void>;
	resolve(): void;
	reject(error: unknown): void;
	observer: SoloObserver;
	context: AudioContext | null;
	stream: MediaStream | null;
	source: MediaStreamAudioSourceNode | null;
	analyser: AnalyserNode | null;
	frameId: number | null;
	lastFrameTime: number;
	lastAvailable: number;
}

/**
 * Each start owns a separate stream and observer. No shared capture/scoring
 * singleton, raw recording, transport mutation, or AudioContext shutdown.
 * getUserMedia cannot itself be aborted: stop settles start immediately and
 * a late permission result is released by its original, now inactive run.
 */
export function createSoloListener(
	options: SoloListenerOptions,
	dependencies: Partial<SoloListenerDependencies> = {}
): SoloListener {
	const deps = { ...defaults, ...dependencies };
	const duration = options.totalBars * options.beatsPerBar * 60 / options.tempo;
	let current: CaptureRun | null = null;
	const isCurrent = (run: CaptureRun) => current === run && run.active;

	function position(context: AudioContext): number | null {
		const seconds = options.getPositionSeconds(context.currentTime);
		return seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
	}

	function release(run: CaptureRun): void {
		if (run.frameId !== null) deps.cancelFrame(run.frameId);
		run.frameId = null;
		// A disconnected device may throw while releasing one node. Always
		// continue releasing the other node and every owned track.
		try { run.source?.disconnect(); } catch { /* Already disconnected. */ }
		try { run.analyser?.disconnect(); } catch { /* Already disconnected. */ }
		run.source = null;
		run.analyser = null;
		for (const track of run.stream?.getTracks() ?? []) {
			try { track.stop(); } catch { /* Already stopped. */ }
		}
		run.stream = null;
	}

	function publish(run: CaptureRun, windows: readonly SoloObservationWindow[]): void {
		for (const window of windows) {
			if (!isCurrent(run)) return;
			options.onWindow?.(window);
		}
	}

	function complete(run: CaptureRun, availableAt: number): void {
		publish(run, run.observer.finish(availableAt));
		if (!isCurrent(run)) return;
		run.active = false;
		release(run);
		options.onComplete?.(run.observer.snapshot());
	}

	async function acquire(run: CaptureRun): Promise<void> {
		try {
			const [context, detector] = await Promise.all([deps.initAudio(), deps.createDetector(FFT_SIZE)]);
			if (!isCurrent(run)) return;
			run.context = context;
			run.stream = await deps.getUserMedia({ audio: {
				echoCancellation: false, noiseSuppression: false, autoGainControl: false
			} });
			if (!isCurrent(run)) { release(run); return; }
			run.source = context.createMediaStreamSource(run.stream);
			run.analyser = context.createAnalyser();
			run.analyser.fftSize = FFT_SIZE;
			run.analyser.smoothingTimeConstant = 0;
			run.source.connect(run.analyser);
			const buffer = new Float32Array(FFT_SIZE);
			const stabilizer = createOctaveStabilizer();

			const queue = () => {
				if (isCurrent(run)) run.frameId = deps.requestFrame(() => {
					try { sample(); }
					catch (error) {
						// Consumer callbacks and schedule providers are external to
						// capture. An exception must not leave a live microphone.
						run.active = false;
						release(run);
						throw error;
					}
				});
			};
			const sample = () => {
				run.frameId = null;
				if (!isCurrent(run)) return;
				let time = position(context);
				if (time === null || time <= run.lastFrameTime || time < run.lastAvailable) { queue(); return; }
				if (time >= duration) { complete(run, time); return; }
				const tracks = run.stream!.getAudioTracks();
				let healthy = context.state === 'running' && tracks.some((track) =>
					track.readyState === 'live' && track.enabled && !track.muted);
				let rms = 0;
				let midi: number | null = null;
				let clarity = 0;
				if (healthy) {
					try {
						run.analyser!.getFloatTimeDomainData(buffer);
						// The analyser window ENDS at the clock read after the data
						// fetch. Neither rAF wall time nor transport lookahead is audio.
						time = position(context);
						if (time === null || time <= run.lastFrameTime || time < run.lastAvailable) { queue(); return; }
						if (time >= duration) { complete(run, time); return; }
						let energy = 0;
						for (const value of buffer) energy += value * value;
						rms = Math.sqrt(energy / buffer.length);
						if (!Number.isFinite(rms) || rms > 1) throw new Error('Invalid microphone samples');
						const result = detectFrame(buffer, time, detector, stabilizer, {
							sampleRate: context.sampleRate, windowAnchor: 'end'
						});
						const reading = result.reading;
						if (!Number.isFinite(result.rawClarity) || result.rawClarity < 0 || result.rawClarity > 1 ||
							(reading && (!Number.isFinite(reading.midi) || reading.midi < 0 || reading.midi > 127 ||
								!Number.isFinite(reading.clarity) || reading.clarity < 0 || reading.clarity > 1))) {
							throw new Error('Invalid microphone pitch result');
						}
						if (reading && !reading.warmup && !reading.octaveUp) {
							midi = reading.midi;
							clarity = reading.clarity;
						}
					} catch {
						healthy = false;
						rms = 0;
						midi = null;
						clarity = 0;
						stabilizer.reset();
					}
				} else stabilizer.reset();
				const availableAt = position(context);
				if (time === null || availableAt === null || availableAt < time || availableAt < run.lastAvailable) { queue(); return; }
				const schedule = options.getBackingSchedule();
				const transientLookback = FFT_SIZE / context.sampleRate + 0.05;
				const nearBackingTransient = schedule?.bleedEventsIn(time, 0.03).some((offset) =>
					offset >= -transientLookback && offset <= 0.03) ?? false;
				run.lastFrameTime = time;
				run.lastAvailable = availableAt;
				publish(run, run.observer.push({
					timeSeconds: time, availableAtSeconds: availableAt, rms, midi, clarity,
					inputAvailable: healthy && schedule !== null,
					backingMidi: schedule?.activeMidiAt(time) ?? [], nearBackingTransient
				}));
				if (!isCurrent(run)) return;
				if (availableAt >= duration) complete(run, availableAt);
				else queue();
			};
			run.ready = true;
			queue();
			run.resolve();
		} catch (error) {
			run.active = false;
			release(run);
			run.reject(error);
		}
	}

	return {
		start() {
			if (current?.active) return current.promise;
			let resolve!: () => void;
			let reject!: (error: unknown) => void;
			const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
			const run: CaptureRun = {
				active: true, ready: false, promise, resolve, reject, observer: deps.createObserver(options),
				context: null, stream: null, source: null, analyser: null, frameId: null,
				lastFrameTime: -1, lastAvailable: -1
			};
			current = run;
			void acquire(run);
			return promise;
		},
		stop() {
			const run = current;
			if (!run) return EMPTY;
			if (run.active) {
				run.active = false; // Invalidate callbacks before cleanup or promise settlement.
				if (!run.ready) run.reject(new DOMException('Microphone listening was cancelled.', 'AbortError'));
				try {
					if (run.lastAvailable >= 0) {
						const stoppedAt = run.context ? position(run.context) : null;
						run.observer.finish(Math.max(run.lastAvailable, stoppedAt ?? 0));
					}
				} finally { release(run); }
			}
			return run.observer.snapshot();
		},
		snapshot: () => current?.observer.snapshot() ?? EMPTY
	};
}

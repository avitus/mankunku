import type { MicCapture } from './capture';
import { getMasterGain, getNativeAudioContext } from './audio-context';
import { ownRoomGraph, roomChecks, roomInputs, roomStatus } from './room-scoring-state.svelte';
import { speakerJournalScope, speakerCaptureUntil, recordSpeakerCheck, type SpeakerCheck } from '$lib/diagnostics/speaker-checks';
import type { RoomFilter, RoomSamples, RoomSession, RoomTimingCheck } from './room-filter';
import { loadWorklet } from './load-worklet';
import { readProfile, restoreProfile, roomSetup, saveProfile } from './room-profile';

const duration = 5.6;
const captureLead = 0.025;
const verificationBudget = 0.4;
const minimumListenCapture = 1;
interface Measurement {
	captureAudio?: boolean;
	captureUntil?: number;
	correction?: RoomFilter;
	samples?: RoomSamples;
	silentOutput?: boolean;
	reduction?: number;
	filter?: RoomFilter;
	check?: RoomTimingCheck | null;
}

/** Low-level, decorrelated stereo calibration noise, ramped at both ends. */
function probe(ctx: AudioContext): AudioBuffer {
	const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
	const samples = new Float32Array(buffer.length);
	for (let channel = 0; channel < 2; channel++) {
		let brown = 0;
		let seed = 0x67185 + channel;
		for (let i = 0; i < samples.length; i++) {
			seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
			const white = seed / 2147483648 - 1;
			brown = 0.976 * brown + 0.024 * white;
			const ramp = Math.min(
				1,
				i / (0.5 * ctx.sampleRate),
				(samples.length - i) / (0.04 * ctx.sampleRate)
			);
			samples[i] = ramp * (0.065 * white + 0.29 * brown);
		}
		buffer.copyToChannel(samples, channel);
	}
	return buffer;
}

/** Collect both speakers and the microphone over one exact audio-clock interval. */
async function measure(
	ctx: AudioContext,
	mic: AudioNode,
	master: AudioNode,
	start: number,
	frames: number,
	deadline: number,
	signal: AbortSignal,
	filter?: RoomFilter,
	session?: RoomSession
): Promise<Measurement> {
	signal.throwIfAborted();
	const captureUntil = filter ? speakerCaptureUntil() : 0;
	const capture = new AudioWorkletNode(ctx, 'room-calibration-capture', {
		numberOfInputs: 2,
		numberOfOutputs: 1,
		outputChannelCount: [1],
		processorOptions: { start, frames }
	});
	let worker: Worker | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let interrupt: (() => void) | undefined;
	try {
		mic.connect(capture, 0, 0);
		master.connect(capture, 0, 1);
		capture.connect(ctx.destination); // The worklet's output is silence.
		return await new Promise<Measurement>((resolve, reject) => {
			interrupt = () => reject(new Error('Room measurement interrupted'));
			signal.addEventListener('abort', interrupt, { once: true });
			timer = setTimeout(
				() => reject(new Error('Room measurement timed out')),
				Math.max(0, deadline - ctx.currentTime) * 1000
			);
			capture.onprocessorerror = () => reject(new Error('Room capture processor failed'));
			capture.port.onmessage = ({ data: [input, left, right] }) => {
				try {
					worker = new Worker(new URL('./room-calibration-worker.ts', import.meta.url), {
						type: 'module'
					});
					worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve({ ...data, captureUntil });
					worker.onerror = (event) =>
						reject(new Error(event.message || 'Room estimation worker failed'));
					const retryClosing = deadline - ctx.currentTime < minimumListenCapture + captureLead + verificationBudget;
					worker.postMessage({ mic: input, left, right, rate: ctx.sampleRate, filter, session, retryClosing, includeAudio: captureUntil > 0 }, [
						input.buffer,
						left.buffer,
						right.buffer
					]);
				} catch (error) {
					reject(error);
				}
			};
		});
	} finally {
		clearTimeout(timer);
		if (interrupt) signal.removeEventListener('abort', interrupt);
		worker?.terminate();
		capture.port.close();
		capture.disconnect();
		try {
			mic.disconnect(capture);
		} catch {
			/* partially installed or disposed */
		}
		try {
			master.disconnect(capture);
		} catch {
			/* partially installed or disposed */
		}
	}
}

/** Practice only verifies stored taps. Only a sound check started in Settings may play noise. */
export async function calibrateRoom(
	capture: MicCapture,
	request: { mode: 'practice' } | { mode: 'sound-check'; signal: AbortSignal }
): Promise<'saved' | 'rejected' | 'silent-output' | 'unsaved' | undefined> {
	const journal = speakerJournalScope();
	const soundCheck = request.mode === 'sound-check' ? request.signal : undefined;
	const { source, stream, analyser } = capture;
	const track = stream.getAudioTracks()[0];
	const ctx = await getNativeAudioContext();
	if (track.readyState !== 'live' || soundCheck?.aborted) return;
	const settings = track.getSettings();
	const monitorSession = globalThis.crypto?.randomUUID?.();
	const report = (stage: SpeakerCheck['stage'], result: string, extra: Partial<SpeakerCheck> = {}) =>
		void recordSpeakerCheck({ at: new Date().toISOString(), rate: ctx.sampleRate, monitorSession, stage, result, ...extra }, undefined, journal);
	if (
		settings.autoGainControl ||
		settings.echoCancellation ||
		settings.noiseSuppression ||
		!ctx.audioWorklet ||
		ctx.sampleRate > 96000
	) {
		if (!soundCheck) roomStatus.active = false;
		report(request.mode === 'practice' ? 'practice' : 'sound-check', 'unsupported-input');
		return;
	}
	const setup = roomSetup(track, ctx);
	const snapshot = readProfile();
	const filter = soundCheck ? undefined : restoreProfile(snapshot, setup, ctx.sampleRate);
	if (!soundCheck && !filter) {
		report('practice', filter === null ? 'saved-rejection' : 'no-matching-profile');
		roomStatus.active = false;
		return;
	}
	const mixerMaster = getMasterGain() as GainNode & { _nativeAudioNode?: GainNode };
	const master = mixerMaster._nativeAudioNode ?? mixerMaster;
	// Speaker upmix duplicates a mono program into L and R. Use this exact
	// two-channel reference for both the worklet and the native convolvers.
	const reference = ctx.createGain();
	reference.channelCountMode = 'explicit';
	reference.channelCount = 2;
	reference.channelInterpretation = 'speakers';
	const micSource = ctx.createMediaStreamSource(stream);
	const mic = ctx.createGain();
	mic.channelCount = 1;
	mic.channelCountMode = 'explicit';
	micSource.connect(mic);
	const life = new AbortController();
	const nodes: AudioNode[] = [micSource, mic, reference];
	let listen: AbortController | undefined;
	let sound: AudioBufferSourceNode | undefined;
	let inverse: GainNode | undefined;
	let releaseResponses: (() => void) | undefined;
	let expiry: ReturnType<typeof setTimeout> | undefined;

	/** Mute the predicted echo immediately while preserving the microphone path. */
	function bypass(): void {
		clearTimeout(expiry);
		if (inverse) inverse.gain.value = 0;
		if (!soundCheck) roomStatus.active = false;
	}
	function invalidate(): void {
		sound?.stop();
		sound?.disconnect();
		life.abort();
		listen?.abort();
		bypass();
		if (!soundCheck) report('practice', 'device-or-clock-changed');
	}
	const stateChanged = (): void => {
		if (ctx.state !== 'running') invalidate();
	};
	const options = { signal: life.signal };
	soundCheck?.addEventListener('abort', invalidate, options);
	track.addEventListener('ended', invalidate, options);
	track.addEventListener('mute', invalidate, options);
	ctx.addEventListener('statechange', stateChanged, options);
	ctx.addEventListener('sinkchange', invalidate, options);
	navigator.mediaDevices.addEventListener('devicechange', invalidate, options);
	function dispose(): void {
		life.abort();
		listen?.abort();
		clearTimeout(expiry);
		sound?.disconnect();
		try {
			master.disconnect(reference);
		} catch {
			/* partially installed or already disposed */
		}
		releaseResponses?.();
		for (const node of nodes) node.disconnect();
		capture.analyser = analyser;
	}
	if (!soundCheck) ownRoomGraph(source, dispose);
	try {
		await loadWorklet(ctx, new URL('./room-calibration-worklet.js', import.meta.url), life.signal);
		life.signal.throwIfAborted();
		master.connect(reference);
		if (soundCheck) {
			// Start playback through the same context and Master as the instruments.
			// Only the worklet and its reference tap need the native graph.
			const buffer = probe(capture.context);
			sound = capture.context.createBufferSource();
			sound.buffer = buffer;
			sound.connect(mixerMaster);
			const start = Math.ceil((ctx.currentTime + 0.12) * ctx.sampleRate);
			sound.start(start / ctx.sampleRate);
			const measured = await measure(ctx, mic, reference, start, buffer.length, start / ctx.sampleRate + 15, life.signal);
			life.signal.throwIfAborted();
			if (measured.silentOutput) {
				report('sound-check', 'silent-output');
				return 'silent-output';
			}
			// A completed negative check can be remembered. A worker failure is retryable.
			if (!Number.isFinite(measured.reduction)) {
				report('sound-check', 'unavailable');
				return;
			}
			const stored = await saveProfile(snapshot, setup, measured.filter ?? null, life.signal);
			if (life.signal.aborted) return;
			const result = measured.filter ? (stored ? 'saved' : 'unsaved') : 'rejected';
			report('sound-check', result, { calibrationReductionDb: measured.reduction });
			return result;
		}
		if (!filter) return;

		const output = ctx.createGain();
		output.channelCountMode = 'explicit';
		output.channelCount = 1;
		const splitter = ctx.createChannelSplitter(2);
		inverse = ctx.createGain();
		inverse.gain.value = 0;
		const delay = ctx.createDelay(1);
		const pitch = ctx.createAnalyser();
		pitch.fftSize = analyser.fftSize;
		pitch.smoothingTimeConstant = analyser.smoothingTimeConstant;
		nodes.push(output, splitter, inverse, delay, pitch);
		// Move the common leading silence to an adjustable delay, preserving both FIRs.
		const firstTap = filter.left.findIndex((value, i) => value !== 0 || filter.right[i] !== 0);
		if (firstTap < 0) {
			report('practice', 'invalid-filter');
			bypass();
			return;
		}
		delay.delayTime.value = firstTap / ctx.sampleRate;
		// Convolver buffers are write-once. Replace the pair together when a
		// cue needs different taps, retaining the saved calibration for each Listen.
		const saved = filter;
		let usingCorrection = false;
		function installResponses(correction?: RoomFilter): void {
			if (releaseResponses && !usingCorrection && !correction) return;
			const pair: ConvolverNode[] = [];
			function release(): void {
				for (const node of pair) {
					try { splitter.disconnect(node); } catch { /* partial setup */ }
					node.disconnect();
				}
			}
			try {
				for (const [channel, side] of (['left', 'right'] as const).entries()) {
					const taps = saved[side].subarray(firstTap);
					const impulse = ctx.createBuffer(1, taps.length, ctx.sampleRate);
					impulse.copyToChannel(taps, 0);
					if (correction) {
						const data = impulse.getChannelData(0);
						for (let i = 0; i < correction[side].length; i++) data[i] += correction[side][i];
					}
					const node = ctx.createConvolver();
					pair.push(node);
					node.normalize = false;
					node.buffer = impulse;
					splitter.connect(node, channel);
					node.connect(delay);
				}
			} catch (error) {
				release();
				throw error;
			}
			releaseResponses?.();
			releaseResponses = release;
			usingCorrection = !!correction;
		}
		installResponses();
		delay.connect(inverse);
		reference.connect(splitter);
		mic.connect(output);
		inverse.connect(output);
		output.connect(pitch);
		capture.analyser = pitch;
		roomInputs.set(source, output);

		function enable(gain: number): void {
			clearTimeout(expiry);
			inverse!.gain.value = -gain;
			roomStatus.active = true;
			expiry = setTimeout(() => {
				bypass();
				report('practice', 'expired');
			}, 300_000);
		}

		let session: RoomSession | undefined;
		let learner: Worker | undefined;
		function stopLearning(): void {
			learner?.terminate();
			learner = undefined;
		}
		life.signal.addEventListener('abort', stopLearning, { once: true });

		// The scoring graph is already live. Build a candidate for the next cue off
		// its critical path. Only the current microphone graph owns these taps.
		function learn(samples: RoomSamples, offset: number, captureAudio: boolean): void {
			stopLearning();
			try {
				const worker = new Worker(new URL('./room-calibration-worker.ts', import.meta.url), { type: 'module' });
				learner = worker;
				worker.onmessage = ({ data }) => {
					if (learner !== worker) return;
					if (data.session) session = data.session;
					stopLearning();
				};
				worker.onerror = () => { if (learner === worker) stopLearning(); };
				worker.postMessage({ ...samples, filter, session, learnOffset: offset }, captureAudio ? [] :
					[samples.mic.buffer, samples.left.buffer, samples.right.buffer]);
			} catch {
				stopLearning();
			}
		}

		let cueNumber = 0;
		const verifyListen = async (startTime: number, seconds: number, phraseId?: string): Promise<void> => {
			listen?.abort();
			if (life.signal.aborted) return;
			const cue = { monitorSession, cueNumber: ++cueNumber, phraseId, listenSeconds: seconds, calibratedDelaySamples: firstTap };
			if (seconds < 1.8) {
				report('listen', 'short-cue', cue);
				bypass();
				return;
			}
			const current = new AbortController();
			listen = current;
			const deadline = startTime + seconds - 0.15;
			try {
				// A sparse or ambiguous opening can fail while later music in the
				// same demonstration verifies the model. Never sample into Play.
				for (let attempt = 1; attempt <= 2; attempt++) {
					const start = Math.ceil(Math.max(ctx.currentTime + captureLead, startTime + 0.04) * ctx.sampleRate);
					const frames = Math.floor(Math.min(3, deadline - start / ctx.sampleRate - verificationBudget) * ctx.sampleRate);
					if (frames < minimumListenCapture * ctx.sampleRate) {
						if (attempt === 1) {
							report('listen', 'insufficient-time', cue);
							bypass();
						}
						return;
					}
					const previous = session;
					const { check, samples, correction, captureAudio, captureUntil } = await measure(
						ctx,
						mic,
						reference,
						start,
						frames,
						deadline,
						current.signal,
						filter, previous
					);
					if (current.signal.aborted) return;
					function log(result: string): void {
						const event: SpeakerCheck = {
							at: new Date().toISOString(), stage: 'listen', rate: ctx.sampleRate, ...cue,
							result, attempt, startSeconds: start / ctx.sampleRate - startTime, captureSeconds: frames / ctx.sampleRate, check
						};
						void recordSpeakerCheck(event, captureAudio && samples && filter ? { event, samples, filter, session: previous, captureUntil } : undefined, journal);
					}
					if (ctx.currentTime >= deadline || !check) {
						log(check ? 'deadline' : 'insufficient-samples');
						bypass();
						return;
					}
					if (check.failure) {
						log(check.failure);
						bypass();
						continue;
					}
					installResponses(correction);
					delay.delayTime.value = (firstTap + check.offset) / ctx.sampleRate;
					enable(check.gain);
					log('active');
					if (samples) learn(samples, check.offset, !!captureAudio);
					return;
				}
			} catch (error) {
				if (!current.signal.aborted) {
					report('listen', error instanceof Error ? error.message : 'measurement-error', cue);
					bypass();
				}
			}
		};
		roomChecks.set(source, { measure: verifyListen, cancel: () => { listen?.abort(); bypass(); } });
		roomStatus.active = false;
	} catch (error) {
		if (!life.signal.aborted) {
			report(soundCheck ? 'sound-check' : 'practice', error instanceof Error ? error.message : 'unavailable');
			console.warn('Speaker room check unavailable', error);
			bypass();
		}
	} finally {
		sound?.disconnect();
		sound = undefined;
		if (soundCheck || !roomInputs.has(source)) dispose();
	}
}

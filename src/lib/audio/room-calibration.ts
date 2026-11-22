import type { MicCapture } from './capture';
import { getMasterGain, getNativeAudioContext } from './audio-context';
import { ownRoomGraph, roomChecks, roomInputs, roomStatus } from './room-scoring-state.svelte';
import type { RoomFilter, RoomTimingCheck } from './room-filter';
import { loadWorklet } from './load-worklet';
import { readProfile, restoreProfile, roomSetup, saveProfile } from './room-profile';

const duration = 5.6;
const active = 'Speaker bleed reduction active';
const fallback = 'Room check unavailable · scoring the original microphone';
const rejected = 'Room check did not pass · scoring the original microphone';

interface Measurement {
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
	filter?: RoomFilter
): Promise<Measurement> {
	signal.throwIfAborted();
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
					worker.onmessage = ({ data }) => resolve(data);
					worker.onerror = (event) =>
						reject(new Error(event.message || 'Room estimation worker failed'));
					worker.postMessage({ mic: input, left, right, rate: ctx.sampleRate, filter }, [
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
	const soundCheck = request.mode === 'sound-check' ? request.signal : undefined;
	const { source, stream, analyser } = capture;
	const track = stream.getAudioTracks()[0];
	const ctx = await getNativeAudioContext();
	if (track.readyState !== 'live' || soundCheck?.aborted) return;
	const settings = track.getSettings();
	if (
		settings.autoGainControl ||
		settings.echoCancellation ||
		settings.noiseSuppression ||
		!ctx.audioWorklet ||
		ctx.sampleRate > 96000
	) {
		if (!soundCheck) roomStatus.text = fallback;
		return;
	}
	const setup = roomSetup(track, ctx);
	const snapshot = readProfile();
	const filter = soundCheck ? undefined : restoreProfile(snapshot, setup, ctx.sampleRate);
	if (!soundCheck && !filter) {
		roomStatus.text = filter === null ? rejected : 'Using original microphone · calibrate speakers in Settings';
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
	let expiry: ReturnType<typeof setTimeout> | undefined;

	/** Mute the predicted echo immediately while preserving the microphone path. */
	function bypass(status: string): void {
		clearTimeout(expiry);
		if (inverse) inverse.gain.value = 0;
		if (!soundCheck) roomStatus.text = status;
	}
	function invalidate(): void {
		sound?.stop();
		sound?.disconnect();
		life.abort();
		listen?.abort();
		bypass(fallback);
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
			if (measured.silentOutput) return 'silent-output';
			// A completed negative check can be remembered. A worker failure is retryable.
			if (!Number.isFinite(measured.reduction)) return;
			const stored = await saveProfile(snapshot, setup, measured.filter ?? null, life.signal);
			if (life.signal.aborted) return;
			if (!measured.filter) return 'rejected';
			return stored ? 'saved' : 'unsaved';
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
			bypass(rejected);
			return;
		}
		delay.delayTime.value = firstTap / ctx.sampleRate;
		for (const [channel, taps] of [filter.left, filter.right].entries()) {
			const convolution = ctx.createConvolver();
			nodes.push(convolution);
			convolution.normalize = false;
			const impulse = ctx.createBuffer(1, taps.length - firstTap, ctx.sampleRate);
			impulse.copyToChannel(taps.subarray(firstTap), 0);
			convolution.buffer = impulse;
			splitter.connect(convolution, channel);
			convolution.connect(delay);
		}
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
			roomStatus.text = active;
			expiry = setTimeout(() => bypass('Room check expired · scoring the original microphone'), 300_000);
		}

		const verifyListen = async (startTime: number, seconds: number): Promise<void> => {
			listen?.abort();
			if (life.signal.aborted) return;
			if (seconds < 1.8) {
				bypass('Listen too short to verify speakers · scoring the original microphone');
				return;
			}
			const current = new AbortController();
			listen = current;
			const start = Math.ceil(Math.max(ctx.currentTime + 0.025, startTime + 0.04) * ctx.sampleRate);
			const deadline = startTime + seconds - 0.15;
			const frames = Math.floor(Math.min(3, deadline - start / ctx.sampleRate - 0.4) * ctx.sampleRate);
			if (frames < ctx.sampleRate) {
				bypass(rejected);
				return;
			}
			try {
				const { check } = await measure(
					ctx,
					mic,
					reference,
					start,
					frames,
					deadline,
					current.signal,
					filter
				);
				if (current.signal.aborted) return;
				if (ctx.currentTime >= deadline || !check?.accepted ||
					check.transientReduction < 1 || firstTap + check.offset < 0) {
					bypass('Saved speaker check did not pass · scoring the original microphone');
					return;
				}
				delay.delayTime.value = (firstTap + check.offset) / ctx.sampleRate;
				enable(check.gain);
			} catch {
				if (!current.signal.aborted) bypass(fallback);
			}
		};
		roomChecks.set(source, { measure: verifyListen, cancel: () => listen?.abort() });
		roomStatus.text = 'Using original microphone until Listen verifies saved calibration';
	} catch (error) {
		if (!life.signal.aborted) {
			console.warn('Speaker room check unavailable', error);
			bypass(fallback);
		}
	} finally {
		sound?.disconnect();
		sound = undefined;
		if (soundCheck || !roomInputs.has(source)) dispose();
	}
}

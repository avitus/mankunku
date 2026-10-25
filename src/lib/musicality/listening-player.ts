/** A finite, reproducible listening take with a view tied to the sounding audio clock. */
import type { BounceParams } from '$lib/audio/backing-bounce';
import { harmonyDurationBeats } from '$lib/audio/backing-bounce';
import type { GeneratedBacking } from '$lib/audio/backing-generation';

export type ListeningStatus = 'idle' | 'loading' | 'playing' | 'stopped' | 'completed' | 'error';
export interface ListeningSnapshot {
	status: ListeningStatus;
	generated: GeneratedBacking | null;
	/** Captured settings for the take; changing the controls cannot relabel this score. */
	params: BounceParams | null;
	ppq: number;
	startAudioTime: number | null;
	audioTime: number | null;
	elapsedBeats: number;
	durationBeats: number;
	barIndex: number | null;
	ending: boolean;
	error: string | null;
}
export interface PreparedListeningTake {
	generated: GeneratedBacking;
	ppq: number;
	startAudioTime: number;
	audioNow(): number;
	start(): void;
	/** Releases only this take's scheduled parts/voices, never a newer owner's graph. */
	stop(): void;
}
export interface ListeningPlayerRuntime {
	prepare(params: BounceParams, isCurrent: () => boolean): Promise<PreparedListeningTake | null>;
	poll(callback: () => void): () => void;
}
const RELEASE_TAIL_SECONDS = 2.5;

/** Inject the runtime for deterministic audio-clock and async-cancellation tests. */
export function createListeningPlayer(
	options: { onChange: (snapshot: ListeningSnapshot) => void },
	runtime: ListeningPlayerRuntime = browserListeningRuntime
) {
	let request = 0;
	let disposed = false;
	let take: PreparedListeningTake | null = null;
	let cancelPoll: (() => void) | null = null;
	let state: ListeningSnapshot = { status: 'idle', generated: null, params: null, ppq: 192,
		startAudioTime: null, audioTime: null, elapsedBeats: 0, durationBeats: 0,
		barIndex: null, ending: false, error: null };
	const publish = (patch: Partial<ListeningSnapshot>) => {
		state = { ...state, ...patch }; options.onChange(state);
	};
	const release = () => { cancelPoll?.(); cancelPoll = null; take?.stop(); take = null; };
	return {
		snapshot: () => state,
		async start(input: BounceParams): Promise<void> {
			if (disposed) return;
			const id = ++request;
			release();
			const isCurrent = () => !disposed && id === request;
			publish({ status: 'loading', generated: null, params: null, startAudioTime: null,
				audioTime: null, elapsedBeats: 0, durationBeats: 0, barIndex: null, ending: false, error: null });
			try {
				const params = structuredClone(input);
				const durationBeats = harmonyDurationBeats(params.phrase);
				if (!Number.isFinite(params.tempo) || params.tempo <= 0 || !Number.isFinite(durationBeats) || durationBeats <= 0) {
					throw new Error('Choose a tune with harmony and a positive tempo.');
				}
				const prepared = await runtime.prepare(params, isCurrent);
				if (!isCurrent()) { prepared?.stop(); return; }
				if (!prepared) throw new Error('The backing instruments could not be prepared.');
				take = prepared;
				prepared.start();
				publish({ status: 'playing', params, generated: prepared.generated, ppq: prepared.ppq,
					startAudioTime: prepared.startAudioTime, durationBeats });
				const update = () => {
					if (!isCurrent() || state.status !== 'playing') return;
					const audioTime = prepared.audioNow();
					const elapsedSeconds = Math.max(0, audioTime - prepared.startAudioTime);
					const durationSeconds = durationBeats * 60 / params.tempo;
					const elapsedBeats = Math.min(durationBeats, elapsedSeconds * params.tempo / 60);
					const barIndex = audioTime < prepared.startAudioTime ? null
						: Math.min(Math.ceil(durationBeats / params.phrase.timeSignature[0]) - 1,
							Math.floor(elapsedBeats / params.phrase.timeSignature[0]));
					const complete = elapsedSeconds >= durationSeconds + RELEASE_TAIL_SECONDS;
					if (complete) release();
					publish({ audioTime, elapsedBeats, barIndex, ending: elapsedSeconds >= durationSeconds,
						status: complete ? 'completed' : 'playing' });
				};
				cancelPoll = runtime.poll(update);
				update();
			} catch (error) {
				if (!isCurrent()) return;
				release();
				publish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
			}
		},
		stop() {
			if (disposed) return;
			request++; release(); publish({ status: 'stopped', ending: false, error: null });
		},
		dispose() { if (!disposed) { disposed = true; request++; release(); } }
	};
}

let browserLease = 0;
/** Uses the existing sample banks, mix and renderer; no microphone or alternate synthesis path. */
const browserListeningRuntime: ListeningPlayerRuntime = {
	async prepare(params, isCurrent) {
		const [audio, backing, Tone] = await Promise.all([
			import('$lib/audio/audio-context'), import('$lib/audio/backing-track'), import('tone')
		]);
		if (!isCurrent()) return null;
		const context = await audio.initAudio();
		if (!isCurrent()) return null;
		// initAudio initializes once; resume again after tab/browser suspension.
		if (context.state === 'suspended') await context.resume();
		if (!isCurrent()) return null;
		await backing.loadBackingInstruments(params.instrument);
		if (!isCurrent()) return null;
		const lease = ++browserLease;
		const current = () => isCurrent() && lease === browserLease;
		const transport = Tone.getTransport();
		transport.stop(); transport.position = 0; transport.bpm.value = params.tempo;
		backing.setBackingMix(params.mix);
		const generated = await backing.scheduleBackingTrack(params.phrase, {
			tempo: params.tempo, swing: params.swing, countInBeats: 0, metronomeEnabled: false,
			metronomeVolume: 0, backingTrackEnabled: true, backingInstrument: params.instrument,
			backingTrackVolume: params.volume, backingStyle: params.style,
			backingOrchestration: params.orchestration, backingSoloFeatures: params.soloFeatures
		}, 0, false, current);
		if (!generated) return null;
		const schedule = backing.getActiveSchedule();
		const ownsParts = () => browserLease === lease && backing.getActiveSchedule() === schedule;
		const startAudioTime = Tone.now() + 0.05;
		return { generated, ppq: transport.PPQ, startAudioTime, audioNow: () => context.currentTime,
			start() { if (current() && ownsParts()) transport.start(startAudioTime); },
			stop() { if (ownsParts()) { transport.stop(); backing.disposeBackingParts(); } }
		};
	},
	poll(callback) { const timer = setInterval(callback, 40); return () => clearInterval(timer); }
};

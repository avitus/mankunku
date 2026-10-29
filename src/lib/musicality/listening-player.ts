/** A finite, reproducible listening take with a view tied to the sounding audio clock. */
import type { BounceParams } from '$lib/audio/backing-bounce';
import { harmonyDurationBeats, resolveListeningTerminalArrangement } from '$lib/audio/backing-bounce';
import type { GeneratedBacking } from '$lib/audio/backing-generation';
import type { RollingBackingDispatch } from '$lib/audio/backing-rolling-renderer';
import type { RollingSessionSnapshot } from '$lib/audio/backing-rolling-session';
import { fractionToFloat } from '$lib/music/intervals';
import { CURRENT_MUSICALITY_RELEASE, type MusicalityRelease } from './release';

export interface ListeningTakeExtent {
	readonly totalBars: number;
	readonly committedBars: number;
	readonly committedThroughTick: number;
}
export interface CausalListeningProvenance extends ListeningTakeExtent {
	readonly engine: 'causal-rolling';
	readonly sessionId: string;
	readonly fingerprint: string;
	readonly sessionStatus: RollingSessionSnapshot['status'];
	readonly dispatches: readonly RollingBackingDispatch[];
}
export type ListeningTakeProvenance = CausalListeningProvenance | (ListeningTakeExtent & { readonly engine: 'fixed' });

export type ListeningStatus = 'idle' | 'loading' | 'playing' | 'stopped' | 'completed' | 'error';
export interface ListeningSnapshot {
	status: ListeningStatus;
	/** Captured engine release; absent on takes made before release versioning. */
	readonly musicalityRelease?: Readonly<MusicalityRelease>;
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
	/** Actual generation/dispatch evidence; absent on older archived takes. */
	provenance?: ListeningTakeProvenance;
}
export interface PreparedListeningTake {
	generated: GeneratedBacking;
	ppq: number;
	startAudioTime: number;
	audioNow(): number;
	start(): void;
	/** Releases only this take's scheduled parts/voices, never a newer owner's graph. */
	stop(): void;
	/** Read committed evidence only. Generation is driven by the independent audio scheduler pump. */
	progress?(): { generated: GeneratedBacking; provenance: CausalListeningProvenance; error: string | null };
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
	const stoppedEvidence = (prepared: PreparedListeningTake | null) => {
		try { return prepared?.progress?.(); } catch { return undefined; }
	};
	return {
		snapshot: () => state,
		async start(input: BounceParams): Promise<void> {
			if (disposed) return;
			const id = ++request;
			release();
			const isCurrent = () => !disposed && id === request;
			publish({ status: 'loading', generated: null, params: null, startAudioTime: null,
				audioTime: null, elapsedBeats: 0, durationBeats: 0, barIndex: null, ending: false, error: null, provenance: undefined, musicalityRelease: undefined });
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
					musicalityRelease: CURRENT_MUSICALITY_RELEASE,
					startAudioTime: prepared.startAudioTime, durationBeats,
					provenance: prepared.progress ? undefined : { engine: 'fixed', totalBars: Math.ceil(durationBeats / params.phrase.timeSignature[0]),
						committedBars: Math.ceil(durationBeats / params.phrase.timeSignature[0]), committedThroughTick: durationBeats * prepared.ppq } });
				const update = () => {
					if (!isCurrent() || state.status !== 'playing') return;
					try {
					const progress = prepared.progress?.();
					if (progress) {
						publish({ generated: progress.generated, provenance: progress.provenance });
						if (progress.error || ['failed', 'stopped'].includes(progress.provenance.sessionStatus)) {
							throw new Error(progress.error ?? 'Causal playback stopped before completion.');
						}
					}
					const audioTime = prepared.audioNow();
					if (!Number.isFinite(audioTime)) throw new Error('The audio clock is unavailable.');
					const elapsedSeconds = Math.max(0, audioTime - prepared.startAudioTime);
					const durationSeconds = durationBeats * 60 / params.tempo;
					const elapsedBeats = Math.min(durationBeats, elapsedSeconds * params.tempo / 60);
					const barIndex = audioTime < prepared.startAudioTime ? null
						: Math.min(Math.ceil(durationBeats / params.phrase.timeSignature[0]) - 1,
							Math.floor(elapsedBeats / params.phrase.timeSignature[0]));
					const tailFinished = elapsedSeconds >= durationSeconds + RELEASE_TAIL_SECONDS;
					const p = progress?.provenance;
					const finished = !p || p.sessionStatus === 'complete';
					if (p?.sessionStatus === 'complete' && (p.committedBars !== p.totalBars ||
						p.totalBars !== Math.ceil(durationBeats / params.phrase.timeSignature[0]) ||
						p.committedThroughTick !== durationBeats * prepared.ppq || p.dispatches.some(entry => entry.status !== 'played'))) {
						throw new Error('Causal playback is incomplete.');
					}
					const complete = tailFinished && finished;
					if (complete) release();
					publish({ audioTime, elapsedBeats, barIndex, ending: elapsedSeconds >= durationSeconds,
						status: complete ? 'completed' : 'playing' });
					} catch (error) {
						release();
						const final = stoppedEvidence(prepared);
						publish({ ...(final ? { generated: final.generated, provenance: final.provenance } : {}), status: 'error', ending: false,
							error: error instanceof Error ? error.message : String(error) });
					}
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
			request++; const previous = take; release(); const final = stoppedEvidence(previous);
			publish({ ...(final ? { generated: final.generated, provenance: final.provenance } : {}), status: 'stopped', ending: false, error: null });
		},
		dispose() { if (!disposed) { disposed = true; request++; release(); } }
	};
}

let browserLease = 0;
/** Uses the existing sample banks, mix and renderer; no microphone or alternate synthesis path. */
const browserListeningRuntime: ListeningPlayerRuntime = {
	async prepare(params, isCurrent) {
		const terminalArrangement = resolveListeningTerminalArrangement(params);
		const lease = ++browserLease;
		const current = () => isCurrent() && lease === browserLease;
		const [audio, backing, Tone] = await Promise.all([
			import('$lib/audio/audio-context'), import('$lib/audio/backing-track'), import('tone')
		]);
		if (!current()) return null;
		const context = await audio.initAudio();
		if (!current()) return null;
		// initAudio initializes once; resume again after tab/browser suspension.
		if (context.state === 'suspended') await context.resume();
		if (!current()) return null;
		await backing.loadBackingInstruments(params.instrument);
		if (!current()) return null;
		const transport = Tone.getTransport();
		if (params.orchestration === 'coordinated') {
			const [{ createRollingBacking, advanceRollingBacking }, { createRollingSession }, { aggregateRollingBacking },
				{ BACKING_STYLES }, { resolveBackingSwing }] = await Promise.all([
				import('$lib/audio/backing-rolling'), import('$lib/audio/backing-rolling-session'), import('$lib/audio/backing-rolling-take'),
				import('$lib/audio/backing-styles'), import('$lib/audio/backing-generation')
			]);
			if (!current()) return null;
			const durationBeats = harmonyDurationBeats(params.phrase);
			if (params.phrase.timeSignature[0] !== 4 || params.phrase.timeSignature[1] !== 4 || !params.phrase.performanceForm ||
				params.phrase.notes.some(note => (fractionToFloat(note.offset) + fractionToFloat(note.duration)) * 4 > durationBeats + 1e-8)) {
				throw new Error('Coordinated listening requires a complete 4/4 performed form covering the melody.');
			}
			const style = BACKING_STYLES[params.style];
			const definition = createRollingBacking(params.phrase.harmony, style, { phraseId: params.phrase.id, tempo: params.tempo,
				ppq: transport.PPQ, beatsPerBar: 4, swing: resolveBackingSwing(params.swing, style, params.tempo),
				sectionMap: params.phrase.sectionMap, performanceForm: params.phrase.performanceForm, ensemble: {},
				...(terminalArrangement ? { terminalArrangement } : {}) });
			transport.stop(); transport.position = 0; transport.bpm.value = params.tempo;
			backing.setBackingMix(params.mix); backing.setBackingTrackVolume(params.volume);
			let playbackError: string | null = null;
			const playback = await backing.createRollingBackingPlayback({ sessionId: definition.sessionId, tempo: params.tempo,
				ppq: definition.ppq, totalBars: definition.totalBars, isCurrent: current,
				onUnderrun: reason => { playbackError = `Audio scheduling stopped: ${reason}`; } });
			if (!current()) { playback.stop(); return null; }
			let generated = aggregateRollingBacking(playback.snapshot());
			let committedBars = 0;
			let timer: ReturnType<typeof setInterval> | null = null;
			const clearPump = () => { if (timer !== null) clearInterval(timer); timer = null; };
			const session = createRollingSession({ definition, renderer: playback, startAudioTime: playback.startAudioTime,
				observationSessionId: definition.sessionId, releaseTailSeconds: RELEASE_TAIL_SECONDS,
				generate: (score, checkpoint) => advanceRollingBacking(score, checkpoint, params.soloFeatures),
				measureNow: () => performance.now() / 1000,
				onError: reason => { playbackError = `Audio scheduling stopped: ${reason}`; clearPump(); },
				onComplete: clearPump });
			return { generated, ppq: definition.ppq, startAudioTime: playback.startAudioTime,
				audioNow() { if (context.state !== 'running') throw new Error('Audio context is suspended. Start a new take.'); return context.currentTime; },
				start() {
					if (!current() || !playback.ownsOutput()) throw new Error('This listening take no longer owns the audio output.');
					session.start();
					if (session.snapshot().status !== 'running') throw new Error(playbackError ?? 'The causal take could not start.');
					transport.start(playback.startAudioTime);
					timer = setInterval(() => {
						if (!current() || !playback.ownsOutput()) { playbackError = 'This listening take no longer owns the audio output.'; session.stop(); clearPump(); return; }
						session.pump();
					}, 25);
				},
				progress() {
					const snapshot = playback.snapshot();
					if (committedBars !== snapshot.nextBar) { generated = aggregateRollingBacking(snapshot); committedBars = snapshot.nextBar; }
					const state = session.snapshot();
					const ownershipError = state.status !== 'stopped' && !playback.ownsOutput()
						? 'This listening take no longer owns the audio output.' : null;
					return { generated, error: playbackError ?? state.error ?? ownershipError,
						provenance: Object.freeze({ engine: 'causal-rolling' as const, sessionId: definition.sessionId,
							fingerprint: definition.fingerprint, totalBars: definition.totalBars, committedBars,
							committedThroughTick: snapshot.committedThroughTick, sessionStatus: state.status, dispatches: snapshot.dispatches }) };
				},
				stop() { clearPump(); session.stop(); if (playback.ownsOutput()) transport.stop(); }
			};
		}
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
		const ownsParts = () => backing.getActiveSchedule() === schedule;
		const startAudioTime = Tone.now() + 0.05;
		return { generated, ppq: transport.PPQ, startAudioTime, audioNow: () => context.currentTime,
			start() { if (current() && ownsParts()) transport.start(startAudioTime); },
			stop() { if (ownsParts()) { transport.stop(); backing.disposeBackingParts(); } }
		};
	},
	poll(callback) { const timer = setInterval(callback, 40); return () => clearInterval(timer); }
};

/** Append-only audio scheduling for the finite coordinated listening lab. */
import type { BassEvent, CompEvent, DrumEvent } from './backing-generation';
import type { RollingBackingBar } from './backing-rolling';
import { buildSchedule, type BackingTrackSchedule } from './backing-track-schedule';
import type { BackingHit } from './turnaround-bar';
import { DRUM_FAMILY_BY_VOICE } from './sample-maps';

export interface RollingBackingRendererOptions {
	sessionId: string;
	tempo: number;
	ppq: number;
	totalBars: number;
	startAudioTime: number;
	maxComputeSeconds?: number;
	safetySeconds?: number;
	onUnderrun?(reason: string): void;
}

export interface RollingBackingRuntime {
	audioNow(): number;
	lookAhead(): number;
	updateInterval(): number;
	isCurrent(): boolean;
	scheduleOnce(callback: (audioTime: number) => void, tickTime: string): number;
	clear(id: number): void;
	play(hits: readonly BackingHit[], audioTime: number, eventKey: string): () => void;
	publishSchedule(schedule: BackingTrackSchedule | null): void;
}

export interface RollingBackingHorizon {
	audioNow: number;
	dispatchThrough: number;
	renderSafeFrom: number;
}

export interface RollingBackingDispatch {
	readonly tick: number;
	readonly audioTime: number;
	readonly status: 'scheduled' | 'played' | 'cancelled' | 'late' | 'failed';
}

export interface RollingBackingSnapshot {
	readonly sessionId: string;
	readonly status: 'active' | 'stopped' | 'underrun';
	readonly nextBar: number;
	readonly checkpointId: string | null;
	readonly committedThroughTick: number;
	readonly windows: readonly RollingBackingBar[];
	readonly generated: {
		readonly bassEvents: readonly BassEvent[];
		readonly compEvents: readonly CompEvent[];
		readonly drumEvents: readonly DrumEvent[];
	};
	readonly schedule: BackingTrackSchedule | null;
	readonly dispatches: readonly RollingBackingDispatch[];
}

export type RollingBackingCommitResult =
	| { accepted: true; nextBar: number; committedThroughTick: number }
	| { accepted: false; reason: 'stopped' | 'stale_session' | 'out_of_order' | 'invalid_window' | 'compute_budget' | 'deadline' | 'schedule_failure' };

export interface RollingBackingRenderer {
	readonly startAudioTime: number;
	horizon(): RollingBackingHorizon;
	commit(window: RollingBackingBar, timing?: { renderStartedAt: number; renderElapsedSeconds: number }): RollingBackingCommitResult;
	snapshot(): RollingBackingSnapshot;
	stop(): void;
}

export function createRollingBackingRenderer(
	options: RollingBackingRendererOptions,
	runtime: RollingBackingRuntime
): RollingBackingRenderer {
	const maxCompute = options.maxComputeSeconds ?? 0.025;
	const safety = options.safetySeconds ?? 0.01;
	if (!options.sessionId || !Number.isFinite(options.tempo) || options.tempo < 30 || options.tempo > 320 ||
		!Number.isSafeInteger(options.ppq) || options.ppq <= 0 ||
		!Number.isInteger(options.totalBars) || options.totalBars < 1 || options.totalBars > 128 ||
		!Number.isFinite(options.startAudioTime) || options.startAudioTime < 0 ||
		!Number.isFinite(maxCompute) || maxCompute <= 0 || maxCompute > 0.1 ||
		!Number.isFinite(safety) || safety < 0 || safety > 0.1) throw new RangeError('Invalid rolling renderer configuration');
	const secondsPerTick = 60 / options.tempo / options.ppq;
	const barTicks = 4 * options.ppq;
	let status: RollingBackingSnapshot['status'] = 'active';
	let nextBar = 0;
	let checkpointId: string | null = null;
	let fingerprint: string | null = null;
	let windows: readonly RollingBackingBar[] = Object.freeze([]);
	let generated: RollingBackingSnapshot['generated'] = Object.freeze({
		bassEvents: Object.freeze([]), compEvents: Object.freeze([]), drumEvents: Object.freeze([])
	});
	let schedule: BackingTrackSchedule | null = null;
	const dispatches: { tick: number; audioTime: number; status: RollingBackingDispatch['status'] }[] = [];
	const pending = new Map<number, typeof dispatches[number]>();
	const voiceStops = new Set<() => void>();

	function horizon(): RollingBackingHorizon {
		const audioNow = runtime.audioNow();
		const lookAhead = runtime.lookAhead();
		const interval = runtime.updateInterval();
		if (![audioNow, lookAhead, interval].every((n) => Number.isFinite(n) && n >= 0)) {
			throw new RangeError('Invalid rolling audio clock');
		}
		const dispatchThrough = audioNow + lookAhead + interval + safety;
		return { audioNow, dispatchThrough, renderSafeFrom: dispatchThrough + maxCompute };
	}

	function snapshot(): RollingBackingSnapshot {
		return Object.freeze({ sessionId: options.sessionId, status, nextBar, checkpointId,
			committedThroughTick: nextBar * barTicks, windows, generated, schedule,
			dispatches: Object.freeze(dispatches.map((entry) => Object.freeze({ ...entry }))) });
	}

	function stop(): void {
		if (status === 'active') status = 'stopped';
		for (const [id, entry] of pending) {
			if (entry.status === 'scheduled') entry.status = 'cancelled';
			try { runtime.clear(id); } catch { /* Continue releasing other owned events. */ }
		}
		pending.clear();
		for (const release of voiceStops) {
			try { release(); } catch { /* Continue releasing other owned voices. */ }
		}
		voiceStops.clear();
		if (schedule !== null) {
			schedule = null;
			if (runtime.isCurrent()) runtime.publishSchedule(null);
		}
	}

	function underrun(reason: string): void {
		if (status !== 'active') return;
		status = 'underrun';
		stop();
		options.onUnderrun?.(reason);
	}

	function validWindow(window: RollingBackingBar): boolean {
		const start = nextBar * barTicks;
		const end = start + barTicks;
		if (window.version !== 1 || window.startTick !== start || window.committedThroughTick !== end ||
			window.toBarExclusive !== nextBar + 1 || window.toBarExclusive > options.totalBars ||
			window.checkpoint?.version !== 1 || window.checkpoint.nextBar !== nextBar + 1 ||
			window.checkpoint.sessionId !== options.sessionId ||
			typeof window.checkpoint.fingerprint !== 'string' || !window.checkpoint.fingerprint ||
			(fingerprint !== null && window.checkpoint.fingerprint !== fingerprint) ||
			typeof window.checkpoint.checkpointId !== 'string' || !window.checkpoint.checkpointId ||
			window.checkpoint.checkpointId === checkpointId ||
			![window.bassEvents, window.compEvents, window.drumEvents].every(Array.isArray)) return false;
		const all = [...window.bassEvents, ...window.compEvents, ...window.drumEvents];
		if (all.length > 256) return false;
		let earliest = end;
		for (const event of all) {
			if (!/^\d+i$/.test(event.time)) return false;
			const tick = Number.parseInt(event.time, 10);
			if (!Number.isSafeInteger(tick) || tick < start || tick >= end ||
				!Number.isFinite(event.velocity) || event.velocity < 0) return false;
			earliest = Math.min(earliest, tick);
			if ('duration' in event && (!Number.isFinite(event.duration) || event.duration <= 0 ||
				tick * secondsPerTick + event.duration > end * secondsPerTick + 1e-8)) return false;
		}
		if (window.earliestTick !== (all.length ? earliest : start)) return false;
		const validMidi = (midi: number) => Number.isInteger(midi) && midi >= 0 && midi <= 127;
		return window.bassEvents.every((event) => validMidi(event.midi) && event.velocity <= 127) &&
			window.compEvents.every((event) => event.velocity <= 127 && Array.isArray(event.notes) &&
				event.notes.length > 0 && event.notes.length <= 12 && event.notes.every(validMidi)) &&
			window.drumEvents.every((event) => event.velocity <= 1 && Object.hasOwn(DRUM_FAMILY_BY_VOICE, event.drum));
	}

	function commit(window: RollingBackingBar, timing?: { renderStartedAt: number; renderElapsedSeconds: number }): RollingBackingCommitResult {
		if (status !== 'active') return { accepted: false, reason: 'stopped' };
		if (!runtime.isCurrent() || window.sessionId !== options.sessionId) return { accepted: false, reason: 'stale_session' };
		if (window.fromBar !== nextBar || window.previousCheckpointId !== checkpointId) return { accepted: false, reason: 'out_of_order' };
		try { if (!validWindow(window)) return { accepted: false, reason: 'invalid_window' }; }
		catch { return { accepted: false, reason: 'invalid_window' }; }
		const before = horizon();
		if (timing && (!Number.isFinite(timing.renderStartedAt) || timing.renderStartedAt > before.audioNow ||
			!Number.isFinite(timing.renderElapsedSeconds) || timing.renderElapsedSeconds < 0 || timing.renderElapsedSeconds > maxCompute)) {
			return { accepted: false, reason: 'compute_budget' };
		}
		const earliestAudioTime = options.startAudioTime + window.earliestTick * secondsPerTick;
		if (earliestAudioTime <= before.dispatchThrough) return { accepted: false, reason: 'deadline' };
		let copied: RollingBackingBar;
		try { copied = deepFreeze(structuredClone(window)); }
		catch { return { accepted: false, reason: 'invalid_window' }; }
		const nextGenerated = Object.freeze({
			bassEvents: Object.freeze([...generated.bassEvents, ...copied.bassEvents]),
			compEvents: Object.freeze([...generated.compEvents, ...copied.compEvents]),
			drumEvents: Object.freeze([...generated.drumEvents, ...copied.drumEvents])
		});
		// Building a query index over committed event history does not rerun
		// musical generation. These exact arrays are the only evidence published.
		const nextSchedule = deepFreeze(buildSchedule([...nextGenerated.bassEvents], [...nextGenerated.compEvents],
			[...nextGenerated.drumEvents], 0, options.ppq, options.tempo));
		const groups = new Map<number, BackingHit[]>();
		const add = (time: string, hit: BackingHit) => {
			const tick = Number.parseInt(time, 10);
			if (!groups.has(tick)) groups.set(tick, []);
			groups.get(tick)!.push(hit);
		};
		for (const event of copied.bassEvents) add(event.time, { kind: 'bass', midi: event.midi, velocity: event.velocity, duration: event.duration });
		for (const event of copied.compEvents) add(event.time, { kind: 'comp', notes: event.notes, velocity: event.velocity, duration: event.duration });
		for (const event of copied.drumEvents) add(event.time, { kind: 'drum', drum: event.drum, velocity: event.velocity });
		const prepared: { id: number; entry: typeof dispatches[number] }[] = [];
		let activated = false;
		const rollback = () => {
			for (const { id } of prepared) { try { runtime.clear(id); } catch { /* Inactive callbacks cannot play. */ } }
		};
		try {
			for (const [tick, hits] of [...groups.entries()].sort(([a], [b]) => a - b)) {
				const entry: typeof dispatches[number] = { tick, audioTime: options.startAudioTime + tick * secondsPerTick, status: 'scheduled' };
				const id = runtime.scheduleOnce((audioTime) => {
					if (!activated || status !== 'active' || entry.status !== 'scheduled') return;
					if (!runtime.isCurrent()) { stop(); return; }
					pending.delete(id);
					let now: number;
					try { now = runtime.audioNow(); }
					catch { entry.status = 'failed'; underrun('Audio context is unavailable'); return; }
					if (!Number.isFinite(now) || !Number.isFinite(audioTime) || audioTime < now || Math.abs(audioTime - entry.audioTime) > 1e-6) {
						entry.status = 'late'; underrun('Audio callback missed its committed time'); return;
					}
					try {
						const release = runtime.play(hits, audioTime, `${copied.fromBar}:${tick}`);
						if (status !== 'active' || !runtime.isCurrent()) {
							entry.status = 'cancelled'; release(); stop(); return;
						}
						voiceStops.add(release);
						entry.status = 'played';
					} catch {
						entry.status = 'failed'; underrun('Backing instrument could not play a committed batch');
					}
				}, `${tick}i`);
				prepared.push({ id, entry });
			}
			if (!runtime.isCurrent() || status !== 'active') {
				rollback(); return { accepted: false, reason: 'stale_session' };
			}
			if (earliestAudioTime <= horizon().dispatchThrough) {
				rollback(); return { accepted: false, reason: 'deadline' };
			}
			runtime.publishSchedule(nextSchedule);
			if (!runtime.isCurrent() || status !== 'active') {
				rollback(); return { accepted: false, reason: 'stale_session' };
			}
			if (earliestAudioTime <= horizon().dispatchThrough) {
				rollback(); runtime.publishSchedule(schedule); return { accepted: false, reason: 'deadline' };
			}
		} catch {
			try { rollback(); } catch { /* Inactive callbacks cannot play even if clear fails. */ }
			// A publisher that threw after assigning must restore the old index.
			if (runtime.isCurrent()) { try { runtime.publishSchedule(schedule); } catch { /* Caller reports scheduling failure. */ } }
			return { accepted: false, reason: 'schedule_failure' };
		}
		generated = nextGenerated;
		schedule = nextSchedule;
		windows = Object.freeze([...windows, copied]);
		nextBar = copied.toBarExclusive;
		checkpointId = copied.checkpoint.checkpointId;
		fingerprint = copied.checkpoint.fingerprint;
		for (const { id, entry } of prepared) { pending.set(id, entry); dispatches.push(entry); }
		activated = true;
		return { accepted: true, nextBar, committedThroughTick: nextBar * barTicks };
	}

	return { startAudioTime: options.startAudioTime, horizon, commit, snapshot, stop };
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

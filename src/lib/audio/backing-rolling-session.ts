/** Causal clock-driven coordinator for a finite rolling listening-lab take. */
import type { SoloObservationWindow } from './solo-observer';
import type { SoloFeature } from './ensemble-plan';
import type { RollingBackingBar, RollingBackingCheckpoint, RollingBackingDefinition } from './backing-rolling';

export interface RollingSessionPort {
	horizon(): { audioNow: number; dispatchThrough: number; renderSafeFrom: number };
	commit(bar: RollingBackingBar, timing: { renderStartedAt: number; renderElapsedSeconds: number }): { accepted: boolean; reason?: string };
	snapshot(): { status: string; dispatches: readonly { status: string }[] };
	stop(): void;
}
export interface RollingSessionOptions {
	definition: RollingBackingDefinition;
	startAudioTime: number;
	observationSessionId: string;
	renderer: RollingSessionPort;
	generate(definition: RollingBackingDefinition, checkpoint?: RollingBackingCheckpoint, features?: readonly SoloFeature[]): RollingBackingBar;
	/** Monotonic wall clock, seconds; measures computation even while audio is suspended. */
	measureNow(): number;
	onCommit?(bar: RollingBackingBar): void;
	onError?(reason: string): void;
	onComplete?(): void;
}
export interface RollingObservationReceipt {
	readonly windowBar: number;
	readonly availableAtSeconds: number;
	readonly receivedAtSeconds: number;
	readonly nextBarAtReceipt: number;
	readonly feature: SoloFeature;
}
export interface RollingSessionSnapshot {
	readonly status: 'ready' | 'running' | 'complete' | 'stopped' | 'failed';
	readonly nextBar: number;
	readonly error: string | null;
	readonly receipts: readonly RollingObservationReceipt[];
}

/**
 * Prime two bars, then commit just before the measured scheduling horizon.
 * The 75 ms pump margin accommodates the browser's 25 ms timer cadence;
 * the renderer independently rechecks its deadline after computation.
 * A stalled clock stops the take: there is never a burst of overdue notes.
 */
export function createRollingSession(options: RollingSessionOptions) {
	const { definition, renderer } = options;
	const barSeconds = 240 / definition.tempo;
	let status: RollingSessionSnapshot['status'] = 'ready';
	let error: string | null = null;
	let checkpoint: RollingBackingCheckpoint | undefined;
	let nextBar = 0;
	const receipts: RollingObservationReceipt[] = [];
	const seen = new Set<number>();
	function fail(reason: string): void {
		if (status !== 'running') return;
		status = 'failed'; error = reason;
		renderer.stop(); options.onError?.(reason);
	}
	function commit(): void {
		let horizon: ReturnType<RollingSessionPort['horizon']>;
		try { horizon = renderer.horizon(); } catch { fail('audio_clock'); return; }
		const barStart = options.startAudioTime + nextBar * barSeconds;
		if (!Number.isFinite(horizon.audioNow) || !Number.isFinite(horizon.renderSafeFrom) || barStart <= horizon.renderSafeFrom) {
			fail('deadline'); return;
		}
		try {
			const before = options.measureNow();
			const bar = options.generate(definition, checkpoint, receipts.map((receipt) => receipt.feature));
			const result = renderer.commit(bar, { renderStartedAt: horizon.audioNow, renderElapsedSeconds: options.measureNow() - before });
			if (!result.accepted) { fail(result.reason ?? 'commit_rejected'); return; }
			checkpoint = bar.checkpoint; nextBar = bar.toBarExclusive;
			options.onCommit?.(bar);
		} catch (cause) { fail(cause instanceof Error ? cause.message : String(cause)); }
	}
	function pump(): void {
		if (status !== 'running') return;
		let horizon: ReturnType<RollingSessionPort['horizon']>;
		try { horizon = renderer.horizon(); } catch { fail('audio_clock'); return; }
		if (horizon.audioNow >= options.startAudioTime + definition.totalBars * barSeconds) {
			if (nextBar !== definition.totalBars) { fail('deadline'); return; }
			const playback = renderer.snapshot();
			if (playback.status !== 'active' || playback.dispatches.some((entry) => entry.status !== 'played')) { fail('incomplete_playback'); return; }
			status = 'complete'; renderer.stop(); options.onComplete?.(); return;
		}
		if (nextBar < definition.totalBars && options.startAudioTime + nextBar * barSeconds <= horizon.renderSafeFrom + 0.075) commit();
	}
	return {
		start(): void {
			if (status !== 'ready') return;
			status = 'running';
			for (let n = 0; n < Math.min(2, definition.totalBars) && status === 'running'; n++) commit();
		},
		pump,
		observe(window: SoloObservationWindow): boolean {
			let receivedAtSeconds: number;
			try { receivedAtSeconds = renderer.horizon().audioNow - options.startAudioTime; } catch { return false; }
			const feature = window.feature;
			if (status !== 'running' || window.sessionId !== options.observationSessionId || !feature ||
				window.source !== 'microphone' || feature.source !== 'microphone' ||
				!Number.isInteger(window.barIndex) || window.barIndex < 0 || window.barIndex >= definition.totalBars || seen.has(window.barIndex) ||
				!Number.isFinite(receivedAtSeconds) || !Number.isFinite(window.availableAtSeconds) ||
				window.availableAtSeconds < (window.barIndex + 1) * barSeconds || window.availableAtSeconds > receivedAtSeconds + 1e-6 ||
				!Number.isInteger(feature.barIndex) || feature.barIndex < Math.ceil(window.availableAtSeconds / barSeconds) || feature.barIndex >= definition.totalBars ||
				feature.observedAtBar !== Math.floor(window.availableAtSeconds / barSeconds) ||
				!Number.isFinite(feature.confidence) || feature.confidence < 0.7 || feature.confidence > 1 ||
				!Number.isFinite(feature.noteDensity) || feature.noteDensity < 0 || feature.noteDensity > 1 ||
				!Number.isFinite(feature.restBeats) || feature.restBeats < 0) return false;
			seen.add(window.barIndex);
			receipts.push(Object.freeze({ windowBar: window.barIndex, availableAtSeconds: window.availableAtSeconds,
				receivedAtSeconds, nextBarAtReceipt: nextBar, feature: Object.freeze({ ...feature }) }));
			return true;
		},
		stop(): void {
			if (status === 'complete' || status === 'failed' || status === 'stopped') return;
			status = 'stopped'; renderer.stop();
		},
		snapshot(): RollingSessionSnapshot { return Object.freeze({ status, nextBar, error, receipts: Object.freeze([...receipts]) }); }
	};
}

export type RollingSession = ReturnType<typeof createRollingSession>;

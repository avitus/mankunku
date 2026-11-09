/** Read-only PCM taps after instrument mix gains, before the backing/master buses. */
export interface BackingSignalLevel {
	readonly peak: number;
	/** Largest peak observed by read(), not a continuous recording of the take. */
	readonly peakSoFar: number;
}
export interface BackingSignalSnapshot {
	readonly bass: BackingSignalLevel | null;
	readonly comp: BackingSignalLevel | null;
	readonly drums: BackingSignalLevel | null;
}
export interface BackingSignalMonitor {
	read(): BackingSignalSnapshot | null;
	dispose(): void;
}
type Instrument = keyof BackingSignalSnapshot;
const instruments: readonly Instrument[] = ['bass', 'comp', 'drums'];

/**
 * An unconnected analyser output observes its input without rerouting it.
 * No microphone, destination connection, timer, gain or scheduling mutation.
 * Null is unavailable evidence; a zero peak is a successfully sampled silence.
 */
export function createSignalMonitor(sources: Partial<Record<Instrument, AudioNode | null>>,
	isCurrent: () => boolean = () => true): BackingSignalMonitor | null {
	const taps = new Map<Instrument, { source: AudioNode; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; peakSoFar: number }>();
	let disposed = false;
	for (const instrument of instruments) {
		const source = sources[instrument];
		if (!source) continue;
		let analyser: AnalyserNode | undefined;
		try {
			analyser = source.context.createAnalyser();
			analyser.fftSize = 2048;
			source.connect(analyser);
			taps.set(instrument, { source, analyser, samples: new Float32Array(analyser.fftSize), peakSoFar: 0 });
		} catch {
			// A failed diagnostic must neither interrupt playback nor retain a partial tap.
			if (analyser) {
				try { source.disconnect(analyser); } catch { /* Edge may not exist. */ }
				try { analyser.disconnect(); } catch { /* Context may be closed. */ }
			}
		}
	}
	if (!taps.size) return null;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const { source, analyser } of taps.values()) {
			try { source.disconnect(analyser); } catch { /* Parent graph may already be disposed. */ }
			try { analyser.disconnect(); } catch { /* Context may be closed. */ }
		}
		taps.clear();
	};
	return {
		read() {
			if (disposed) return null;
			if (!isCurrent()) { dispose(); return null; }
			const snapshot: { -readonly [K in Instrument]: BackingSignalLevel | null } = { bass: null, comp: null, drums: null };
			for (const [instrument, tap] of taps) {
				if (tap.source.context.state !== 'running') continue;
				try {
					tap.analyser.getFloatTimeDomainData(tap.samples);
					let peak = 0;
					for (const sample of tap.samples) { if (!Number.isFinite(sample)) throw new Error('Invalid PCM'); peak = Math.max(peak, Math.abs(sample)); }
					tap.peakSoFar = Math.max(tap.peakSoFar, peak);
					snapshot[instrument] = Object.freeze({ peak, peakSoFar: tap.peakSoFar });
				} catch { /* Missing measurement is not evidence of silence. */ }
			}
			return Object.freeze(snapshot);
		}, dispose
	};
}

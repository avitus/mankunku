/** Export only the renderer's committed prefix, never a regenerated future score. */
import type { GeneratedBacking } from './backing-generation';
import type { RollingBackingSnapshot } from './backing-rolling-renderer';
import { MAX_ADAPTIVE_BARS } from './backing-performance-limits';

/** Cache the returned value when a new bar commits, not on every UI clock poll. */
export function aggregateRollingBacking(snapshot: RollingBackingSnapshot): GeneratedBacking {
	const invalid = () => { throw new Error('Invalid rolling committed prefix'); };
	const { windows, generated, nextBar } = snapshot;
	if (!Number.isSafeInteger(nextBar) || nextBar < 0 || nextBar > MAX_ADAPTIVE_BARS || windows.length !== nextBar) invalid();
	const barTicks = windows[0]?.committedThroughTick ?? 0;
	if (nextBar > 0 && (!Number.isSafeInteger(barTicks) || barTicks <= 0)) invalid();
	for (const [index, bar] of windows.entries()) {
		if (bar.sessionId !== snapshot.sessionId || bar.fromBar !== index || bar.toBarExclusive !== index + 1 ||
			bar.startTick !== index * barTicks || bar.committedThroughTick !== (index + 1) * barTicks ||
			bar.previousCheckpointId !== (windows[index - 1]?.checkpoint.checkpointId ?? null)) invalid();
	}
	const last = windows.at(-1);
	if (snapshot.committedThroughTick !== (last?.committedThroughTick ?? 0) ||
		snapshot.checkpointId !== (last?.checkpoint.checkpointId ?? null)) invalid();
	for (const event of [...generated.bassEvents, ...generated.compEvents, ...generated.drumEvents]) {
		const tick = Number.parseInt(event.time, 10);
		if (!/^\d+i$/.test(event.time) || !Number.isSafeInteger(tick) || tick < 0 || tick >= snapshot.committedThroughTick ||
			!Number.isFinite(event.absBeat) || event.absBeat < 0 || event.absBeat >= nextBar * 4) invalid();
	}
	const result: GeneratedBacking = { bassEvents: [...generated.bassEvents], compEvents: [...generated.compEvents],
		drumEvents: [...generated.drumEvents] };
	if (last) {
		result.ensemblePlan = { version: 1, bars: windows.flatMap((bar) => bar.ensemblePlan.bars),
			trace: windows.flatMap((bar) => bar.ensemblePlan.trace) };
		result.ensembleMemory = last.checkpoint.ensemble;
		// Phrase timing is latched, then repeated in each owned bar. Export each
		// committed phrase once without constructing any future timing choices.
		const timing = new Map<number, NonNullable<GeneratedBacking['ensembleTiming']>[number]>();
		for (const bar of windows) for (const trace of bar.ensembleTiming) {
			if (!timing.has(trace.phraseStartBar)) timing.set(trace.phraseStartBar, trace);
		}
		result.ensembleTiming = [...timing.values()];
		const bassContinuations = windows.flatMap((bar) => bar.ensembleDevelopment.bassContinuations ?? []);
		const bassFeel = windows.flatMap((bar) => bar.ensembleDevelopment.bassFeel ?? []);
		const pianoVoicings = windows.flatMap((bar) => bar.ensembleDevelopment.pianoVoicings ?? []);
		const pianoAnswers = windows.flatMap((bar) => bar.ensembleDevelopment.pianoAnswers ?? []);
		const pianoFeedback = windows.flatMap((bar) => bar.ensembleDevelopment.pianoFeedback ?? []);
		result.ensembleDevelopment = { version: 1,
			pianoMotifs: windows.flatMap((bar) => bar.ensembleDevelopment.pianoMotifs),
			bassTurnarounds: windows.flatMap((bar) => bar.ensembleDevelopment.bassTurnarounds),
			...(bassContinuations.length ? { bassContinuations } : {}),
			...(bassFeel.length ? { bassFeel } : {}), ...(pianoVoicings.length ? { pianoVoicings } : {}),
			...(pianoFeedback.length ? { pianoFeedback } : {}), ...(pianoAnswers.length ? { pianoAnswers } : {}),
			drumPhrases: windows.flatMap((bar) => bar.ensembleDevelopment.drumPhrases)
		};
	}
	// Copy only the JSON-safe musical projection, not the live schedule index.
	// A restored caller snapshot stays mutable and cannot rewrite this export.
	return freeze(structuredClone(result));
}

function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

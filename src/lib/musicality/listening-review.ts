import type { ListeningSnapshot } from './listening-player';

export interface ListeningReviewExtent {
	readonly firstBarIndex: 0;
	readonly lastBarIndex: number;
	readonly barCount: number;
}

/**
 * A visual review is limited to committed bars reached by this take's audio
 * clock. Committed lookahead can have been cancelled, and a reached bar can
 * be only partly heard: this is scheduled evidence, not proof of audibility.
 * Missing historical provenance is not reconstructed from note counts.
 */
export function getListeningReviewExtent(snapshot: ListeningSnapshot, totalBars: number): ListeningReviewExtent | null {
	const { params, provenance, startAudioTime, audioTime, barIndex, elapsedBeats, durationBeats, ppq } = snapshot;
	if (!['stopped', 'completed', 'error'].includes(snapshot.status) || !snapshot.generated || !params || !provenance ||
		!Number.isSafeInteger(totalBars) || totalBars < 1 || !Number.isSafeInteger(ppq) || ppq <= 0 ||
		params.phrase?.timeSignature?.[0] !== 4 || params.phrase.timeSignature[1] !== 4 ||
		!Number.isFinite(params.tempo) || params.tempo <= 0 ||
		startAudioTime === null || audioTime === null || !Number.isFinite(startAudioTime) || !Number.isFinite(audioTime) ||
		startAudioTime < 0 || audioTime < startAudioTime ||
		barIndex === null || !Number.isSafeInteger(barIndex) || barIndex < 0 || barIndex >= totalBars ||
		!Number.isFinite(elapsedBeats) || elapsedBeats < 0 || elapsedBeats > durationBeats || durationBeats !== totalBars * 4 ||
		!['fixed', 'causal-rolling'].includes(provenance.engine) || provenance.totalBars !== totalBars ||
		!Number.isSafeInteger(provenance.committedBars) || provenance.committedBars < 1 || provenance.committedBars > totalBars ||
		!Number.isSafeInteger(provenance.committedThroughTick) || provenance.committedThroughTick !== provenance.committedBars * 4 * ppq) {
		return null;
	}
	const clockBeats = (audioTime - startAudioTime) * params.tempo / 60;
	if (!Number.isFinite(clockBeats)) return null;
	const lastBarIndex = Math.min(totalBars - 1, provenance.committedBars - 1, barIndex,
		Math.floor(elapsedBeats / 4), Math.floor(clockBeats / 4));
	return Object.freeze({ firstBarIndex: 0, lastBarIndex, barCount: lastBarIndex + 1 });
}

/** A stale mark never silently selects a different musical moment. */
export function selectListeningReviewBar(requested: number | null, extent: ListeningReviewExtent | null): number | null {
	if (!extent || extent.firstBarIndex !== 0 || !Number.isSafeInteger(extent.lastBarIndex) || extent.lastBarIndex < 0 ||
		extent.barCount !== extent.lastBarIndex + 1 || requested === null || !Number.isSafeInteger(requested) ||
		requested < 0 || requested > extent.lastBarIndex) return null;
	return requested;
}

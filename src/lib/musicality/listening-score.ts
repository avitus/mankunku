import { flattenTune } from '$lib/tunes/flatten';
import { notationBarForPlaybackBar } from '$lib/state/tune-practice-plan';
import type { ListeningTuneSession } from './listening-tunes';

/**
 * Project the finite performance onto the authored lead sheet. The head-in
 * uses the expanded chart prefix; solos and head-out use its resolved final
 * pass, exactly as buildListeningTuneSession does. Expanded section provenance
 * preserves intro/repeat/ending identity, including repeated section labels.
 */
export function listeningScoreBars(session: ListeningTuneSession): readonly (number | null)[] {
	const flat = flattenTune(session.tune, { expandRepeats: true });
	const laterPassStart = flat.totalBars - session.chorusBars;
	return session.bars.map(({ context }) => {
		const sourceBar = (context.chorusIndex === 0 ? 0 : laterPassStart) + context.barInChorus;
		return notationBarForPlaybackBar(flat.sectionMap, session.tune.sections, sourceBar);
	});
}

/** No highlight for idle, future, or malformed positions. */
export function listeningScoreBar(map: readonly (number | null)[], barIndex: number | null): number | null {
	if (barIndex === null || !Number.isInteger(barIndex) || barIndex < 0 || barIndex >= map.length) return null;
	return map[barIndex] ?? null;
}

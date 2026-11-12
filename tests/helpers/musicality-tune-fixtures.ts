import { MANKUNKU_BLUES } from '$lib/data/tunes';
import {
	buildListeningTuneSessionFromTune,
	type ListeningTuneOptions
} from '$lib/musicality/listening-tunes';
import { WHEN_THE_SAINTS } from '../fixtures/tunes/when-the-saints';
import { AMAZING_GRACE } from '../fixtures/tunes/amazing-grace';

/**
 * The original musicality regression corpus. Saints and Amazing Grace moved
 * out of the public catalog; keep their exact source objects and phrase IDs so
 * fixed musical events, full-performance witnesses and archived hashes still
 * test the same inputs. Never add these fixtures to the application catalog.
 */
export const HISTORICAL_MUSICALITY_TUNES = [WHEN_THE_SAINTS, AMAZING_GRACE, MANKUNKU_BLUES];
export const HISTORICAL_LISTENING_TUNES = HISTORICAL_MUSICALITY_TUNES
	.filter(tune => tune.timeSignature[0] === 4 && tune.timeSignature[1] === 4)
	.map(({ id, title, composer, key }) => ({ id, title, composer, key }));

export function buildHistoricalListeningTuneSession({ tuneId, ...options }: ListeningTuneOptions) {
	const tune = HISTORICAL_MUSICALITY_TUNES.find(candidate => candidate.id === tuneId);
	if (!tune) throw new Error('Unknown listening tune');
	return buildListeningTuneSessionFromTune(tune, options);
}

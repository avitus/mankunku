import { describe, expect, it } from 'vitest';
import { listeningScoreBars, listeningScoreBar } from '$lib/musicality/listening-score';
import { buildListeningTuneSessionFromTune } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { WHEN_THE_SAINTS } from '../../fixtures/tunes/when-the-saints';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

describe('listening lead-sheet position', () => {
	it('repeats the Saints score for each actual chorus including the closing head', () => {
		const session = buildListeningTuneSession({ tuneId: WHEN_THE_SAINTS.id, soloChoruses: 2 });
		const pass = Array.from({ length: 16 }, (_, index) => index);
		expect(listeningScoreBars(session)).toEqual([...pass, ...pass, ...pass, ...pass]);
	});

	it('keeps the blues intro only once and selects the correct first and second endings', () => {
		const session = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
		const map = listeningScoreBars(session);
		// Authored score: 4-bar intro, 10-bar body, 2-bar first ending, 2-bar second ending.
		expect(map.slice(0, 16)).toEqual(Array.from({ length: 16 }, (_, index) => index));
		const laterPass = [...Array.from({ length: 10 }, (_, index) => index + 4), 16, 17];
		expect(map.slice(16)).toEqual([...laterPass, ...laterPass, ...laterPass]);
	});

	it('maps saved AABA charts by source section rather than repeated labels', () => {
		const session = buildListeningTuneSessionFromTune(LOCAL_LISTENING_AABA, { key: 'Eb', soloChoruses: 1 });
		const map = listeningScoreBars(session);
		expect(map).toEqual(Array.from({ length: 96 }, (_, index) => index % 32));
		expect(session.tune.key).toBe('Eb');
		expect(map[56]).toBe(24);
		expect(map[80]).toBe(16);
	});

	it('preserves an internal repeat within every chorus instead of treating it as a head boundary', () => {
		const tune = structuredClone(LOCAL_LISTENING_AABA);
		tune.sections[0].repeatStart = true;
		tune.sections[0].repeatEnd = true;
		const session = buildListeningTuneSessionFromTune(tune, { soloChoruses: 1 });
		const opening = Array.from({ length: 8 }, (_, index) => index);
		const rest = Array.from({ length: 24 }, (_, index) => index + 8);
		const completeForm = [...opening, ...opening, ...rest];
		expect(session.headBars).toBe(40);
		expect(session.chorusBars).toBe(40);
		expect(listeningScoreBars(session)).toEqual([...completeForm, ...completeForm, ...completeForm]);
	});

	it('never highlights idle, fractional, negative or out-of-performance positions', () => {
		const map = [0, 1, 4, 5];
		for (const index of [null, -1, 0.5, 4, NaN, Infinity]) expect(listeningScoreBar(map, index)).toBeNull();
		expect(listeningScoreBar(map, 2)).toBe(4);
	});
});

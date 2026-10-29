import { describe, expect, it } from 'vitest';
import { RHYTHM_CHANGES } from '$lib/data/tunes';
import {
	assessCuratedListeningTune,
	assessListeningTune,
	buildListeningTuneSession,
	buildListeningTuneSessionFromTune
} from '$lib/musicality/listening-tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

const unsupported = 'Full-tune listening does not yet support sections omitted from solos; use an arrangement that keeps every section';

describe('listening admission for sections omitted from solos', () => {
	it.each([0, 1, 2, 3])('rejects a saved chart omitting section %i without constructing a misleading closing head', index => {
		const tune = structuredClone(LOCAL_LISTENING_AABA);
		tune.sections[index].omitFromSolos = true;
		const before = structuredClone(tune);
		expect(assessListeningTune(tune, { soloChoruses: 1 })).toEqual({ ok: false, reason: unsupported });
		expect(() => buildListeningTuneSessionFromTune(tune, { soloChoruses: 1 })).toThrow(unsupported);
		expect(tune).toEqual(before);
	});

	it('preserves the exact session when omission flags are absent or explicitly false', () => {
		const baseline = buildListeningTuneSessionFromTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
		const tune = structuredClone(LOCAL_LISTENING_AABA);
		for (const section of tune.sections) section.omitFromSolos = false;
		const result = assessListeningTune(tune, { soloChoruses: 2 });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.session.phrase).toEqual(baseline.phrase);
		expect(result.session.bars).toEqual(baseline.bars);
		expect([result.session.headBars, result.session.chorusBars, result.session.soloChoruses])
			.toEqual([baseline.headBars, baseline.chorusBars, baseline.soloChoruses]);
	});

	it('guards the curated source builder as well as saved-chart admission', () => {
		const section = RHYTHM_CHANGES.sections[1];
		const previous = section.omitFromSolos;
		try {
			section.omitFromSolos = true;
			expect(assessCuratedListeningTune({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 1 }))
				.toEqual({ ok: false, reason: unsupported });
			expect(() => buildListeningTuneSession({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 1 })).toThrow(unsupported);
		} finally {
			if (previous === undefined) delete section.omitFromSolos;
			else section.omitFromSolos = previous;
		}
	});
});

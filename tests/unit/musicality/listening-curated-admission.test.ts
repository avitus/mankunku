import { describe, expect, it } from 'vitest';
import { RHYTHM_CHANGES } from '$lib/data/tunes';
import { buildListeningTuneSession, assessCuratedListeningTune } from '$lib/musicality/listening-tunes';

describe('curated listening arrangement admission', () => {
	it('admits the complete 128-bar Rhythm Changes head, two solos and head out', () => {
		const session = buildListeningTuneSession({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 2 });
		expect(session.bars).toHaveLength(128);
		expect(session.phrase.performanceForm.choruses.map(pass => pass.role)).toEqual(['head', 'solo', 'solo', 'head']);
		expect(session.bars.at(-1)?.context.isFinalBar).toBe(true);
	});

	it('returns a recoverable reason for excessive or unavailable curated choices', () => {
		for (const soloChoruses of [3, 4]) {
			expect(assessCuratedListeningTune({ tuneId: RHYTHM_CHANGES.id, soloChoruses })).toEqual({
				ok: false,
				reason: 'This arrangement exceeds the 128-bar listening limit; choose fewer solo choruses or a shorter chart'
			});
		}
		expect(assessCuratedListeningTune({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 2 }).ok).toBe(true);
		expect(assessCuratedListeningTune({ tuneId: 'unavailable-chart' })).toEqual({ ok: false, reason: 'Unknown listening tune' });
	});

	it.each([3, 4])('rejects Rhythm Changes with %i solos instead of truncating the full tune', (soloChoruses) => {
		expect(() => buildListeningTuneSession({ tuneId: RHYTHM_CHANGES.id, soloChoruses }))
			.toThrow('128-bar listening limit; choose fewer solo choruses or a shorter chart');
	});
});

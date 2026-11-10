import { describe, expect, it } from 'vitest';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes/mankunku-blues';
import { buildNativeBluesFixture } from '../../fixtures/musicality-native-blues';

describe('native keyboard full-performance fixture', () => {
	it('renders exactly the listening desk harmony, source sections and performed form', () => {
		const expected = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, key: 'F', soloChoruses: 2 }).phrase;
		const actual = buildNativeBluesFixture();
		expect(actual.id).toBe(expected.id);
		expect(actual.harmony).toEqual(expected.harmony);
		expect(actual.sectionMap).toEqual(expected.sectionMap);
		expect(actual.performanceForm).toEqual(expected.performanceForm);
		expect(actual.performanceForm.totalBars).toBe(52);
	});
});

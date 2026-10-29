import { describe, expect, it } from 'vitest';
import { buildListeningTuneSession as buildPublicListeningTuneSession, LISTENING_TUNES as PUBLIC_LISTENING_TUNES } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES, RHYTHM_CHANGES } from '$lib/data/tunes';
import { WHEN_THE_SAINTS } from '../../fixtures/tunes/when-the-saints';
import { AMAZING_GRACE } from '../../fixtures/tunes/amazing-grace';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';
import { fractionToFloat } from '$lib/music/intervals';
import { MAX_ADAPTIVE_BARS } from '$lib/audio/backing-performance-limits';

describe('full-tune listening sessions', () => {
	it('offers actual built-in 4/4 charts and keeps unsupported meters out of the picker', () => {
		expect(PUBLIC_LISTENING_TUNES.map((tune) => tune.id).sort()).toEqual([MANKUNKU_BLUES.id, RHYTHM_CHANGES.id].sort());
		expect(() => buildPublicListeningTuneSession({ tuneId: WHEN_THE_SAINTS.id })).toThrow(/unknown listening tune/i);
		expect(LISTENING_TUNES.map((tune) => tune.id).sort()).toEqual([MANKUNKU_BLUES.id, WHEN_THE_SAINTS.id].sort());
		expect(() => buildListeningTuneSession({ tuneId: AMAZING_GRACE.id })).toThrow(/4\/4/);
	});

	it('plays a finite head–solo–solo–head over the complete 16-bar Saints form', () => {
		const session = buildListeningTuneSession({ tuneId: WHEN_THE_SAINTS.id });
		expect(session.phrase.performanceForm?.choruses.map(({ role, startBar, endBarExclusive }) => ({ role, startBar, endBarExclusive }))).toEqual([
			{ role: 'head', startBar: 0, endBarExclusive: 16 },
			{ role: 'solo', startBar: 16, endBarExclusive: 32 },
			{ role: 'solo', startBar: 32, endBarExclusive: 48 },
			{ role: 'head', startBar: 48, endBarExclusive: 64 }
		]);
		expect(session.phrase.difficulty.lengthBars).toBe(64);
	});

	it('plays the blues intro once and resolves the head out through its second ending', () => {
		const session = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id });
		expect(session.headBars).toBe(16);
		expect(session.chorusBars).toBe(12);
		expect(session.phrase.performanceForm?.totalBars).toBe(52);
		expect(session.phrase.sectionMap?.filter((section) => section.sourceSection === 0)).toHaveLength(1);
		expect(session.phrase.sectionMap?.slice(-2)).toEqual([{ sourceSection: 1, barOffset: 40 }, { sourceSection: 3, barOffset: 50 }]);
		expect(session.phrase.harmony.at(-1)?.chord).toEqual({ root: 'F', quality: 'maj6' });
	});

	it('shows held harmony and intra-bar chord changes at the same position as playback', () => {
		const saints = buildListeningTuneSession({ tuneId: WHEN_THE_SAINTS.id });
		expect(saints.bars).toHaveLength(64);
		expect(saints.bars[1]).toMatchObject({ barIndex: 1, barNumber: 2, sectionLabel: 'A',
			changes: [{ symbol: 'C6', beatOffset: 0, durationBeats: 4, held: true }] });
		expect(saints.bars[48].context).toMatchObject({ role: 'head', chorusIndex: 3, barInChorus: 0, isChorusFirstBar: true });
		expect(saints.bars[63].context.isFinalBar).toBe(true);
		const blues = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id });
		expect(blues.bars[7].changes).toEqual([
			{ symbol: 'Cm7', beatOffset: 0, durationBeats: 2, held: false },
			{ symbol: 'F7', beatOffset: 2, durationBeats: 2, held: false }
		]);
	});

	it('transposes actual changes and closing-head melody together without mutating the catalog', () => {
		const snapshot = structuredClone(MANKUNKU_BLUES);
		const session = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, key: 'Bb' });
		expect(session.phrase.key).toBe('Bb');
		expect(session.phrase.harmony[0].chord.root).toBe('Bb');
		expect(session.bars[0].chordSymbols).toEqual(['Bb7']);
		expect(session.phrase.harmony.at(-1)?.chord).toEqual({ root: 'Bb', quality: 'maj6', bass: undefined });
		const closingNotes = session.phrase.notes.filter((note) => fractionToFloat(note.offset) >= 40);
		expect(closingNotes.length).toBeGreaterThan(0);
		expect(closingNotes[0].pitch).toBe(session.tune.sections[1].notes[0].pitch);
		expect(session.phrase.notes.some((note) => fractionToFloat(note.offset) >= 16 && fractionToFloat(note.offset) < 40)).toBe(false);
		session.tune.sections[0].harmony[0].chord.root = 'B';
		session.phrase.harmony[0].chord.root = 'B';
		expect(MANKUNKU_BLUES).toEqual(snapshot);
	});

	it.each([1, 2, 3, 4])('builds %i solo choruses with complete harmony and finite structural metadata', (soloChoruses) => {
		for (const tune of LISTENING_TUNES) {
			const session = buildListeningTuneSession({ tuneId: tune.id, soloChoruses });
			const { performanceForm, harmony, notes } = session.phrase;
			expect(performanceForm.choruses.map((chorus) => chorus.role)).toEqual(['head', ...Array(soloChoruses).fill('solo'), 'head']);
			expect(performanceForm.totalBars).toBe(session.headBars + (soloChoruses + 1) * session.chorusBars);
			expect(performanceForm.totalBars).toBeLessThanOrEqual(MAX_ADAPTIVE_BARS);
			let cursor = 0;
			for (const segment of harmony) {
				expect(fractionToFloat(segment.startOffset)).toBe(cursor);
				cursor += fractionToFloat(segment.duration);
			}
			expect(cursor).toBe(performanceForm.totalBars);
			expect(notes.every((note) => fractionToFloat(note.offset) >= 0 && fractionToFloat(note.offset) + fractionToFloat(note.duration) <= performanceForm.totalBars)).toBe(true);
			expect(session.bars.every((bar) => bar.changes.reduce((sum, change) => sum + change.durationBeats, 0) === 4)).toBe(true);
		}
	});

	it('rejects unknown charts, invalid keys and invalid chorus counts instead of quietly changing the arrangement', () => {
		expect(() => buildListeningTuneSession({ tuneId: 'missing-tune' })).toThrow(/unknown listening tune/i);
		expect(() => buildPublicListeningTuneSession({ tuneId: 'missing-tune' })).toThrow(/unknown listening tune/i);
		expect(() => buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, key: 'H' as 'C' })).toThrow(/concert key/i);
		for (const soloChoruses of [0, 5, 1.5, NaN, Infinity]) {
			expect(() => buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses })).toThrow(/1 and 4/);
		}
	});
});

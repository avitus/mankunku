import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SessionKeyMap from '$lib/components/lick-practice/SessionKeyMap.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
import type { LickReport, SessionReport, LickPracticeProgress } from '$lib/types/lick-practice';
import type { NextStep } from '$lib/state/lick-practice-next-steps';

function lick(id: string, keys: PitchClass[], minor = false): LickReport {
	return { lickId: id, lickName: id, tempo: 100, newTempo: null,
		progressionType: minor ? 'ii-V-I-minor' : 'ii-V-I-major', averageScore: .8, passedCount: 0,
		keys: keys.map(key => ({ key, score: .8, pitchAccuracy: .8, rhythmAccuracy: .8, passed: false })) };
}
function html(licks: LickReport[], progress: LickPracticeProgress = {}, steps: NextStep[] = []): string {
	const report: SessionReport = { licks, totalAttempts: licks.reduce((n, l) => n + l.keys.length, 0), totalPassed: 0, overallAverage: .8, elapsedMinutes: 12 };
	return render(SessionKeyMap, { props: { report, progress, plan: [], instrument: INSTRUMENTS['tenor-sax'], steps, onstart() {}, ondone() {}, onreset() {} } }).body;
}

describe('session key map rendering', () => {
	it('names the recommended and alternative drill buttons accessibly', () => {
		const steps: NextStep[] = ['first', 'second'].map(lickId => ({
			kind: 'drill-weak-key', headline: `Drill ${lickId}`, reason: 'Keep practising',
			focus: { lickName: lickId, keyLabel: 'D', typicalScore: .8, sessions: 2, weakSessions: 2 },
			action: { kind: 'deep', lickId, focusKey: 'C', label: 'Start deep practice' }
		}));
		const markup = html([lick('first', ['C'])], {}, steps);
		expect(markup).toContain('Go deeper');
		expect(markup).toContain('Start here');
		expect(markup).toContain('Another direction');
		expect(markup).toContain('aria-label="Start deep practice: D on first"');
		expect(markup).toContain('aria-label="Start deep practice: D on second"');
	});

	it.each(['rest', 'done'] as const)('keeps the %s closing message visible without drill cards', kind => {
		const markup = html([lick('line', ['C'])], {}, [{ kind, headline: 'Finish for today', reason: 'Come back tomorrow', action: null }]);
		expect(markup).toContain('Finish for today');
		expect(markup).toContain('Come back tomorrow');
		expect(markup).not.toContain('Go deeper');
		expect(markup).not.toContain('Start deep practice:');
	});

	it('keeps all twelve keys in the table and reads historical scores by concert key', () => {
		const markup = html([lick('line', [...PITCH_CLASSES])], { line: { C: { currentTempo: 100, lastPracticedAt: 1, passCount: 1, rollingScore: .94 } } });
		expect(markup.match(/class="score-cell /g)).toHaveLength(12);
		expect(markup).toContain('Practice D on line: 80% this session, 94% rolling score');
		expect(markup).toContain('94%</b> rolling');
	});

	it('distinguishes an unplayed cell from a played key without historical data', () => {
		const markup = html([lick('first', ['C']), lick('second', ['F'])]);
		expect(markup).toContain('G not practiced this session');
		expect(markup).toContain('Practice D on first: 80% this session, no historical score');
		expect(markup).toContain('No history');
		expect(markup).not.toContain('0% rolling');
	});

	it('retains the minor spelling when major and minor licks share the same pitch column', () => {
		const markup = html([lick('major', ['C']), lick('minor', ['C'], true)]);
		expect(markup).toContain('Practice D on major:');
		expect(markup).toContain('Practice D- on minor:');
		expect(markup).toMatch(/class="cell-key[^\"]*">D-<\/span>/);
	});
});

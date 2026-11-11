import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SessionKeyMap from '$lib/components/lick-practice/SessionKeyMap.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
import type { LickReport, SessionReport, LickPracticeProgress } from '$lib/types/lick-practice';

function lick(id: string, keys: PitchClass[], minor = false): LickReport {
	return { lickId: id, lickName: id, tempo: 100, newTempo: null,
		progressionType: minor ? 'ii-V-I-minor' : 'ii-V-I-major', averageScore: .8, passedCount: 0,
		keys: keys.map(key => ({ key, score: .8, pitchAccuracy: .8, rhythmAccuracy: .8, passed: false })) };
}
function html(licks: LickReport[], progress: LickPracticeProgress = {}): string {
	const report: SessionReport = { licks, totalAttempts: licks.reduce((n, l) => n + l.keys.length, 0), totalPassed: 0, overallAverage: .8, elapsedMinutes: 12 };
	return render(SessionKeyMap, { props: { report, progress, plan: [], instrument: INSTRUMENTS['tenor-sax'], steps: [], onstart() {}, ondone() {}, onreset() {} } }).body;
}

describe('session key map rendering', () => {
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

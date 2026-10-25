import { expect, it } from 'vitest';
import { assessListeningTune } from '$lib/musicality/listening-tunes';
import { generateBacking } from '$lib/audio/backing-generation';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

it.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('%s renders the admitted 128-bar local form and restores its actual mid-chorus history', styleId => {
	const input = structuredClone(LOCAL_LISTENING_AABA);
	const assessed = assessListeningTune(input, { key: 'D', soloChoruses: 2 });
	expect(assessed.ok).toBe(true);
	if (!assessed.ok) throw new Error(assessed.reason);
	const captured = structuredClone(assessed.session);
	const { phrase, bars } = assessed.session;
	expect(input).toEqual(LOCAL_LISTENING_AABA);
	input.sections[2].harmony[0].chord.root = 'B';
	input.sections[2].label = 'Later edited bridge';
	input.title = 'Later title';
	expect(assessed.session).toEqual(captured);
	expect(bars).toHaveLength(128);
	for (const [chorus, role] of ['head', 'solo', 'solo', 'head'].entries()) {
		const bridge = bars[chorus * 32 + 16];
		expect(bridge).toMatchObject({ sectionLabel: 'B', chordSymbols: ['GΔ7'],
			context: { sourceSection: 2, chorusIndex: chorus, role, isSectionFirstBar: true } });
	}
	const style = BACKING_STYLES[styleId];
	const params = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
		performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}, swing: style.defaultSwing };
	const fixed = generateBacking(phrase.harmony, style, params);
	const score = createRollingBacking(phrase.harmony, style, params);
	expect(score.totalBars).toBe(128);
	let checkpoint: RollingBackingCheckpoint | undefined;
	let restored: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < 128; bar++) {
		const actual = advanceRollingBacking(score, checkpoint);
		if (bar === 45) restored = JSON.parse(JSON.stringify(checkpoint));
		if (bar >= 45) {
			const resumed = advanceRollingBacking(score, restored);
			expect(resumed).toEqual(actual);
			restored = resumed.checkpoint;
		}
		windows.push(actual);
		checkpoint = actual.checkpoint;
	}
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
		const rolled = windows.flatMap(window => window[field].map(event => ({ time: event.time })));
		for (const events of [fixed[field], rolled]) {
			expect(events.length).toBeGreaterThan(0);
			expect(events.every(event => Number.isFinite(parseInt(event.time, 10)) && parseInt(event.time, 10) >= 0 && parseInt(event.time, 10) < 128 * 4 * 192)).toBe(true);
			if (field !== 'compEvents') expect(events.some(event => parseInt(event.time, 10) >= 127 * 4 * 192)).toBe(true);
		}
	}
	expect(checkpoint!.nextBar).toBe(128);
	expect(checkpoint).toEqual(restored);
	expect(assessed.session).toEqual(captured);
});

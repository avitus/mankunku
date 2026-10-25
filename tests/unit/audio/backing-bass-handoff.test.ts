import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingBass } from '$lib/audio/backing-rolling-bass';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { seedFrom } from '$lib/audio/generation-rng';
import type { EnsembleTiming } from '$lib/audio/ensemble-timing';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'C', soloChoruses: 2 });
const params = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67,
	sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} };
const timing: EnsembleTiming = { place: beat => Math.round(beat * 192), arrivalTick: bar => bar * 4 * 192, trace: [] };
const pc = (midi: number) => (midi % 12 + 12) % 12;

function context(styleId: 'swing' | 'straight' = 'swing') {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES[styleId], { ...params, swing: BACKING_STYLES[styleId].defaultSwing });
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < 26; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	const result = advanceRollingBacking(score, checkpoint);
	const info = { ...score.bars[26], ensemble: result.ensemblePlan.bars[0], intensity: result.ensemblePlan.bars[0].energy };
	return { score, checkpoint: checkpoint!, result, info };
}

describe('rolling walking-bass approach handoff', () => {
	it.each(['swing', 'straight'] as const)('%s connects the real Blues C interior to its unchanged chromatic approach', styleId => {
		const { score, checkpoint, result } = context(styleId);
		const notes = result.bassEvents.filter(event => Number.isInteger(event.absBeat));
		expect(notes.map(event => event.absBeat)).toEqual([104, 105, 106, 107]);
		expect([notes[0].midi, notes[3].midi]).toEqual([48, 37]);
		expect(notes[1].midi).not.toBe(notes[0].midi);
		expect([0, 2, 3, 4, 7, 9]).toContain(pc(notes[1].midi));
		expect([0, 4, 7, 10]).toContain(pc(notes[2].midi));
		for (let i = 1; i < notes.length; i++) expect(Math.abs(notes[i].midi - notes[i - 1].midi)).toBeLessThanOrEqual(5);
		expect(result.ensembleDevelopment.bassTurnarounds).toMatchObject([{ status: 'skipped', reason: 'reserved_space' }]);
		expect(result.ensemblePlan.bars[0].phraseIntent).toBe('release');
		expect(result.checkpoint.bass).toMatchObject({ previousMidi: 37, previousPreviousMidi: notes[2].midi,
			direction: Math.sign(37 - notes[2].midi), nextTarget: 36, pendingLaunch: null });
		expect(advanceRollingBacking(score, result.checkpoint).bassEvents[0].midi).toBe(36);
		expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(result);
	});

	it('retains the complete ordinary bar when a required pulse cannot be scheduled', () => {
		const { score, checkpoint, info } = context();
		const late: EnsembleTiming = { ...timing, place: beat => beat === 106 ? 108 * 192 : Math.round(beat * 192) };
		const actual = realizeRollingBass(score, 26, info, late, checkpoint.bass);
		expect(actual.events.map(event => [event.absBeat, event.midi])).toEqual([[104, 48], [105, 52], [107, 37]]);
		expect(actual.memory).toMatchObject({ previousMidi: 37, previousPreviousMidi: 52 });
	});
});

it('does not repair a shared reservation or another response owner', () => {
	const { score, checkpoint, info } = context();
	const ordinaryNotes = [[104, 48], [105, 52], [106, 55], [107, 37]];
	const reservation = { id: 'protected-arrival', targetBarIndex: 26, beatOffset: 0 as const, strength: 1, participants: ['bass', 'drums'] as const };
	for (const ensemble of [
		{ ...info.ensemble, responseOwner: 'drums' as const },
		{ ...info.ensemble, coordinatedAccent: reservation },
		{ ...info.ensemble, setupFor: { ...reservation, targetBarIndex: 27 } }
	]) {
		const result = realizeRollingBass(score, 26, { ...info, ensemble }, timing, checkpoint.bass);
		expect(result.events.map(event => [event.absBeat, event.midi])).toEqual(ordinaryNotes);
	}
});

it('keeps safe ordinary walking and two-feel output byte-for-byte', () => {
	const { score } = context();
	const ordinaryScore = { ...score, bassApproachHandoff: undefined };
	let checkpoint: RollingBackingCheckpoint | undefined;
	let safe = 0;
	let twoFeel = 0;
	for (let bar = 0; bar < score.totalBars; bar++) {
		const result = advanceRollingBacking(score, checkpoint);
		const info = { ...score.bars[bar], ensemble: result.ensemblePlan.bars[0], intensity: result.ensemblePlan.bars[0].energy };
		const ordinary = realizeRollingBass(ordinaryScore, bar, info, timing, checkpoint?.bass);
		const pulses = ordinary.events.filter(event => Number.isInteger(event.absBeat));
		if (ordinary.memory.feel === 'two' || pulses.length === 4 && Math.abs(pulses[2].midi - pulses[3].midi) <= 5) {
			expect(realizeRollingBass(score, bar, info, timing, checkpoint?.bass)).toEqual(ordinary);
			if (ordinary.memory.feel === 'two') twoFeel++; else safe++;
		}
		checkpoint = result.checkpoint;
	}
	expect(safe).toBeGreaterThan(10);
	expect(twoFeel).toBeGreaterThan(10);
});

it('rolls back the entire alternate when a late candidate pulse is rejected', () => {
	const { score, checkpoint, info } = context();
	const ordinary = realizeRollingBass({ ...score, bassApproachHandoff: undefined }, 26, info, timing, checkpoint.bass);
	let callsAt106 = 0;
	const rejectsAlternate: EnsembleTiming = { ...timing, place: beat => {
		if (beat === 106 && ++callsAt106 === 2) return 108 * 192;
		return Math.round(beat * 192);
	} };
	const actual = realizeRollingBass(score, 26, info, rejectsAlternate, checkpoint.bass);
	expect(callsAt106).toBe(2);
	expect(actual).toEqual(ordinary);
});

it('binds the new policy only to explicit Swing/Straight and rejects old-policy resumes with a valid checksum', () => {
	const { score, checkpoint } = context();
	expect(score.bassApproachHandoff).toBe(true);
	for (const style of [BACKING_STYLES['bossa-nova'], BACKING_STYLES.ballad]) {
		const native = createRollingBacking(phrase.harmony, style, params);
		expect(native.bassApproachHandoff).toBeUndefined();
		expect(native.fingerprint).not.toContain('bassApproachHandoffVersion');
	}
	const implicit = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, { ...params, performanceForm: undefined });
	expect(implicit.bassApproachHandoff).toBeUndefined();
	expect(implicit.fingerprint).not.toContain('bassApproachHandoffVersion');
	const prior = JSON.parse(JSON.stringify(checkpoint)) as RollingBackingCheckpoint;
	const fingerprint = prior.fingerprint.replace(',"bassApproachHandoffVersion":1', '');
	expect(fingerprint).not.toBe(prior.fingerprint);
	const { checkpointId: _, ...contents } = { ...prior, fingerprint };
	const oldCheckpoint = { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
	expect(() => advanceRollingBacking(score, oldCheckpoint)).toThrow(/checkpoint/i);
});

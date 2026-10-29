import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBacking, generateBackingCached, type BackingGenerationParams } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import { assessTerminalArrangement, realizeTerminalArrangement } from '$lib/audio/backing-terminal';
import { selectCoordinatedVoicingFamily } from '$lib/audio/coordinated-voicing-family';
import { seedFrom } from '$lib/audio/generation-rng';
import { planEnsembleWindow } from '$lib/audio/ensemble-plan';
import * as bassGenerator from '$lib/audio/backing-bass';
import * as voicings from '$lib/audio/coordinated-voicing';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'C', soloChoruses: 2 });
const style = BACKING_STYLES.ballad;
function input(tempo: number, ending = true): BackingGenerationParams {
	return { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
		sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {},
		...(ending ? { terminalArrangement: { ending: 'hold-release', melody: phrase.notes } } : {}) };
}
function rolling(tempo: number, ending = true, loops = 1) {
	const score = createRollingBacking(phrase.harmony, style, input(tempo, ending), { loopCount: loops });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const bars = [];
	for (let bar = 0; bar < score.totalBars; bar++) {
		const next = advanceRollingBacking(score, checkpoint); bars.push(next); checkpoint = next.checkpoint;
	}
	return { score, bars, last: bars.at(-1)! };
}
afterEach(() => vi.restoreAllMocks());

describe('Ballad explicitly arranged native closing hold', () => {
	it.each([80, 140])('fixed %i BPM holds with existing native bass/drum levels and quiet piano', tempo => {
		const ordinary = generateBacking(phrase.harmony, style, input(tempo, false));
		const actual = generateBacking(phrase.harmony, style, input(tempo));
		const bass = actual.bassEvents.filter(event => event.absBeat >= 204);
		const piano = actual.compEvents.filter(event => event.absBeat >= 204);
		const drums = actual.drumEvents.filter(event => event.absBeat >= 204);
		expect(bass).toHaveLength(1); expect(piano).toHaveLength(1);
		expect(drums.map(event => [event.drum, event.velocity])).toEqual(ordinary.drumEvents
			.filter(event => event.absBeat === 204 && ['ride', 'kick'].includes(event.drum)).map(event => [event.drum, event.velocity]));
		expect(drums.map(event => event.drum)).toEqual(tempo === 80 ? ['ride', 'kick'] : ['ride']);
		expect(bass[0].velocity).toBe(ordinary.bassEvents.find(event => event.absBeat === 204)!.velocity);
		expect(bass[0].midi % 12).toBe(0);
		expect([...bass, ...piano, ...drums].every(event => event.time === '39168i' && event.absBeat === 204)).toBe(true);
		expect(piano[0].duration).toBe(120 / tempo); expect(bass[0].duration).toBe(piano[0].duration);
		const plan = actual.ensemblePlan!.bars[51];
		expect(plan.energy).toBeLessThanOrEqual(.6);
		const adjustment = Math.round(-2 + 6 * plan.energy);
		expect(piano[0].velocity).toBeGreaterThanOrEqual(42 + adjustment);
		expect(piano[0].velocity).toBeLessThanOrEqual(54 + adjustment);
		const voice = actual.ensembleDevelopment!.pianoVoicings!.at(-1)!;
		expect(voice.decision).not.toHaveProperty('topLine');
		expect(voice.decision.requestedFamily).toBe(selectCoordinatedVoicingFamily({ chord: phrase.harmony.at(-1)!.chord,
			phraseId: phrase.id, tempo, segmentIndex: phrase.harmony.length - 1, intensity: plan.energy, voicingBias: style.voicingBias }));
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field].filter(event => event.absBeat < 204))
			.toEqual(ordinary[field].filter(event => event.absBeat < 204));
	});
	it.each([80, 140])('rolling %i BPM commits native closing history without Swing dialogue or contour', tempo => {
		const actual = rolling(tempo), ordinary = rolling(tempo, false);
		expect(actual.last.bassEvents).toHaveLength(1); expect(actual.last.compEvents).toHaveLength(1);
		expect(actual.last.drumEvents.map(event => [event.drum, event.velocity])).toEqual(ordinary.last.drumEvents
			.filter(event => event.absBeat === 204 && ['ride', 'kick'].includes(event.drum)).map(event => [event.drum, event.velocity]));
		expect(actual.last.bassEvents[0].velocity).toBe(ordinary.last.bassEvents.find(event => event.absBeat === 204)!.velocity);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) for (let bar = 0; bar < 51; bar++) expect(actual.bars[bar][field]).toEqual(ordinary.bars[bar][field]);
		expect(actual.last.checkpoint.piano).not.toHaveProperty('contour');
		expect(actual.last.checkpoint.piano).not.toHaveProperty('phraseRecall');
		expect(actual.last.checkpoint).not.toHaveProperty('pianoAnswer');
		expect(actual.last.checkpoint).not.toHaveProperty('pianoRecovery');
		expect(actual.score.bars[51]).not.toHaveProperty('pianoArrivalPolicy');
		expect(actual.last.checkpoint.drums.previousCompIsSharedArrival).toBe(true);
		expect(actual.last.checkpoint.drums).not.toHaveProperty('previousCompIsDrumReply');
		expect(actual.last.checkpoint.drums.previousCompOnsets).toEqual([0]);
		expect(actual.last.ensembleDevelopment.drumPhrases[0].style).toBe('ballad');
		expect(actual.last.ensembleDevelopment.drumPhrases[0].hits.map(hit => [hit.drum, hit.velocity]))
			.toEqual(actual.last.drumEvents.map(event => [event.drum, event.velocity]));
		expect(advanceRollingBacking(actual.score, JSON.parse(JSON.stringify(actual.bars[50].checkpoint)))).toEqual(actual.last);
		expect(() => advanceRollingBacking(actual.score, JSON.parse(JSON.stringify(actual.last.checkpoint)))).toThrow('complete');
	});
});


function nativeContext(tempo = 80) {
	const held = rolling(tempo), ordinary = rolling(tempo, false);
	const prior = held.bars[50].checkpoint;
	return { held, ordinary, prior, candidate: { reservation: held.score.terminalArrangement!, plan: held.last.ensemblePlan.bars[0],
		style, phraseId: phrase.id, tempo, ppq: 192, segmentIndex: phrase.harmony.length - 1,
		previousBass: prior.bass.previousMidi, previousVoicing: prior.piano.voicing,
		ordinaryBass: ordinary.last.bassEvents, ordinaryDrums: ordinary.last.drumEvents } };
}
const rebind = (checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint => {
	const { checkpointId: _id, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
};

describe('Ballad terminal native eligibility and complete fallback', () => {
	it('binds a native profile without enabling a Swing arrival policy', () => {
		const assessment = assessTerminalArrangement(phrase.harmony, style, input(80));
		expect(assessment).toMatchObject({ available: true, reservation: { profile: 'ballad-v1', holdBeats: 2 } });
		const { held } = nativeContext();
		expect(held.score.fingerprint).toContain('ballad-v1');
		expect(held.score.bars[51].energyCeiling).toBe(.6);
		expect(held.score.bars[51]).not.toHaveProperty('pianoArrivalPolicy');
		expect(held.last.ensemblePlan.bars[0]).toMatchObject({ bass: { keepPulse: false }, drums: { keepTime: false }, piano: { maxAttacks: 1 } });
	});
	it('rejects a profile mismatch in either direction even when called directly', () => {
		const { candidate } = nativeContext();
		const { profile: _profile, ...unprofiled } = candidate.reservation;
		for (const value of [
			{ ...candidate, reservation: unprofiled },
			{ ...candidate, style: BACKING_STYLES.swing },
			{ ...candidate, style: BACKING_STYLES['bossa-nova'] },
			{ ...candidate, plan: { ...candidate.plan, energy: .61 } }
		]) expect(realizeTerminalArrangement(value).decision).toMatchObject({ status: 'withheld', reason: 'unrealizable' });
	});
	it('requires the complete actual native downbeat and never substitutes missing kit voices', () => {
		const { candidate } = nativeContext();
		const ride = candidate.ordinaryDrums.find(event => event.absBeat === 204 && event.drum === 'ride')!;
		for (const value of [
			{ ...candidate, ordinaryBass: [] }, { ...candidate, ordinaryDrums: [] },
			{ ...candidate, ordinaryDrums: candidate.ordinaryDrums.filter(event => event.drum !== 'ride') },
			{ ...candidate, ordinaryDrums: [...candidate.ordinaryDrums, ride] },
			{ ...candidate, ordinaryDrums: [...candidate.ordinaryDrums, { ...ride, drum: 'crash' as const }] },
			{ ...candidate, ordinaryDrums: candidate.ordinaryDrums.map(event => event === ride ? { ...event, velocity: NaN } : event) },
			{ ...candidate, plan: { ...candidate.plan, responseOwner: 'piano' as const } },
			{ ...candidate, precedingRelease: true }
		]) expect(realizeTerminalArrangement(value).decision.status).toBe('withheld');
		const mutable = JSON.parse(JSON.stringify(candidate));
		mutable.style = style;
		const before = JSON.stringify(mutable.ordinaryDrums);
		const accepted = realizeTerminalArrangement(mutable);
		expect(accepted.decision.status).toBe('accepted');
		expect(accepted).not.toHaveProperty('contour');
		expect(JSON.stringify(mutable.ordinaryDrums)).toBe(before);
		expect(Object.isFrozen(mutable.ordinaryDrums)).toBe(false);
	});
	it('retains the complete ordinary fixed ending when a preceding bass note overlaps its cue', () => {
		const original = bassGenerator.generateBassLine;
		vi.spyOn(bassGenerator, 'generateBassLine').mockImplementation((...args) => {
			const result = original(...args), prior = result.events.filter(event => event.absBeat < 204).at(-1)!;
			prior.duration = (39168 - parseInt(prior.time)) * 60 / 80 / 192 + .1;
			return result;
		});
		const ordinary = generateBacking(phrase.harmony, style, input(80, false));
		const held = generateBacking(phrase.harmony, style, input(80));
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(held[field]).toEqual(ordinary[field]);
		expect(held.ensembleDevelopment!.terminalArrangements).toMatchObject([{ status: 'withheld', reason: 'preceding_release' }]);
		expect(held.ensemblePlan!.bars[51].drums.keepTime).toBe(true);
	});
	it('does not commit a partial native closing group when the piano has no valid notes', () => {
		const { held, ordinary, prior } = nativeContext();
		const resolve = voicings.resolveCoordinatedVoicing;
		vi.spyOn(voicings, 'resolveCoordinatedVoicing').mockImplementation(value => ({ ...resolve(value), notes: [] }));
		const actual = advanceRollingBacking(held.score, prior);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary.last[field]);
		for (const field of ['piano', 'bass', 'drums'] as const) expect(actual.checkpoint[field]).toEqual(ordinary.last.checkpoint[field]);
		expect(actual.ensembleDevelopment.terminalArrangements).toMatchObject([{ status: 'withheld', reason: 'unrealizable' }]);
	});
});

describe('Ballad terminal finite replay and profile isolation', () => {
	it('holds a known four-beat melody to bar end without changing the first loop or earlier events', () => {
		const melody = structuredClone(phrase.notes); melody.at(-1)!.duration = [1, 1];
		const parameters = { ...input(80), terminalArrangement: { ending: 'hold-release' as const, melody } };
		const score = createRollingBacking(phrase.harmony, style, parameters, { loopCount: 2 });
		const ordinary = rolling(80, false, 2);
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const actual = advanceRollingBacking(score, checkpoint);
			if (bar < 103) for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary.bars[bar][field]);
			if ([51, 52, 102, 103].includes(bar)) expect(advanceRollingBacking(score, checkpoint && JSON.parse(JSON.stringify(checkpoint)))).toEqual(actual);
			if (bar === 103) {
				expect(actual.ensemblePlan.bars[0].terminalArrangement).toMatchObject({ profile: 'ballad-v1', absBeat: 412, releaseBeat: 416, holdBeats: 4 });
				expect(actual.bassEvents[0].duration).toBe(3); expect(actual.compEvents[0].duration).toBe(3);
				expect(actual.checkpoint.drums.previousCompIsSharedArrival).toBe(true);
			}
			checkpoint = actual.checkpoint;
		}
		const fixed = generateBacking(phrase.harmony, style, parameters);
		expect(fixed.compEvents.at(-1)!.duration).toBe(3);
	});
	it('rejects a removed profile binding even with a correctly recomputed checkpoint checksum', () => {
		const { held, prior } = nativeContext();
		const fingerprint = prior.fingerprint.replace(',"profile":"ballad-v1"', '');
		expect(fingerprint).not.toBe(prior.fingerprint);
		expect(() => advanceRollingBacking(held.score, rebind({ ...prior, fingerprint }))).toThrow('checkpoint');
	});
	it('permits joint native provenance only on the complete accepted terminal transaction', () => {
		const { held } = nativeContext();
		const final = held.last.checkpoint;
		for (const checkpoint of [
			{ ...held.bars[20].checkpoint, drums: { ...held.bars[20].checkpoint.drums, previousCompIsSharedArrival: true as const, previousCompOnsets: [0] } },
			{ ...final, drums: { ...final.drums, previousCompIsSharedArrival: undefined } },
			{ ...final, drums: { ...final.drums, previousCompOnsets: [1] } },
			{ ...final, piano: { ...final.piano, recentFigures: [] } },
			{ ...final, drums: { ...final.drums, previousCompIsDrumReply: true as const } }
		]) expect(() => advanceRollingBacking(held.score, rebind(checkpoint))).toThrow('checkpoint');
	});
	it('rejects a native reservation with missing profile or a forged Swing policy context', () => {
		const { held } = nativeContext();
		const { profile: _profile, ...unprofiled } = held.score.terminalArrangement!;
		for (const last of [
			{ ...held.score.bars[51], terminalArrangement: unprofiled },
			{ ...held.score.bars[51], pianoArrivalPolicy: 'shared-v1' as const },
			{ ...held.score.bars[51], energyCeiling: .9 }
		]) expect(() => planEnsembleWindow({ phraseId: phrase.id, tempo: 80, bars: [...held.score.bars.slice(0, 51), last] })).toThrow('terminal');
	});
	it('restores frozen native reservation and actual one/two-voice drum receipts through the cache', () => {
		for (const tempo of [80, 140]) {
			const expected = generateBackingCached(phrase.harmony, style, input(tempo));
			const restored = generateBackingCached(phrase.harmony, style, input(tempo));
			expect(restored).toEqual(expected);
			const receipt = restored.ensembleDevelopment!.terminalArrangements![0];
			expect(receipt.status).toBe('accepted');
			if (receipt.status !== 'accepted') throw new Error('Expected admitted Ballad ending');
			for (const value of [receipt, receipt.drums, ...receipt.drums, receipt.piano.notes,
				restored.ensemblePlan!.bars[51].terminalArrangement]) expect(Object.isFrozen(value)).toBe(true);
		}
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBacking, generateBackingCached, type BackingGenerationParams } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import { assessTerminalArrangement, realizeTerminalArrangement } from '$lib/audio/backing-terminal';
import { seedFrom } from '$lib/audio/generation-rng';
import { planEnsembleWindow } from '$lib/audio/ensemble-plan';
import * as bassGenerator from '$lib/audio/backing-bass';
import * as voicings from '$lib/audio/coordinated-voicing';

const style = BACKING_STYLES['bossa-nova'];
function input(key: 'C' | 'F#' = 'C', hold = true) {
	const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key, soloChoruses: 2 });
	const params: BackingGenerationParams = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
		sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {},
		...(hold ? { terminalArrangement: { ending: 'hold-release', melody: phrase.notes } } : {}) };
	return { phrase, params };
}
function rolling(key: 'C' | 'F#' = 'C', hold = true, loops = 1) {
	const { phrase, params } = input(key, hold);
	const score = createRollingBacking(phrase.harmony, style, params, { loopCount: loops });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const bars = [];
	for (let bar = 0; bar < score.totalBars; bar++) {
		const next = advanceRollingBacking(score, checkpoint); bars.push(next); checkpoint = next.checkpoint;
	}
	return { phrase, params, score, bars, last: bars.at(-1)! };
}
function context() {
	const held = rolling(), ordinary = rolling('C', false), prior = held.bars[50].checkpoint;
	return { held, ordinary, prior, candidate: { reservation: held.score.terminalArrangement!, plan: held.last.ensemblePlan.bars[0],
		style, phraseId: held.phrase.id, tempo: 140, ppq: 192, segmentIndex: held.phrase.harmony.length - 1,
		previousBass: prior.bass.previousMidi, previousVoicing: prior.piano.voicing, previousContour: prior.piano.contour,
		ordinaryBass: ordinary.last.bassEvents, ordinaryDrums: ordinary.last.drumEvents } };
}
const rebind = (checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint => {
	const { checkpointId: _id, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
};
afterEach(() => vi.restoreAllMocks());

describe('Bossa explicit native terminal hold', () => {
	it.each(['C', 'F#'] as const)('%s retains only the actual native downbeat kit and quiet onbeat piano', key => {
		const { phrase, params } = input(key);
		const ordinary = generateBacking(phrase.harmony, style, input(key, false).params);
		const held = generateBacking(phrase.harmony, style, params);
		const piano = held.compEvents.filter(event => event.absBeat >= 204), bass = held.bassEvents.filter(event => event.absBeat >= 204);
		const drums = held.drumEvents.filter(event => event.absBeat >= 204);
		expect(piano).toHaveLength(1); expect(bass).toHaveLength(1);
		expect(drums.map(event => event.drum)).toEqual(key === 'C' ? ['kick', 'hihat', 'crossstick'] : ['kick', 'hihat']);
		expect(drums.map(event => [event.drum, event.velocity])).toEqual(ordinary.drumEvents.filter(event => event.absBeat === 204).map(event => [event.drum, event.velocity]));
		expect(bass[0].velocity).toBe(ordinary.bassEvents.find(event => event.absBeat === 204)!.velocity);
		expect(bass[0].midi % 12).toBe(key === 'C' ? 0 : 6);
		expect(piano[0].velocity).toBeGreaterThanOrEqual(50); expect(piano[0].velocity).toBeLessThanOrEqual(60);
		expect(piano[0].duration).toBe(120 / 140); expect(bass[0].duration).toBe(piano[0].duration);
		expect([...piano, ...bass, ...drums].every(event => event.time === '39168i' && event.absBeat === 204)).toBe(true);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(held[field].filter(event => event.absBeat < 204)).toEqual(ordinary[field].filter(event => event.absBeat < 204));
		const trace = held.ensembleDevelopment!.drumPhrases.at(-1)!;
		expect(trace.style).toBe('bossa-nova'); expect(trace.ride.onsets).toEqual([]); expect(trace.ride).not.toHaveProperty('voice');
		expect(trace.hits.map(hit => [hit.drum, hit.velocity])).toEqual(drums.map(event => [event.drum, event.velocity]));
	});
	it.each(['C', 'F#'] as const)('%s keeps accepted contour and excludes Swing dialogue state', key => {
		const held = rolling(key), ordinary = rolling(key, false);
		expect(held.last.compEvents).toHaveLength(1);
		expect(held.last.checkpoint.piano.contour?.lastTopMidi).toBe(Math.max(...held.last.compEvents[0].notes));
		expect(held.last.checkpoint.piano.voicing?.notes).toEqual(held.last.compEvents[0].notes);
		expect(held.last.checkpoint.piano).not.toHaveProperty('phraseRecall');
		for (const field of ['pianoAnswer', 'pianoRecovery']) expect(held.last.checkpoint).not.toHaveProperty(field);
		expect(held.last.checkpoint.drums.previousCompIsSharedArrival).toBe(true);
		expect(held.last.checkpoint.drums).not.toHaveProperty('previousCompIsDrumReply');
		expect(held.score.bars[51]).not.toHaveProperty('pianoArrivalPolicy');
		for (let bar = 0; bar < 51; bar++) for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(held.bars[bar][field]).toEqual(ordinary.bars[bar][field]);
		expect(advanceRollingBacking(held.score, JSON.parse(JSON.stringify(held.bars[50].checkpoint)))).toEqual(held.last);
		expect(() => advanceRollingBacking(held.score, JSON.parse(JSON.stringify(held.last.checkpoint)))).toThrow('complete');
	});
	it('requires the native profile and complete accepted kit without inventing a voice', () => {
		const { candidate } = context();
		const hat = candidate.ordinaryDrums.find(event => event.absBeat === 204 && event.drum === 'hihat')!;
		const { profile: _profile, ...unprofiled } = candidate.reservation;
		for (const value of [
			{ ...candidate, reservation: unprofiled }, { ...candidate, style: BACKING_STYLES.ballad }, { ...candidate, style: BACKING_STYLES.swing },
			{ ...candidate, ordinaryBass: [] }, { ...candidate, ordinaryDrums: [] },
			{ ...candidate, ordinaryDrums: candidate.ordinaryDrums.filter(event => event.drum !== 'hihat') },
			{ ...candidate, ordinaryDrums: candidate.ordinaryDrums.filter(event => event.drum !== 'kick') },
			{ ...candidate, ordinaryDrums: [...candidate.ordinaryDrums, hat] },
			{ ...candidate, ordinaryDrums: [...candidate.ordinaryDrums, { ...hat, drum: 'ride' as const }] },
			{ ...candidate, ordinaryDrums: candidate.ordinaryDrums.map(event => event === hat ? { ...event, drum: 'hihat-pedal' as const } : event) },
			{ ...candidate, ordinaryDrums: candidate.ordinaryDrums.map(event => event === hat ? { ...event, velocity: NaN } : event) },
			{ ...candidate, plan: { ...candidate.plan, responseOwner: 'piano' as const } }, { ...candidate, precedingRelease: true }, { ...candidate, committedLaunch: true }
		]) expect(realizeTerminalArrangement(value).decision.status).toBe('withheld');
		const before = JSON.stringify(candidate.ordinaryDrums);
		expect(realizeTerminalArrangement(candidate).decision.status).toBe('accepted');
		expect(JSON.stringify(candidate.ordinaryDrums)).toBe(before);
	});
	it('retains complete ordinary fixed output on an overlapping preceding pitched release', () => {
		const { phrase, params } = input(); const original = bassGenerator.generateBossaBass;
		vi.spyOn(bassGenerator, 'generateBossaBass').mockImplementation((...args) => {
			const result = original(...args), prior = result.events.filter(event => event.absBeat < 204).at(-1)!;
			prior.duration = (39168 - parseInt(prior.time)) * 60 / 140 / 192 + .1; return result;
		});
		const ordinary = generateBacking(phrase.harmony, style, input('C', false).params), held = generateBacking(phrase.harmony, style, params);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(held[field]).toEqual(ordinary[field]);
		expect(held.ensembleDevelopment!.terminalArrangements).toMatchObject([{ status: 'withheld', reason: 'preceding_release' }]);
	});
	it('rolls back rejected voicing including ordinary actual instrument histories', () => {
		const { held, ordinary, prior } = context(), resolve = voicings.resolveCoordinatedVoicing;
		vi.spyOn(voicings, 'resolveCoordinatedVoicing').mockImplementation(value => ({ ...resolve(value), notes: [] }));
		const actual = advanceRollingBacking(held.score, prior);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary.last[field]);
		for (const field of ['piano', 'bass', 'drums'] as const) expect(actual.checkpoint[field]).toEqual(ordinary.last.checkpoint[field]);
		expect(actual.ensembleDevelopment.terminalArrangements).toMatchObject([{ status: 'withheld', reason: 'unrealizable' }]);
	});
	it('binds native identity and rejects altered profile or early joint provenance with valid checksums', () => {
		const { held, prior } = context();
		const fingerprint = prior.fingerprint.replace('bossa-v1', 'ballad-v1'); expect(fingerprint).not.toBe(prior.fingerprint);
		expect(() => advanceRollingBacking(held.score, rebind({ ...prior, fingerprint }))).toThrow('checkpoint');
		for (const value of [
			{ ...held.bars[20].checkpoint, drums: { ...held.bars[20].checkpoint.drums, previousCompIsSharedArrival: true as const, previousCompOnsets: [0] } },
			{ ...held.last.checkpoint, drums: { ...held.last.checkpoint.drums, previousCompIsSharedArrival: undefined } },
			{ ...held.last.checkpoint, piano: { ...held.last.checkpoint.piano, recentFigures: [] } }
		]) expect(() => advanceRollingBacking(held.score, rebind(value))).toThrow('checkpoint');
		const { profile: _profile, ...unprofiled } = held.score.terminalArrangement!;
		for (const final of [{ ...held.score.bars[51], terminalArrangement: unprofiled }, { ...held.score.bars[51], pianoArrivalPolicy: 'shared-v1' as const }])
			expect(() => planEnsembleWindow({ phraseId: held.phrase.id, tempo: 140, bars: [...held.score.bars.slice(0, 51), final] })).toThrow('terminal');
	});
	it('supports a known four-beat sustain only in the last declared loop', () => {
		const { phrase, params } = input(); const melody = structuredClone(phrase.notes); melody.at(-1)!.duration = [1, 1];
		const score = createRollingBacking(phrase.harmony, style, { ...params, terminalArrangement: { ending: 'hold-release', melody } }, { loopCount: 2 });
		const ordinary = rolling('C', false, 2); let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const actual = advanceRollingBacking(score, checkpoint);
			if (bar < 103) for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary.bars[bar][field]);
			if ([51, 52, 102, 103].includes(bar)) expect(advanceRollingBacking(score, checkpoint && JSON.parse(JSON.stringify(checkpoint)))).toEqual(actual);
			if (bar === 103) { expect(actual.compEvents[0].duration).toBe(240 / 140); expect(actual.bassEvents[0].duration).toBe(240 / 140); }
			checkpoint = actual.checkpoint;
		}
	});
	it('freezes native cached receipts and leaves the actual profile visible', () => {
		const { phrase, params } = input();
		expect(assessTerminalArrangement(phrase.harmony, style, params)).toMatchObject({ available: true, reservation: { profile: 'bossa-v1' } });
		const first = generateBackingCached(phrase.harmony, style, params), restored = generateBackingCached(phrase.harmony, style, params);
		expect(restored).toEqual(JSON.parse(JSON.stringify(first))); const receipt = restored.ensembleDevelopment!.terminalArrangements![0];
		expect(receipt.status).toBe('accepted'); if (receipt.status !== 'accepted') throw new Error('Expected accepted Bossa');
		for (const value of [receipt, receipt.drums, ...receipt.drums, receipt.piano.notes, restored.ensemblePlan!.bars[51].terminalArrangement]) expect(Object.isFrozen(value)).toBe(true);
	});
});

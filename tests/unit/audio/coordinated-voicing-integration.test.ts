import { describe, expect, it } from 'vitest';
import { generateBacking, generateComping, buildBarInfos, type CompEvent } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { createRollingBacking } from '$lib/audio/backing-rolling';
import { realizeRollingPiano, type RollingPianoMemory } from '$lib/audio/backing-rolling-piano';
import { restoreEnsembleTiming } from '$lib/audio/ensemble-timing';
import { resolveCoordinatedVoicing } from '$lib/audio/coordinated-voicing';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';

const withoutPitches = (events: readonly CompEvent[]) => events.map(({ notes: _notes, ...event }) => event);
const session = buildListeningTuneSession({ tuneId: LISTENING_TUNES.find((tune) => tune.title === 'When the Saints Go Marching In')!.id, soloChoruses: 2 });

describe.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('%s coordinated voicing integration', (id) => {
	it('preserves each style’s attack rhythm, articulation and dynamics under identical ensemble decisions', () => {
		const style = BACKING_STYLES[id];
		const params = { phraseId: `native-voicing-${id}`, tempo: 140, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
			sectionMap: session.phrase.sectionMap, performanceForm: session.phrase.performanceForm, ensemble: {} };
		const actual = generateBacking(session.phrase.harmony, style, params);
		const infos = buildBarInfos(session.bars.length, undefined, session.phrase.performanceForm).map((info, barIndex) => ({
			...info, ensemble: actual.ensemblePlan!.bars[barIndex], intensity: actual.ensemblePlan!.bars[barIndex].energy
		}));
		// Only remove eligibility for the new voicing policy; all musical
		// budgets, energy, rhythm choices and timing remain the same.
		const legacyInfos = infos.map((info) => ({ ...info, ensemble: { ...info.ensemble, performanceEnergy: undefined } }));
		const timing = restoreEnsembleTiming({ phraseId: params.phraseId, tempo: params.tempo, ppq: params.ppq,
			swing: params.swing, trace: actual.ensembleTiming!, timingProfiles: style.timing });
		const fixed = generateComping(session.phrase.harmony, 4, style, { ...params, ensembleTiming: timing }, infos);
		const legacy = generateComping(session.phrase.harmony, 4, style, { ...params, ensembleTiming: timing }, legacyInfos);
		expect(withoutPitches(fixed.events)).toEqual(withoutPitches(legacy.events));
		expect(fixed.onsetsByBar).toEqual(legacy.onsetsByBar);
		expect(fixed.events.map((event) => event.notes)).not.toEqual(legacy.events.map((event) => event.notes));
		expect(fixed.voicingTrace).toHaveLength(fixed.events.length);
		for (const [index, event] of fixed.events.entries()) {
			expect(fixed.voicingTrace![index]).toMatchObject({ absBeat: event.absBeat, time: event.time, notes: event.notes });
		}

		const score = createRollingBacking(session.phrase.harmony, style, params);
		let memory: RollingPianoMemory | undefined;
		let legacyMemory: RollingPianoMemory | undefined;
		let voicedAttacks = 0;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const next = realizeRollingPiano(score, bar, infos[bar], timing, memory);
			const old = realizeRollingPiano(score, bar, legacyInfos[bar], timing, legacyMemory);
			expect(withoutPitches(next.events)).toEqual(withoutPitches(old.events));
			expect(next.trace).toEqual(old.trace);
			expect(next.voicingTrace).toHaveLength(next.events.length);
			voicedAttacks += next.events.length;
			if (next.events.length) expect(next.memory.voicing?.notes).toEqual(next.events.at(-1)!.notes);
			memory = next.memory; legacyMemory = old.memory;
		}
		expect(voicedAttacks).toBeGreaterThan(0);
	});
});

it('preserves concrete diminished, suspended and altered identities rather than inferring them from interval order', () => {
	const pcs = (root: 'C' | 'F' | 'G', quality: 'dim7' | 'sus4' | '7b9' | '7#9' | 'min6' | 'min7b5', family: 'guide' | 'drop2' | 'quartal') => {
		const result = resolveCoordinatedVoicing({ chord: { root, quality }, family, registerMidi: 62 });
		return new Set(result.notes.map((note) => note % 12));
	};
	// C diminished seventh: E-flat and A; C minor sixth uses the same
	// defining pair without inventing a B-flat seventh.
	expect(pcs('C', 'dim7', 'guide')).toEqual(new Set([3, 9]));
	expect(pcs('C', 'min6', 'guide')).toEqual(new Set([3, 9]));
	// F suspended fourth: B-flat and E-flat, with no A major third.
	expect(pcs('F', 'sus4', 'guide')).toEqual(new Set([10, 3]));
	// G7b9: G, B, A-flat and F; G7#9: G, B, A-sharp and F.
	expect(pcs('G', '7b9', 'drop2')).toEqual(new Set([7, 11, 8, 5]));
	expect(pcs('G', '7#9', 'drop2')).toEqual(new Set([7, 11, 10, 5]));
	// The unsupported C half-diminished quartal family must fall back to
	// its legal rootless E-flat, G-flat, B-flat and D, never a natural G.
	expect(pcs('C', 'min7b5', 'quartal')).toEqual(new Set([3, 6, 10, 2]));
});

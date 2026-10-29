import { describe, expect, it } from 'vitest';
import { planEnsembleWindow, type EnsembleBarContext } from '$lib/audio/ensemble-plan';
import { planDrumPhrases } from '$lib/audio/backing-drum-phrases';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { sharedArrivalTick } from '$lib/audio/backing-arrival';
import { seedFrom } from '$lib/audio/generation-rng';
import { buildBarInfos, generateComping, generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';

const session = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'F#', soloChoruses: 2 });
const params = { phraseId: session.phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
	sectionMap: session.phrase.sectionMap, performanceForm: session.phrase.performanceForm, ensemble: {} };

describe.each(['swing', 'straight'] as const)('%s selected piano arrivals', styleId => {
	const style = BACKING_STYLES[styleId];
	it('catches an existing real-tune shared arrival with exactly one current-harmony chord', () => {
		const score = generateBacking(session.phrase.harmony, style, { ...params, swing: style.defaultSwing });
		// Existing seed reserves this arrival; the old renderer leaves piano silent.
		const bar = 4;
		expect(score.ensemblePlan!.bars[bar].coordinatedAccent?.id).toBe(`arrival:${bar}`);
		const chords = score.compEvents.filter(event => Math.floor(event.absBeat / 4) === bar);
		expect(chords).toHaveLength(1);
		expect(chords[0].absBeat).toBe(bar * 4);
		expect(score.ensembleDevelopment!.pianoMotifs[bar].hits).toEqual([{ b: 0, d: 0.45 }]);
		expect(score.ensembleDevelopment!.pianoVoicings!.find(trace => trace.arrivalId === `arrival:${bar}`)).toMatchObject({ time: chords[0].time, notes: chords[0].notes });
		expect(chords[0].time).toBe(score.bassEvents.find(event => event.absBeat === bar * 4)!.time);
		expect(score.drumEvents.some(event => event.absBeat === bar * 4 && event.role === 'accent' && event.time === chords[0].time)).toBe(true);
		for (const prior of score.compEvents.filter(event => event.absBeat < bar * 4)) {
			expect(parseInt(prior.time) + prior.duration * params.tempo / 60 * params.ppq).toBeLessThanOrEqual(parseInt(chords[0].time) + 1e-8);
		}
	});

	it('restores a committed setup and catches the next arrival without changing its promise', () => {
		const definition = createRollingBacking(session.phrase.harmony, style, { ...params, swing: style.defaultSwing });
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 4; bar++) checkpoint = advanceRollingBacking(definition, checkpoint).checkpoint;
		const next = advanceRollingBacking(definition, checkpoint);
		expect(next).toEqual(advanceRollingBacking(definition, JSON.parse(JSON.stringify(checkpoint))));
		expect(next.ensemblePlan.bars[0].coordinatedAccent).toEqual(checkpoint!.ensemble.pendingArrival);
		expect(next.compEvents).toHaveLength(1);
		expect(next.checkpoint.piano.recentFigures.at(-1)).toBe('shared-arrival');
		expect(next.compEvents[0].time).toBe(next.bassEvents[0].time);
		const dense = advanceRollingBacking(definition, checkpoint, [{ barIndex: 4, observedAtBar: 3,
			source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]);
		expect(dense.compEvents).toEqual([]);
		expect(dense.ensemblePlan.bars[0].coordinatedAccent).toEqual(checkpoint!.ensemble.pendingArrival);
	});
});


it('preserves deliberate phrase space and recovery while admitting only positive ordinary support', () => {
	const definition = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, { ...params, swing: 0.67 });
	const reasons = new Set<string>();
	for (let seed = 0; seed < 96; seed++) {
		const result = planEnsembleWindow({ phraseId: `arrival-policy:${seed}`, tempo: 140, bars: definition.bars });
		for (const bar of result.plan.bars) {
			const arrival = bar.piano.arrival;
			if (!arrival) continue;
			reasons.add(arrival.reason);
			expect(Object.isFrozen(arrival)).toBe(true);
			expect(arrival.accentId).toBe(bar.coordinatedAccent!.id);
			expect(bar.coordinatedAccent!.participants).toEqual(['bass', 'drums']);
			if (bar.phraseIntent === 'leave_space' || bar.phraseIntent === 'release') {
				expect(arrival.action).toBe('withhold');
			}
			if (arrival.action === 'catch') {
				expect(arrival.reason).toBe('shared_arrival');
				expect(bar.piano.maxAttacks).toBe(1);
				expect(bar.responseOwner).toBe('nobody');
			} else expect(bar.piano.maxAttacks).toBe(0);
		}
	}
	expect(reasons.has('shared_arrival')).toBe(true);
	expect(reasons.has('deliberate_space')).toBe(true);
	expect(reasons.has('after_response')).toBe(true);
});

it('binds direct planner memory to scoped arrival policy and rejects malformed contexts', () => {
	const definition = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, { ...params, swing: 0.67 });
	const input = { phraseId: params.phraseId, tempo: params.tempo, bars: definition.bars };
	const prefix = planEnsembleWindow({ ...input, endBarExclusive: 4 });
	const whole = planEnsembleWindow(input);
	const continuation = planEnsembleWindow({ ...input, memory: JSON.parse(JSON.stringify(prefix.memory)) });
	expect([...prefix.plan.bars, ...continuation.plan.bars]).toEqual(whole.plan.bars);
	const priorBars = definition.bars.map(({ pianoArrivalPolicy: _policy, ...bar }) => bar);
	const prior = planEnsembleWindow({ ...input, bars: priorBars, endBarExclusive: 4 });
	expect(prior.memory.formFingerprint).not.toBe(prefix.memory.formFingerprint);
	expect(() => planEnsembleWindow({ ...input, memory: prior.memory })).toThrow(/form|memory/i);
	const malformed = definition.bars.map(bar => ({ ...bar, pianoArrivalPolicy: 'guessed' })) as unknown as EnsembleBarContext[];
	expect(() => planEnsembleWindow({ ...input, bars: malformed })).toThrow(/arrival policy/i);
	const implicit = definition.bars.map(({ performanceEnergy: _energy, ...bar }) => bar);
	expect(() => planEnsembleWindow({ ...input, bars: implicit })).toThrow(/arrival policy/i);
});

it('rejects a prior rolling policy even with a recomputed integrity checksum', () => {
	const definition = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, { ...params, swing: 0.67 });
	const checkpoint = advanceRollingBacking(definition).checkpoint;
	const fingerprint = definition.fingerprint.replace(',"pianoArrivalVersion":1', '');
	expect(fingerprint).not.toBe(definition.fingerprint);
	const { checkpointId: _id, ...contents } = { ...checkpoint, fingerprint };
	const checkpointId = `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
	expect(() => advanceRollingBacking(definition, { ...contents, checkpointId })).toThrow(/checkpoint/i);
});


it('never resumes an early shared catch inside the preceding reserved rest', () => {
	const style = BACKING_STYLES.swing;
	const input = { ...params, swing: style.defaultSwing };
	const generated = generateBacking(session.phrase.harmony, style, input);
	const bars = buildBarInfos(session.bars.length, undefined, session.phrase.performanceForm).map((info, bar) => ({
		...info, intensity: generated.ensemblePlan!.bars[bar].energy, ensemble: generated.ensemblePlan!.bars[bar]
	}));
	bars[3] = { ...bars[3], ensemble: { ...bars[3].ensemble, piano: { ...bars[3].ensemble.piano, maxAttacks: 0 } } };
	// A bounded negative shared-motion fixture reproduces the timing conflict
	// independently of which phrase seed currently happens to reserve an arrival.
	const timing = { trace: [], arrivalTick: (bar: number) => bar * 4 * params.ppq - 3,
		place: (beat: number) => beat * params.ppq + 2 };
	const actual = generateComping(session.phrase.harmony, 4, style, { ...input, ensembleTiming: timing }, bars);
	const catchHit = actual.events.find(event => event.absBeat === 16)!;
	expect(catchHit.time).toBe(`${16 * params.ppq}i`);
	expect(actual.events.some(event => event.absBeat >= 12 && event.absBeat < 16)).toBe(false);
	expect(sharedArrivalTick(timing, bars[4].ensemble, params.ppq)).toBe(parseInt(catchHit.time));
	const withheld = { ...bars[4].ensemble, piano: { ...bars[4].ensemble.piano,
		arrival: { ...bars[4].ensemble.piano.arrival!, action: 'withhold' as const, reason: 'soloist_dense' as const }, maxAttacks: 0 as const } };
	expect(sharedArrivalTick(timing, withheld, params.ppq)).toBe(parseInt(catchHit.time));
	const legacy = { ...bars[4].ensemble, piano: { ...bars[4].ensemble.piano, arrival: undefined } };
	expect(sharedArrivalTick(timing, legacy, params.ppq)).toBe(16 * params.ppq - 3);
	expect(timing.place(16.5)).toBe(16.5 * params.ppq + 2);
});


it('keeps joint arrival onsets as evidence without inviting a redundant drum answer', () => {
	const phrase = BACKING_LAB_PRESETS.find(preset => preset.id === 'lab-aaba-c')!.phrase;
	const definition = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, {
		phraseId: 'drum-piano-feedback:14', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67,
		performanceForm: phrase.performanceForm, ensemble: {}
	});
	let checkpoint: RollingBackingCheckpoint | undefined;
	const jointBars = new Set<number>();
	for (let bar = 0; bar <= 51; bar++) {
		const step = advanceRollingBacking(definition, checkpoint);
		const drumDecision = step.ensembleDevelopment.drumPhrases[0];
		if (step.ensemblePlan.bars[0].piano.arrival?.action === 'catch') {
			jointBars.add(bar);
			expect(step.compEvents).toHaveLength(1);
			expect(step.checkpoint.drums.previousCompOnsets).toEqual([0]);
			expect(step.checkpoint.drums.previousCompIsSharedArrival).toBe(true);
			expect(advanceRollingBacking(definition, JSON.parse(JSON.stringify(step.checkpoint))))
				.toEqual(advanceRollingBacking(definition, step.checkpoint));
			for (const [invalidFlag, onsets] of [[false, [0]], ['true', [0]], [true, [0.5]], [true, [0, 1]]] as const) {
				const { checkpointId: _invalidId, ...invalid } = JSON.parse(JSON.stringify(step.checkpoint));
				invalid.drums.previousCompIsSharedArrival = invalidFlag;
				invalid.drums.previousCompOnsets = onsets;
				const checkpointId = `${invalid.sessionId}:${invalid.nextBar}:${seedFrom(JSON.stringify(invalid)).toString(16)}`;
				expect(() => advanceRollingBacking(definition, { ...invalid, checkpointId })).toThrow(/checkpoint/i);
			}
		}
		if (drumDecision.commentary.source === 'piano') {
			expect(jointBars.has(drumDecision.commentary.sourceBar!)).toBe(false);
		}
		if (bar === 50) expect(drumDecision.commentary.source).toBe('vocabulary');
		if (bar === 51) {
			expect(step.ensembleDevelopment.pianoFeedback![0].action).toBe('yield');
			expect(step.compEvents).toEqual([]);
		}
		checkpoint = step.checkpoint;
	}
	expect(jointBars.size).toBeGreaterThan(0);
});


it('keeps ordinary piano statements eligible for drum answers in the shared fixed planner', () => {
	const generated = generateBacking(session.phrase.harmony, BACKING_STYLES.swing, { ...params, swing: 0.67 });
	const catchBars = new Set(generated.ensemblePlan!.bars.filter(bar => bar.piano.arrival?.action === 'catch').map(bar => bar.barIndex));
	for (const decision of generated.ensembleDevelopment!.drumPhrases) {
		if (decision.commentary.source === 'piano') expect(catchBars.has(decision.commentary.sourceBar!)).toBe(false);
	}
	const original = buildBarInfos(4);
	const bars = original.map((info, index) => ({ ...info, ensemble: {
		...generated.ensemblePlan!.bars[index], barIndex: index, phraseStartBar: 0,
		coordinatedAccent: undefined, setupFor: undefined, responseOwner: 'nobody' as const,
		piano: { ...generated.ensemblePlan!.bars[index].piano, arrival: undefined },
		drums: { role: 'support' as const, keepTime: true as const, maxCommentaryHits: index === 0 ? 0 as const : 2 as const,
			commentaryScale: 1, allowFill: false }
	} }));
	let independentAnswers = 0;
	for (let seed = 0; seed < 32; seed++) {
		const input = { phraseId: `joint-arrival-response:${seed}`, tempo: 140, beatsPerBar: 4 as const,
			bars, compOnsetsByBar: new Map([[0, [0]]]), harmonyEndBeat: 16 };
		const ordinary = planDrumPhrases(input);
		const joint = planDrumPhrases({ ...input, bars: bars.map((info, index) => index === 0 ? {
			...info, ensemble: { ...info.ensemble, piano: { ...info.ensemble.piano,
				arrival: { accentId: 'arrival:0', action: 'catch' as const, reason: 'shared_arrival' as const } } }
		} : info) });
		independentAnswers += ordinary.bars.filter(bar => bar.commentary.source === 'piano').length;
		expect(joint.bars.every(bar => bar.commentary.source !== 'piano')).toBe(true);
	}
	expect(independentAnswers).toBeGreaterThan(0);
});

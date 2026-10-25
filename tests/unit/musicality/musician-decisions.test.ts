import { describe, expect, it } from 'vitest';
import { describeMusicianDecisions, describePerformanceArc } from '$lib/musicality/musician-decisions';
import { generateForBounce } from '$lib/audio/backing-bounce';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import type { BackingStyle } from '$lib/types/instruments';
import type { GeneratedBacking } from '$lib/audio/backing-generation';

const context = { barIndex: 0, ppq: 192, beatsPerBar: 4, style: 'swing' as const, orchestration: 'coordinated' as const };
describe('musician decisions from the actual score', () => {
	it('counts actual onset ticks in the sounding bar without inventing decisions for original mode', () => {
		const generated: GeneratedBacking = { bassEvents: [
			{ time: '767i', absBeat: 4, midi: 48, duration: 0.4, velocity: 70 },
			{ time: '768i', absBeat: 4, midi: 50, duration: 0.4, velocity: 70 }
		], compEvents: [], drumEvents: [] };
		const cards = describeMusicianDecisions(generated, { ...context, orchestration: 'original' });
		expect(cards.map((c) => c.eventCount)).toEqual([1, 0, 0]);
		expect(cards.every((c) => c.role === 'Original pattern')).toBe(true);
		expect(cards[0].action).toBe('Carry the bass line');
		expect(cards[1].action).toBe('No new chord attack');
		expect(cards[1].detail).toContain('sustain');
		expect(cards.flatMap((c) => c.evidence).join(' ')).not.toMatch(/soloist|listening|microphone/i);
		expect(describeMusicianDecisions(generated, { ...context, barIndex: 1 })[0].eventCount).toBe(1);
	});
	it.each(['swing', 'straight', 'bossa-nova', 'ballad'] satisfies BackingStyle[])('uses emitted events and native %s traces', (style) => {
		const generated = generateForBounce({ phrase: BACKING_LAB_PRESETS[0].phrase,
			style, tempo: 140, swing: 0.67, instrument: 'piano', volume: 0.7, mix: DEFAULT_BACKING_MIX, orchestration: 'coordinated' });
		for (let barIndex = 0; barIndex < 4; barIndex++) {
			const cards = describeMusicianDecisions(generated, { ...context, style, barIndex });
			for (const [i, events] of [generated.bassEvents, generated.compEvents, generated.drumEvents].entries()) {
				expect(cards[i].eventCount).toBe(events.filter((e) => parseInt(e.time) >= barIndex * 768 && parseInt(e.time) < (barIndex + 1) * 768).length);
			}
			if (style === 'bossa-nova') expect(cards[2].detail).toContain('bossa');
		}
	});
	it('shows actual piano voicings and does not call an un-emitted turnaround a walking gesture', () => {
		const generated = { bassEvents: [], compEvents: [{ time: '0i', absBeat: 0, notes: [60, 64, 67], duration: 1, velocity: 60 }], drumEvents: [],
			ensembleDevelopment: { version: 1, pianoMotifs: [], drumPhrases: [], bassTurnarounds: [{ startBar: 0, arrivalBar: 2, status: 'planned', direction: 'ascending', targetMidi: 48, notes: [{ absBeat: 0, midi: 40 }] }] }
		} as unknown as GeneratedBacking;
		const cards = describeMusicianDecisions(generated, context);
		expect(cards[0].action).toBe('No new bass attack');
		expect(cards[0].detail).toContain('sustain');
		expect(cards[0].evidence).toContain('Turnaround planned into bar 3');
		expect(cards[1].evidence).toContain('Chord 1: C4 · E4 · G4');
	});
	it('exposes only a traced piano answer with its source bar, never a fabricated live response', () => {
		const generated = { bassEvents: [], compEvents: [], drumEvents: [{time: '3072i', absBeat: 16, drum: 'snare', velocity: 0.4, role: 'commentary'}],
			ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [], drumPhrases: [{
				barIndex: 4, commentary: { source: 'piano', sourceBar: 3, transform: 'answer', hits: [{ drum: 'snare' }] }, ride: { mode: 'standard' }
			}] }
		} as unknown as GeneratedBacking;
		const drum = describeMusicianDecisions(generated, { ...context, barIndex: 4 })[2];
		expect(drum.action).toBe('Answer the piano'); expect(drum.evidence).toContain('Piano rhythm from bar 4');
		expect(drum.detail).not.toContain('microphone');
		generated.drumEvents[0].absBeat = 15.99;
		expect(describeMusicianDecisions(generated, { ...context, barIndex: 4 })[2].action).toBe('Keep the groove');
		generated.drumEvents = [];
		expect(describeMusicianDecisions(generated, { ...context, barIndex: 4 })[2].action).toBe('No new drum hit');
	});
});

describe('causal rolling drum-to-piano space evidence', () => {
	function score() {
		const hits = [
			{ time: '963i', absBeat: 5, drum: 'snare', velocity: .4, role: 'commentary' },
			{ time: '1155i', absBeat: 6, drum: 'kick', velocity: .35, role: 'commentary' }
		];
		return { bassEvents: [], compEvents: [] as { time: string; absBeat: number; notes: number[]; duration: number; velocity: number }[], drumEvents: hits,
			ensemblePlan: { version: 1, trace: [], bars: [{ barIndex: 2, phraseIntent: 'support', energy: .4,
				piano: { role: 'support' }, drums: { role: 'time' }, bass: { role: 'time' },
				performanceEnergy: { phase: 'solo_build', chorusIndex: 1, targetEnergy: .5 } }] },
			ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [], drumPhrases: [], pianoFeedback: [{
				version: 1, barIndex: 2, source: { barIndex: 1, transform: 'statement', hits: structuredClone(hits) },
				action: 'yield', reason: 'drum_statement', originalMaxAttacks: 1, effectiveMaxAttacks: 0,
				acceptedAttacks: [] as { time: string; absBeat: number; notes: number[] }[]
			}] } };
	}
	const card = (generated: ReturnType<typeof score>, overrides = {}) => describeMusicianDecisions(generated as unknown as GeneratedBacking, { ...context, barIndex: 2, ...overrides })[1];
	it.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('describes %s space after an actual prior drum statement, without claiming a removed attack', style => {
		const piano = card(score(), { style });
		expect(piano.action).toBe('No new chord attack');
		expect(piano.evidence).toContain('Drum statement in bar 2: snare · kick');
		expect(piano.evidence).toContain('Planned space after the drum statement: no new chord attack');
		expect(piano.evidence).toContain('Scheduled result: no new chord attack');
		expect(piano.evidence.join(' ')).not.toMatch(/removed|fewer|microphone|listening/i);
	});
	it.each(['time', 'absBeat', 'drum', 'velocity', 'role', 'missing', 'single', 'same-bar'] as const)('does not invent a source statement from mismatching %s evidence', field => {
		const generated = score();
		if (field === 'time') generated.drumEvents[0].time = '964i';
		if (field === 'absBeat') generated.drumEvents[0].absBeat = 5.5;
		if (field === 'drum') generated.drumEvents[0].drum = 'ride';
		if (field === 'velocity') generated.drumEvents[0].velocity = .5;
		if (field === 'role') generated.drumEvents[0].role = 'timekeeping';
		if (field === 'missing') generated.drumEvents = [];
		if (field === 'single') generated.ensembleDevelopment.pianoFeedback[0].source.hits.pop();
		if (field === 'same-bar') generated.ensembleDevelopment.pianoFeedback[0].source.barIndex = 2;
		expect(card(generated).evidence.join(' ')).not.toMatch(/Drum statement|Planned space after|Scheduled result/);
	});
	it('keeps the intention separate from an unverified scheduled result', () => {
		const generated = score();
		generated.compEvents.push({ time: '1536i', absBeat: 8, notes: [60, 64, 67], duration: .5, velocity: 60 });
		const piano = card(generated);
		expect(piano.action).toBe('Support the harmony');
		expect(piano.evidence).toContain('Planned space after the drum statement: no new chord attack');
		expect(piano.evidence.join(' ')).not.toContain('Scheduled result:');
	});
	it('does not claim scheduled silence from a nonempty accepted attack trace', () => {
		const generated = score();
		generated.ensembleDevelopment.pianoFeedback[0].acceptedAttacks.push({ time: '1536i', absBeat: 8, notes: [60, 64, 67] });
		expect(card(generated).evidence.join(' ')).not.toContain('Scheduled result:');
	});
	it.each(['already_silent', 'reserved_transition', 'response_reserved', 'cooldown', 'not_selected'] as const)('does not describe %s as a response', reason => {
		const generated = score();
		Object.assign(generated.ensembleDevelopment.pianoFeedback[0], { action: 'none', reason });
		expect(card(generated).evidence.join(' ')).not.toMatch(/Drum statement|Planned space after|Scheduled result/);
	});
	it('does not promote an already-silent budget, Original, fixed exports or a different bar', () => {
		const generated = score();
		expect(card(generated, { orchestration: 'original' }).evidence.join(' ')).not.toContain('drum statement');
		expect(card(generated, { barIndex: 1 }).evidence.join(' ')).not.toContain('drum statement');
		generated.ensembleDevelopment.pianoFeedback[0].originalMaxAttacks = 0;
		expect(card(generated).evidence.join(' ')).not.toContain('drum statement');
		delete (generated.ensembleDevelopment as { pianoFeedback?: unknown }).pianoFeedback;
		expect(card(generated).evidence.join(' ')).not.toContain('drum statement');
	});
});


describe('planned performance arc presentation', () => {
	const stages = [
		['head_in', 'Head in · Leave room for the melody'],
		['solo_build', 'Solo · Build the accompaniment'],
		['solo_peak', 'Solo · Sustain the planned peak'],
		['solo_release', 'Solo · Ease back'],
		['head_return', 'Head return · Return to the melody'],
		['ending', 'Ending · Release the energy']
	] as const;
	function score(phase: string): GeneratedBacking {
		return { bassEvents: [], compEvents: [], drumEvents: [], ensemblePlan: { version: 1, trace: [], bars: [{
			barIndex: 0, phraseIntent: 'support', energy: 0.4, piano: { role: 'support' }, drums: { role: 'time' }, bass: { role: 'time' },
			performanceEnergy: { phase, chorusIndex: 1, targetEnergy: 0.55 }
		}] } } as unknown as GeneratedBacking;
	}
	it.each(stages)('describes %s as a plan separately from actual note activity', (phase, label) => {
		const generated = score(phase);
		expect(describePerformanceArc(generated, context)).toEqual({ phase, label, targetEnergy: 0.55 });
		const cards = describeMusicianDecisions(generated, context);
		for (const card of cards) {
			expect(card.eventCount).toBe(0);
			expect(card.action).toMatch(/^No new/);
			expect(card.evidence).toContain(`Planned performance arc: ${label}`);
			expect(card.evidence).toContain('Nominal arc target: 0.55 / 1; style-adjusted bar plan: 0.40 / 1');
		}
	});
	it('does not infer an arc for Original, missing evidence or a different bar', () => {
		const generated = score('solo_peak');
		const original = { ...context, orchestration: 'original' as const };
		expect(describePerformanceArc(generated, original)).toBeNull();
		expect(describePerformanceArc(generated, { ...context, barIndex: 1 })).toBeNull();
		expect(describePerformanceArc({ bassEvents: [], compEvents: [], drumEvents: [] }, context)).toBeNull();
		expect(describeMusicianDecisions(generated, original).flatMap(card => card.evidence).join(' ')).not.toMatch(/arc|energy target/);
	});
});

describe('structural texture evidence', () => {
	it('describes the selected bass feel and actual bell pulse without inventing sounding notes', () => {
		const generated = { bassEvents: [{ time: '0i', absBeat: 0, midi: 41, duration: 0.7, velocity: 70 }], compEvents: [],
			drumEvents: [{ time: '0i', absBeat: 0, drum: 'ride-bell', velocity: 0.4, role: 'timekeeping' }],
			ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [], bassFeel: [{ barIndex: 0, feel: 'two', reason: 'head_support' }],
				drumPhrases: [{ barIndex: 0, commentary: { source: 'none', hits: [] }, ride: { mode: 'standard', voice: 'ride-bell' } }] }
		} as unknown as GeneratedBacking;
		let cards = describeMusicianDecisions(generated, context);
		expect(cards[0].action).toBe('Support in two');
		expect(cards[0].evidence).toContain('Planned bass feel: two · head support');
		expect(cards[2].detail).toContain('ride bell');
		generated.bassEvents = []; generated.drumEvents = [];
		cards = describeMusicianDecisions(generated, context);
		expect(cards[0].action).toBe('No new bass attack');
		expect(cards[2].action).toBe('No new drum hit');
		expect(cards[2].detail).not.toContain('ride bell');
		const original = describeMusicianDecisions(generated, { ...context, orchestration: 'original' });
		expect(original.flatMap(card => card.evidence).join(' ')).not.toMatch(/Planned bass feel|Cymbal color/);
	});
});

describe('audible piano voice-leading evidence', () => {
	it('binds voicing explanations to the actual sounding attack, including an early boundary attack', () => {
		const event = { time: '767i', absBeat: 4, notes: [53, 59], duration: 0.5, velocity: 65 };
		const generated = { bassEvents: [], compEvents: [event], drumEvents: [], ensembleDevelopment: {
			version: 1, bassTurnarounds: [], pianoMotifs: [], drumPhrases: [], pianoVoicings: [{ ...event, decision: {
				requestedFamily: 'guide', resolvedFamily: 'guide', correction: 'none', guideMotion: 1,
				commonTones: [53], totalMovement: 1, registerDistance: 0, candidateCount: 10
			} }]
		} } as unknown as GeneratedBacking;
		const piano = describeMusicianDecisions(generated, context)[1];
		expect(piano.evidence).toContain('Chord 1 voicing: guide');
		expect(piano.evidence).toContain('Common tones held: F3');
		expect(piano.evidence).toContain('Guide-tone movement: 1 semitone total');
		expect(describeMusicianDecisions(generated, { ...context, barIndex: 1 })[1].evidence.join(' ')).not.toContain('voicing:');
		generated.compEvents = [{ ...event, notes: [54, 60] }];
		expect(describeMusicianDecisions(generated, context)[1].evidence.join(' ')).not.toContain('Common tones held:');
		generated.compEvents = [event];
		expect(describeMusicianDecisions(generated, { ...context, orchestration: 'original' })[1].evidence.join(' ')).not.toContain('voicing:');
	});
	it('does not invent a guide-tone objective when the selected family has none', () => {
		const event = { time: '0i', absBeat: 0, notes: [62, 67, 72], duration: 0.5, velocity: 65 };
		const generated = { bassEvents: [], compEvents: [event], drumEvents: [], ensembleDevelopment: {
			version: 1, bassTurnarounds: [], pianoMotifs: [], drumPhrases: [], pianoVoicings: [{ ...event, decision: {
				requestedFamily: 'quartal', resolvedFamily: 'quartal', correction: 'none', guideMotion: null,
				commonTones: [], totalMovement: 0, registerDistance: 0, candidateCount: 10
			} }]
		} } as unknown as GeneratedBacking;
		const evidence = describeMusicianDecisions(generated, context)[1].evidence;
		expect(evidence).toContain('Chord 1 voicing: quartal');
		expect(evidence.join(' ')).not.toMatch(/Guide-tone movement|Common tones held/);
	});
});

describe('planned and emitted rootless texture evidence', () => {
	function score(request: 'three' | 'full' = 'three', applied: 'three' | 'full' = 'three', eligible = true, notes = [62, 64, 71], family = 'rootless-a') {
		const event = { time: '0i', absBeat: 0, notes, duration: 0.5, velocity: 60 };
		return { bassEvents: [], compEvents: [event], drumEvents: [], ensemblePlan: { version: 1, trace: [], bars: [{
			barIndex: 0, phraseIntent: 'support', energy: 0.4, piano: { role: 'support', rootlessTexture: { request, reason: 'melody_support' } },
			drums: { role: 'time' }, bass: { role: 'time' }
		}] }, ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [] as { barIndex: number; reason: string; motifId: null }[], drumPhrases: [], pianoVoicings: [{ ...event, decision: {
			requestedFamily: family, resolvedFamily: family, correction: 'none', guideMotion: null, commonTones: [], totalMovement: 0,
			registerDistance: 0, candidateCount: 1, rootlessTexture: { request, applied, eligible, noteCount: notes.length }
		} }] } };
	}
	const piano = (generated: ReturnType<typeof score>, options: Parameters<typeof describeMusicianDecisions>[1] = context) => describeMusicianDecisions(generated as unknown as GeneratedBacking, options)[1];
	it.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('explains matching three-note %s attacks without changing the main musical description', (style) => {
		const generated = score();
		if (style === 'bossa-nova' || style === 'ballad') generated.ensembleDevelopment.pianoMotifs.push({ barIndex: 0, reason: 'native_pattern', motifId: null });
		const card = piano(generated, { ...context, style });
		if (style === 'bossa-nova') expect(card.detail).toContain('native bossa');
		if (style === 'ballad') expect(card.detail).toContain('native ballad');
		expect(card.action).toBe('Support the harmony');
		expect(card.evidence).toContain('Planned rootless texture: three-note support · leave room for the melody');
		expect(card.evidence).toContain('Chord 1 texture: three-note rootless support · 3 notes');
	});
	it('keeps a silent bar planned-only and describes qualified activity in musician language', () => {
		const generated = score();
		generated.compEvents = [];
		generated.ensemblePlan.bars[0].piano.rootlessTexture.reason = 'active_soloist';
		const card = piano(generated);
		expect(card.action).toBe('No new chord attack');
		expect(card.evidence).toContain('Planned rootless texture: three-note support · leave room for the soloist');
		expect(card.evidence.join(' ')).not.toContain('Chord 1 texture:');
	});
	it('describes a release as a plan even when the selected family keeps its shape', () => {
		const generated = score('three', 'full', false, [64, 71], 'guide');
		generated.ensemblePlan.bars[0].piano.rootlessTexture.reason = 'structural_release';
		const evidence = piano(generated).evidence;
		expect(evidence).toContain('Planned rootless texture: three-note support · ease back');
		expect(evidence).toContain('Chord 1 texture: selected chord shape kept · 2 notes');
	});
	it.each(['ineligible', 'different-family', 'changed-rootless-family', 'wrong-size'] as const)('does not promote inconsistent %s evidence to a three-note rootless claim', (kind) => {
		const generated = score('three', 'three', kind !== 'ineligible', kind === 'wrong-size' ? [62, 64, 67, 71] : [62, 64, 71], kind === 'different-family' ? 'quartal' : 'rootless-a');
		if (kind === 'changed-rootless-family') generated.ensembleDevelopment.pianoVoicings[0].decision.resolvedFamily = 'rootless-b';
		expect(piano(generated).evidence.join(' ')).not.toContain('Chord 1 texture:');
	});
	it.each(['time', 'absBeat', 'notes', 'count'] as const)('withholds an emitted claim when %s evidence does not match', (field) => {
		const generated = score();
		const voiced = generated.ensembleDevelopment.pianoVoicings[0];
		if (field === 'time') voiced.time = '1i';
		if (field === 'absBeat') voiced.absBeat = 0.5;
		if (field === 'notes') voiced.notes = [62, 65, 71];
		if (field === 'count') voiced.decision.rootlessTexture.noteCount = 4;
		expect(piano(generated).evidence.join(' ')).not.toContain('Chord 1 texture:');
	});
	it.each([
		['guide', [64, 71]], ['shell', [60, 64, 71]], ['quartal', [62, 67, 72]], ['rootless-b', [62, 64, 69, 70]]
	] as const)('describes preserved %s shapes by their actual note count', (family, notes) => {
		const generated = score('three', 'full', false, [...notes], family);
		const evidence = piano(generated).evidence;
		expect(evidence).toContain(`Chord 1 texture: selected chord shape kept · ${notes.length} notes`);
		expect(evidence).not.toContain('Chord 1 texture: three-note rootless support · 3 notes');
	});
	it('describes full texture as keeping the selected shape, not promising four notes', () => {
		const generated = score('full', 'full', true, [62, 64, 67, 71]);
		generated.ensemblePlan.bars[0].piano.rootlessTexture.reason = 'solo_development';
		const evidence = piano(generated).evidence;
		expect(evidence).toContain('Planned rootless texture: keep the selected chord shape · support the solo');
		expect(evidence).toContain('Chord 1 texture: selected chord shape kept · 4 notes');
	});
	it('shows no new texture claims for Original or old exports without texture fields', () => {
		const generated = score();
		const original = describeMusicianDecisions(generated as unknown as GeneratedBacking, { ...context, orchestration: 'original' })[1];
		expect(original.evidence.join(' ')).not.toMatch(/texture|rootless support/);
		const legacy = structuredClone(generated) as unknown as GeneratedBacking;
		delete (legacy.ensemblePlan!.bars[0].piano as { rootlessTexture?: unknown }).rootlessTexture;
		delete (legacy.ensembleDevelopment!.pianoVoicings![0].decision as { rootlessTexture?: unknown }).rootlessTexture;
		expect(describeMusicianDecisions(legacy, context)[1].evidence.join(' ')).not.toContain('texture:');
	});
});

describe('piano shared-arrival evidence', () => {
	function score(time = '768i') {
		const chord = { time, absBeat: 4, notes: [62, 64, 71], duration: .5, velocity: 60 };
		return { bassEvents: [{ time, absBeat: 4, midi: 48, duration: .5, velocity: 75 }], compEvents: [chord],
			drumEvents: [{ time, absBeat: 4, drum: 'kick', velocity: .4, role: 'accent' }],
			ensemblePlan: { version: 1, trace: [], bars: [{ barIndex: 1, phraseIntent: 'support', energy: .4,
				performanceEnergy: { phase: 'head_return', chorusIndex: 2, targetEnergy: .4 },
				coordinatedAccent: { id: 'arrival:1', targetBarIndex: 1, beatOffset: 0, strength: 1, participants: ['bass', 'drums'] },
				piano: { role: 'mark_form', maxAttacks: 1, arrival: { accentId: 'arrival:1', action: 'catch', reason: 'shared_arrival' } },
				bass: { role: 'time' }, drums: { role: 'mark_form' }
			}] }, ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [], drumPhrases: [],
				pianoVoicings: [{ ...chord, notes: [...chord.notes], arrivalId: 'arrival:1', decision: {
					requestedFamily: 'rootless-a', resolvedFamily: 'rootless-a', correction: 'none', guideMotion: null,
					commonTones: [], totalMovement: 0, registerDistance: 0, candidateCount: 1
				} }]
			} };
	}
	const card = (generated: ReturnType<typeof score>, options = {}) => describeMusicianDecisions(generated as unknown as GeneratedBacking, { ...context, barIndex: 1, ...options })[1];
	it.each(['swing', 'straight'] as const)('shows an actual single %s catch with the scheduled bass and drum arrival', style => {
		const piano = card(score(), { style });
		expect(piano.action).toBe('Support the harmony');
		expect(piano.evidence).toContain('Planned piano arrival: join the band on the downbeat');
		expect(piano.evidence).toContain('Chord 1 arrival: shared catch with bass and drums');
		expect(piano.evidence).toContain('Chord 1: D4 · E4 · B4');
	});
	it('does not turn planned admission into an emitted catch in a silent bar', () => {
		const generated = score(); generated.compEvents = [];
		const piano = card(generated);
		expect(piano.action).toBe('No new chord attack');
		expect(piano.evidence).toContain('Planned piano arrival: join the band on the downbeat');
		expect(piano.evidence.join(' ')).not.toContain('shared catch');
	});
	it.each([
		['soloist_dense', 'leave room for the soloist'], ['deliberate_space', 'keep the planned space'],
		['after_response', 'leave space after the response'], ['response_reserved', 'keep the assigned response'],
		['ensemble_silence', 'keep the planned rest']
	])('describes %s withholding without implying a played catch', (reason, wording) => {
		const generated = score(); generated.compEvents = [];
		Object.assign(generated.ensemblePlan.bars[0].piano.arrival, { action: 'withhold', reason });
		expect(card(generated).evidence).toContain(`Planned piano arrival: ${wording}`);
		expect(card(generated).evidence.join(' ')).not.toContain('shared catch');
	});
	it.each(['notes', 'time', 'absBeat', 'arrival-id', 'plan-id', 'withheld', 'extra-chord', 'missing-bass', 'drum-time', 'drum-role'] as const)('withholds the shared-catch claim for inconsistent %s evidence', field => {
		const generated = score();
		const trace = generated.ensembleDevelopment.pianoVoicings[0];
		if (field === 'notes') trace.notes = [62, 65, 71];
		if (field === 'time') trace.time = '769i';
		if (field === 'absBeat') trace.absBeat = 4.5;
		if (field === 'arrival-id') trace.arrivalId = 'arrival:2';
		if (field === 'plan-id') generated.ensemblePlan.bars[0].coordinatedAccent.id = 'arrival:2';
		if (field === 'withheld') generated.ensemblePlan.bars[0].piano.arrival.action = 'withhold';
		if (field === 'extra-chord') generated.compEvents.push({ ...generated.compEvents[0], time: '960i', absBeat: 5 });
		if (field === 'missing-bass') generated.bassEvents = [];
		if (field === 'drum-time') generated.drumEvents[0].time = '769i';
		if (field === 'drum-role') generated.drumEvents[0].role = 'timekeeping';
		expect(card(generated).evidence.join(' ')).not.toContain('shared catch');
	});
	it('places an early fixed catch in its actual sounding bar without shifting the planned bar', () => {
		const generated = score('767i');
		const sounding = card(generated, { barIndex: 0 });
		expect(sounding.evidence).toContain('Chord 1 arrival: shared catch with bass and drums');
		expect(sounding.evidence.join(' ')).not.toContain('Planned piano arrival:');
		const planned = card(generated);
		expect(planned.evidence).toContain('Planned piano arrival: join the band on the downbeat');
		expect(planned.evidence.join(' ')).not.toContain('shared catch');
	});
	it('leaves Original, native styles and historical exports without new arrival fields unchanged', () => {
		const generated = score();
		for (const options of [{ orchestration: 'original' }, { style: 'bossa-nova' }, { style: 'ballad' }])
			expect(card(generated, options).evidence.join(' ')).not.toMatch(/Planned piano arrival|shared catch/);
		delete (generated.ensemblePlan.bars[0].piano as { arrival?: unknown }).arrival;
		delete (generated.ensembleDevelopment.pianoVoicings[0] as { arrivalId?: unknown }).arrivalId;
		expect(card(generated).evidence.join(' ')).not.toMatch(/Planned piano arrival|shared catch/);
	});
});

describe('emitted bass scalar-continuation evidence', () => {
	function score(direction: 'up' | 'down' = 'up') {
		const midis = direction === 'up' ? [35, 36, 37] : [39, 37, 36];
		const notes = midis.map((midi, index) => ({ absBeat: 3 + index, time: `${(3 + index) * 192}i`, midi }));
		return { bassEvents: notes.map(note => ({ ...note, duration: .4, velocity: 80 })), compEvents: [], drumEvents: [],
			ensemblePlan: { version: 1, trace: [], bars: [{ barIndex: 1, phraseIntent: 'support', energy: .5,
				performanceEnergy: { phase: 'solo_build', chorusIndex: 1, targetEnergy: .5 },
				bass: { role: 'time' }, piano: { role: 'support' }, drums: { role: 'time' }
			}] }, ensembleDevelopment: { version: 1, pianoMotifs: [], bassTurnarounds: [], drumPhrases: [],
				bassContinuations: [{ barIndex: 1, boundaryAbsBeat: 4, direction, notes }]
			} };
	}
	const card = (generated: ReturnType<typeof score>, options = {}) => describeMusicianDecisions(generated as unknown as GeneratedBacking, { ...context, barIndex: 1, ...options })[0];
	it.each(['up', 'down'] as const)('explains an actual %sward quarter-note continuation without changing the main card', direction => {
		const generated = score(direction);
		const bass = card(generated);
		expect(bass.action).toBe('Carry the bass line');
		expect(bass.evidence).toContain(`Quarter-note line continues ${direction}ward through the chord change`);
		expect(card(generated, { barIndex: 0 }).evidence.join(' ')).not.toContain('continues');
	});
	it.each(['missing-note', 'midi', 'time', 'absBeat', 'direction', 'boundary', 'bar', 'leap', 'ornament', 'out-of-order'] as const)('withholds an audible-continuation claim for %s evidence', field => {
		const generated = score();
		const trace = generated.ensembleDevelopment.bassContinuations[0];
		if (field === 'missing-note') generated.bassEvents.pop();
		if (field === 'midi') trace.notes[2].midi = 38;
		if (field === 'time') trace.notes[2].time = '961i';
		if (field === 'absBeat') trace.notes[2].absBeat = 5.5;
		if (field === 'direction') trace.direction = 'down';
		if (field === 'boundary') trace.boundaryAbsBeat = 8;
		if (field === 'bar') trace.barIndex = 2;
		if (field === 'leap') { trace.notes[2].midi = 43; generated.bassEvents[2].midi = 43; }
		if (field === 'ornament') generated.bassEvents.push({ absBeat: 3.5, time: '672i', midi: 34, duration: .1, velocity: 55 });
		if (field === 'out-of-order') { trace.notes[0].time = '970i'; generated.bassEvents[0].time = '970i'; }
		expect(card(generated).evidence.join(' ')).not.toContain('continues');
	});
	it('keeps silent bars, Original, native patterns and historical exports free of new claims', () => {
		const generated = score();
		for (const options of [{ orchestration: 'original' }, { style: 'bossa-nova' }, { style: 'ballad' }, { barIndex: 2 }])
			expect(card(generated, options).evidence.join(' ')).not.toContain('continues');
		delete (generated.ensembleDevelopment as { bassContinuations?: unknown }).bassContinuations;
		expect(card(generated).evidence.join(' ')).not.toContain('continues');
	});
});

describe('accepted piano answer and drummer space', () => {
	function score() {
		const sourceHits = [1.5, 3.5].map(absBeat => ({ absBeat, time: `${absBeat * 192}i`, drum: 'snare', velocity: .3, role: 'commentary' }));
		const hitSpecs = sourceHits.map(({ absBeat, drum, velocity, role }) => ({ beatOffset: absBeat, drum, velocity, role }));
		const attack = { absBeat: 6.5, time: '1248i', notes: [62, 65, 69], duration: .2, velocity: 60 };
		const ride = { mode: 'quarters-only', phase: 'single', skipOffsets: [], velocityScale: 1, onsets: [0, 1, 2, 3] };
		return { bassEvents: [], compEvents: [{ ...attack, notes: [...attack.notes] }],
			drumEvents: [...sourceHits, ...[4, 5, 6, 7].map(absBeat => ({ absBeat, time: `${absBeat * 192}i`, drum: 'ride', velocity: .4, role: 'timekeeping' }))],
			ensemblePlan: { version: 1, trace: [], bars: [{ barIndex: 1, phraseIntent: 'support', energy: .5,
				performanceEnergy: { phase: 'solo_build', chorusIndex: 1, targetEnergy: .5 },
				bass: { role: 'time' }, piano: { role: 'support' }, drums: { role: 'time' }
			}] }, ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [{ barIndex: 1, motifId: null, sourceFigureId: null,
				transform: 'fallback', hits: [{ b: 2.5, d: .4 }], reason: 'drum_reply' }],
				pianoAnswers: [{ version: 1, barIndex: 1, source: { barIndex: 0, transform: 'statement', hits: sourceHits.map(hit => ({ ...hit })) },
					attack, replyOffset: 2.5, drumCommentary: 'space' }],
				drumPhrases: [{ version: 1, barIndex: 0, phraseStartBar: 0, phraseLength: 4, ride,
					commentary: { source: 'vocabulary', transform: 'statement', motifId: 'drum:0', hits: hitSpecs }, hits: hitSpecs },
					{ version: 1, barIndex: 1, phraseStartBar: 0, phraseLength: 4, ride,
						commentary: { source: 'vocabulary', transform: 'space', motifId: 'drum:0', hits: [], reason: 'ensemble_silence' }, hits: [] }]
			} };
	}
	const cards = (generated: ReturnType<typeof score>, options = {}) => describeMusicianDecisions(generated as unknown as GeneratedBacking, { ...context, barIndex: 1, ...options });
	it.each(['swing', 'straight'] as const)('describes the accepted %s answer and actual commentary space only in details', style => {
		const result = cards(score(), { style });
		expect(result[1].action).toBe('Support the harmony');
		expect(result[2].action).toBe('Keep the groove');
		expect(result[1].evidence).toContain('Answer the drum phrase from bar 1 with one chord');
		expect(result[2].evidence).toContain('Leave commentary space for the piano answer');
		expect(result[1].evidence).toContain('Chord 1: D4 · F4 · A4');
	});
	it.each(['missing-source', 'source-time', 'source-velocity', 'same-bar', 'piano-derived', 'source-transform', 'missing-attack',
		'notes', 'time', 'duration', 'velocity', 'extra-chord', 'reply-offset', 'missing-reply-trace', 'drum-commentary', 'drum-trace', 'solo-peak'] as const)(
		'withholds the reciprocal explanation for inconsistent %s evidence', field => {
			const generated = score(); const answer = generated.ensembleDevelopment.pianoAnswers[0];
			if (field === 'solo-peak') generated.ensemblePlan.bars[0].performanceEnergy.phase = 'solo_peak';
			if (field === 'missing-source') generated.drumEvents.shift();
			if (field === 'source-time') answer.source.hits[0].time = '289i';
			if (field === 'source-velocity') answer.source.hits[0].velocity = .4;
			if (field === 'same-bar') answer.source.barIndex = 1;
			if (field === 'piano-derived') generated.ensembleDevelopment.drumPhrases[0].commentary.source = 'piano';
			if (field === 'source-transform') generated.ensembleDevelopment.drumPhrases[0].commentary.transform = 'answer';
			if (field === 'missing-attack') generated.compEvents = [];
			if (field === 'notes') answer.attack.notes = [62, 66, 69];
			if (field === 'time') answer.attack.time = '1249i';
			if (field === 'duration') answer.attack.duration = .4;
			if (field === 'velocity') answer.attack.velocity = 61;
			if (field === 'extra-chord') generated.compEvents.push({ ...generated.compEvents[0], absBeat: 7, time: '1344i' });
			if (field === 'reply-offset') answer.replyOffset = 1.5;
			if (field === 'missing-reply-trace') generated.ensembleDevelopment.pianoMotifs = [];
			if (field === 'drum-commentary') generated.drumEvents.push({ absBeat: 7, time: '1344i', drum: 'snare', role: 'commentary', velocity: .3 });
			if (field === 'drum-trace') generated.ensembleDevelopment.drumPhrases[1].commentary.hits = [generated.ensembleDevelopment.drumPhrases[0].commentary.hits[0]];
			expect(cards(generated).flatMap(card => card.evidence).join(' ')).not.toMatch(/Answer the drum phrase|for the piano answer/);
		});
	it('keeps old exports, Original and native styles free of new answer claims', () => {
		const generated = score();
		for (const options of [{ orchestration: 'original' }, { style: 'bossa-nova' }, { style: 'ballad' }, { barIndex: 0 }])
			expect(cards(generated, options).flatMap(card => card.evidence).join(' ')).not.toMatch(/Answer the drum phrase|for the piano answer/);
		delete (generated.ensembleDevelopment as { pianoAnswers?: unknown }).pianoAnswers;
		expect(cards(generated).flatMap(card => card.evidence).join(' ')).not.toMatch(/Answer the drum phrase|for the piano answer/);
	});
});

describe('piano top-note objective evidence', () => {
	function score() {
		const event = { absBeat: 4, time: '768i', notes: [53, 58, 60, 63], duration: .4, velocity: 60 };
		return { bassEvents: [], compEvents: [event], drumEvents: [], ensemblePlan: { version: 1, trace: [], bars: [{
			barIndex: 1, phraseIntent: 'support', energy: .4,
			performanceEnergy: { phase: 'head_return', chorusIndex: 3, targetEnergy: .4 },
			piano: { role: 'support' }, bass: { role: 'time' }, drums: { role: 'time' }
		}] }, ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [], drumPhrases: [], pianoVoicings: [{ ...event,
			notes: [...event.notes], decision: { requestedFamily: 'rootless-b', resolvedFamily: 'rootless-b', correction: 'none',
				guideMotion: 2, commonTones: [60], totalMovement: 26, registerDistance: 3, candidateCount: 12,
				topLine: { targetMidi: 58, actualMidi: 63, distance: 5, eligible: true } }
		}] } };
	}
	const card = (generated: ReturnType<typeof score>, options = {}) => describeMusicianDecisions(generated as unknown as GeneratedBacking, { ...context, barIndex: 1, ...options })[1];
	it.each(['swing', 'straight'] as const)('shows a %s target miss honestly alongside actual notes and retained priorities', style => {
		const piano = card(score(), { style });
		expect(piano.action).toBe('Support the harmony');
		expect(piano.evidence).toContain('Chord 1 top-note target: B♭3; actual top: E♭4');
		expect(piano.evidence).toContain('Guide-tone movement: 2 semitones total');
		expect(piano.evidence).toContain('Common tones held: C4');
		expect(piano.evidence.join(' ')).not.toMatch(/melody achieved|improved|soloist/i);
	});
	it('reports a reached target without claiming a composed melody or changing rhythmic ownership', () => {
		const generated = score();
		Object.assign(generated.ensembleDevelopment.pianoVoicings[0], { arrivalId: 'existing-arrival' });
		Object.assign(generated.ensembleDevelopment.pianoVoicings[0].decision.topLine, { targetMidi: 63, distance: 0 });
		expect(card(generated).evidence).toContain('Chord 1 top-note target: E♭4; actual top: E♭4');
	});
	it.each(['notes', 'time', 'absBeat', 'actual-top', 'distance', 'fractional-target', 'range', 'ineligible', 'requested-guide', 'resolved-quartal'] as const)(
		'does not promote inconsistent %s evidence into a top-note objective', field => {
			const generated = score(); const voiced = generated.ensembleDevelopment.pianoVoicings[0];
			if (field === 'notes') voiced.notes = [53, 58, 60, 64];
			if (field === 'time') voiced.time = '769i';
			if (field === 'absBeat') voiced.absBeat = 4.5;
			if (field === 'actual-top') voiced.decision.topLine.actualMidi = 70;
			if (field === 'distance') voiced.decision.topLine.distance = 0;
			if (field === 'fractional-target') voiced.decision.topLine.targetMidi = 58.5;
			if (field === 'range') Object.assign(voiced.decision.topLine, { targetMidi: 100, distance: 37 });
			if (field === 'ineligible') voiced.decision.topLine.eligible = false;
			if (field === 'requested-guide') voiced.decision.requestedFamily = 'guide';
			if (field === 'resolved-quartal') voiced.decision.resolvedFamily = 'quartal';
			expect(card(generated).evidence.join(' ')).not.toContain('top-note target');
		});
	it('keeps missing historical evidence, silence and native/Original playback unchanged', () => {
		const generated = score();
		for (const options of [{ orchestration: 'original' }, { style: 'bossa-nova' }, { style: 'ballad' }, { barIndex: 2 }])
			expect(card(generated, options).evidence.join(' ')).not.toContain('top-note target');
		generated.compEvents = [];
		expect(card(generated).evidence.join(' ')).not.toContain('top-note target');
		const legacy = score(); delete (legacy.ensembleDevelopment.pianoVoicings[0].decision as { topLine?: unknown }).topLine;
		expect(card(legacy).evidence.join(' ')).not.toContain('top-note target');
	});
});

describe('piano recovery during a retained drum return', () => {
	function score() {
		const sourceHits = [1.5, 3.5].map(absBeat => ({ absBeat, time: `${absBeat * 192}i`, drum: 'snare', velocity: .3, role: 'commentary' }));
		const returning = [9.5, 11.5].map((absBeat, index) => ({ absBeat, time: `${absBeat * 192}i`, drum: index ? 'kick' : 'snare', velocity: .3, role: 'commentary' }));
		const specs = (events: typeof sourceHits, bar: number) => events.map(({ absBeat, drum, velocity, role }) => ({ beatOffset: absBeat - bar * 4, drum, velocity, role }));
		const attack = { absBeat: 6.5, time: '1248i', notes: [62, 65, 69], duration: .2, velocity: 60 };
		const ride = { mode: 'quarters-only', phase: 'single', skipOffsets: [], velocityScale: 1, onsets: [0, 1, 2, 3] };
		const drumPhrase = (barIndex: number, transform: string, events: typeof sourceHits) => ({ version: 1, barIndex, phraseStartBar: 0, phraseLength: 4, ride,
			commentary: { source: 'vocabulary', sourceBar: 0, transform, motifId: 'drum:0', hits: specs(events, barIndex) }, hits: specs(events, barIndex) });
		return { bassEvents: [], compEvents: [{ ...attack, notes: [...attack.notes] }], drumEvents: [...sourceHits, ...returning],
			ensemblePlan: { version: 1, trace: [], bars: [1, 2].map(barIndex => ({ barIndex, phraseIntent: 'support', energy: .5,
				performanceEnergy: { phase: 'solo_build', chorusIndex: 1, targetEnergy: .5 },
				bass: { role: 'time' }, piano: { role: 'support' }, drums: { role: 'time' }
			})) }, ensembleDevelopment: { version: 1, bassTurnarounds: [], pianoMotifs: [
				{ barIndex: 1, motifId: null, sourceFigureId: null, transform: 'fallback', hits: [{ b: 2.5, d: .4 }], reason: 'drum_reply' },
				{ barIndex: 2, motifId: null, sourceFigureId: null, transform: 'space', hits: [], reason: 'ensemble_silence' }
			], pianoAnswers: [{ version: 1, barIndex: 1, source: { barIndex: 0, transform: 'statement', hits: sourceHits.map(hit => ({ ...hit })) },
				attack: { ...attack, notes: [...attack.notes] }, replyOffset: 2.5, drumCommentary: 'space' }],
				pianoRecoveries: [{ version: 1, barIndex: 2, source: { barIndex: 1, attack },
					returningDrums: { motifId: 'drum:0', sourceBar: 0, hits: returning.map(hit => ({ ...hit })) },
					action: 'space', reason: 'after_drum_reply', originalMaxAttacks: 1, effectiveMaxAttacks: 0, acceptedAttacks: [] as typeof attack[] }],
				drumPhrases: [drumPhrase(0, 'statement', sourceHits), drumPhrase(1, 'space', []), drumPhrase(2, 'orchestrate', returning)]
			} };
	}
	const card = (generated: ReturnType<typeof score>, options = {}) => describeMusicianDecisions(generated as unknown as GeneratedBacking, { ...context, barIndex: 2, ...options })[1];
	const explanation = 'Leave a breath while the drum phrase returns';
	it.each(['swing', 'straight'] as const)('explains actual %s recovery without a removed-note or main-action claim', style => {
		const result = card(score(), { style });
		expect(result.evidence).toContain(explanation);
		expect(result.action).toBe('No new chord attack');
		expect(result.evidence.join(' ')).not.toMatch(/removed|avoided chord/);
	});
	it.each(['missing-answer', 'missing-source', 'source-time', 'reply-notes', 'reply-duration', 'reply-velocity', 'same-bar', 'reply-motif',
		'missing-return', 'return-time', 'return-velocity', 'return-motif', 'return-source-bar', 'new-statement', 'piano-derived', 'retained-motif',
		'current-chord', 'accepted-chord', 'current-motif', 'zero-budget', 'no-return-receipt', 'outside-build', 'no-op'] as const)(
		'withholds recovery explanation for %s evidence', field => {
			const generated = score(); const recovery = generated.ensembleDevelopment.pianoRecoveries[0];
			if (field === 'missing-answer') generated.ensembleDevelopment.pianoAnswers = [];
			if (field === 'missing-source') generated.drumEvents.shift();
			if (field === 'source-time') generated.ensembleDevelopment.pianoAnswers[0].source.hits[0].time = '289i';
			if (field === 'reply-notes') recovery.source.attack.notes = [62, 66, 69];
			if (field === 'reply-duration') recovery.source.attack.duration = .5;
			if (field === 'reply-velocity') recovery.source.attack.velocity = 61;
			if (field === 'same-bar') recovery.source.barIndex = 2;
			if (field === 'reply-motif') generated.ensembleDevelopment.pianoMotifs[0].reason = 'not_selected';
			if (field === 'missing-return') generated.drumEvents.pop();
			if (field === 'return-time') recovery.returningDrums.hits[0].time = '1825i';
			if (field === 'return-velocity') recovery.returningDrums.hits[0].velocity = .4;
			if (field === 'return-motif') generated.ensembleDevelopment.drumPhrases[2].commentary.motifId = 'other';
			if (field === 'return-source-bar') recovery.returningDrums.sourceBar = 1;
			if (field === 'new-statement') generated.ensembleDevelopment.drumPhrases[2].commentary.transform = 'statement';
			if (field === 'piano-derived') generated.ensembleDevelopment.drumPhrases[2].commentary.source = 'piano';
			if (field === 'retained-motif') generated.ensembleDevelopment.drumPhrases[1].commentary.motifId = 'other';
			if (field === 'current-chord') generated.compEvents.push({ ...generated.compEvents[0], absBeat: 8, time: '1536i' });
			if (field === 'accepted-chord') recovery.acceptedAttacks.push({ ...recovery.source.attack, absBeat: 8, time: '1536i' });
			if (field === 'current-motif') generated.ensembleDevelopment.pianoMotifs[1].transform = 'fallback';
			if (field === 'zero-budget') recovery.originalMaxAttacks = 0;
			if (field === 'no-return-receipt') (recovery as { returningDrums: unknown }).returningDrums = null;
			if (field === 'outside-build') generated.ensemblePlan.bars[1].performanceEnergy.phase = 'solo_peak';
			if (field === 'no-op') recovery.action = 'none';
			expect(card(generated).evidence).not.toContain(explanation);
		});
	it('does not add recovery claims to old exports or native/Original paths', () => {
		const generated = score();
		for (const options of [{ orchestration: 'original' }, { style: 'bossa-nova' }, { style: 'ballad' }, { barIndex: 1 }])
			expect(card(generated, options).evidence).not.toContain(explanation);
		delete (generated.ensembleDevelopment as { pianoRecoveries?: unknown }).pianoRecoveries;
		expect(card(generated).evidence).not.toContain(explanation);
	});
});

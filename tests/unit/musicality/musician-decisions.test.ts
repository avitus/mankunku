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

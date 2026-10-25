import { describe, expect, it } from 'vitest';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
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

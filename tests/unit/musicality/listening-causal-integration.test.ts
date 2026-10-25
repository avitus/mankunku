import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { createRollingBackingRenderer } from '$lib/audio/backing-rolling-renderer';
import { createRollingSession } from '$lib/audio/backing-rolling-session';
import { aggregateRollingBacking } from '$lib/audio/backing-rolling-take';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession, LISTENING_TUNES } from '$lib/musicality/listening-tunes';
import type { BackingStyle } from '$lib/types/instruments';

/** Real generation, scheduling, session and export; only the hardware clock is controlled. */
function finiteTake(tuneId: string, solos: number, styleId: BackingStyle, tempo = 240) {
	const tune = buildListeningTuneSession({ tuneId, soloChoruses: solos });
	const definition = createRollingBacking(tune.phrase.harmony, BACKING_STYLES[styleId], {
		phraseId: tune.phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: .62,
		performanceForm: tune.phrase.performanceForm, sectionMap: tune.phrase.sectionMap, ensemble: {}
	});
	let now = 10, serial = 0, releases = 0, played = 0;
	const origin = 11;
	const pending = new Map<number, { callback: (time: number) => void; audioTime: number }>();
	const renderer = createRollingBackingRenderer({ sessionId: definition.sessionId, totalBars: definition.totalBars,
		tempo, ppq: 192, startAudioTime: origin }, {
		audioNow: () => now, lookAhead: () => .1, updateInterval: () => .025, isCurrent: () => true,
		scheduleOnce(callback, ticks) { const id = ++serial; pending.set(id, { callback, audioTime: origin + parseInt(ticks) / 192 * 60 / tempo }); return id; },
		clear(id) { pending.delete(id); },
		play() { played++; return () => { releases++; }; }, publishSchedule() {}
	});
	const session = createRollingSession({ definition, renderer, startAudioTime: origin,
		observationSessionId: 'no-microphone', generate: advanceRollingBacking, measureNow: () => 0, releaseTailSeconds: 2.5 });
	function advance(audioTime: number) {
		for (const [id, event] of [...pending].sort(([, a], [, b]) => a.audioTime - b.audioTime)) {
			if (event.audioTime > audioTime + .1) break;
			now = event.audioTime - .05; pending.delete(id); event.callback(event.audioTime);
		}
		now = audioTime; session.pump();
	}
	return { definition, renderer, session, origin, advance, played: () => played, releases: () => releases };
}

const inputs = LISTENING_TUNES.flatMap(tune => [1, 2, 3, 4].flatMap(solos =>
	['swing', 'straight', 'bossa-nova', 'ballad'].map(style => ({ tuneId: tune.id, solos, style: style as BackingStyle }))));

describe('finite curated listening through causal playback', () => {
	it.each(inputs)('$tuneId / $solos solo passes / $style fits the existing source bound and completes actual committed dispatch', ({ tuneId, solos, style }) => {
		const h = finiteTake(tuneId, solos, style);
		const expectedBars = tuneId.includes('saints') ? 32 + solos * 16 : 28 + solos * 12;
		expect(h.definition.sourceBars).toBe(expectedBars);
		expect(expectedBars).toBeLessThanOrEqual(128);
		h.session.start();
		const earlySnapshot = h.renderer.snapshot();
		const early = aggregateRollingBacking(earlySnapshot);
		expect(earlySnapshot.nextBar).toBe(2);
		expect(early.ensemblePlan!.bars).toHaveLength(2);
		expect(early.ensembleDevelopment!.pianoFeedback).toHaveLength(2);
		for (let bar = 2; bar < expectedBars; bar++) {
			h.advance(h.origin + bar - .21);
			expect(h.session.snapshot()).toMatchObject({ status: 'running', nextBar: bar + 1, receipts: [] });
			const prefix = aggregateRollingBacking(h.renderer.snapshot());
			expect(prefix.ensemblePlan!.bars).toHaveLength(bar + 1);
			for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
				expect(prefix[field].slice(0, early[field].length)).toEqual(early[field]);
				expect(prefix[field].every(event => parseInt(event.time) < (bar + 1) * 768)).toBe(true);
			}
		}
		h.advance(h.origin + expectedBars);
		expect(h.session.snapshot().status).toBe('running');
		expect(h.releases()).toBe(0);
		expect(h.renderer.snapshot().dispatches.every(event => event.status === 'played')).toBe(true);
		h.advance(h.origin + expectedBars + 2.49);
		expect(h.releases()).toBe(0);
		h.advance(h.origin + expectedBars + 2.5);
		expect(h.session.snapshot()).toMatchObject({ status: 'complete', nextBar: expectedBars, receipts: [] });
		expect(h.releases()).toBe(h.played());
		expect(h.played()).toBeGreaterThan(expectedBars);
		const finalSnapshot = h.renderer.snapshot(), final = aggregateRollingBacking(finalSnapshot);
		expect(earlySnapshot.nextBar).toBe(2);
		expect(early.ensemblePlan!.bars).toHaveLength(2);
		expect(final.ensembleDevelopment!.pianoFeedback).toHaveLength(expectedBars);
		for (const field of ['pianoMotifs', 'bassTurnarounds', 'drumPhrases', 'bassFeel', 'pianoVoicings', 'pianoFeedback'] as const)
			expect(final.ensembleDevelopment![field] ?? []).toEqual(finalSnapshot.windows.flatMap<unknown>(window => window.ensembleDevelopment[field] ?? []));
		expect(final.bassEvents.some(event => event.absBeat >= (expectedBars - 1) * 4)).toBe(true);
		if (style === 'bossa-nova') {
			expect(final.drumEvents.filter(event => event.drum === 'hihat')).toHaveLength(expectedBars * 8);
			expect(final.bassEvents.every(event => [0, 1.5, 2, 3.5].includes(event.absBeat % 4))).toBe(true);
			expect(final.ensembleDevelopment!.pianoFeedback!.every(entry => entry.source === null)).toBe(true);
		}
		if (style === 'ballad') {
			expect(final.bassEvents.every(event => event.absBeat % 2 === 0)).toBe(true);
			expect(final.ensemblePlan!.bars.every(bar => bar.energy <= .6)).toBe(true);
		}
	});

	it('exports the actual Blues drum statement and subsequent piano breath with no solo observations', () => {
		const h = finiteTake(LISTENING_TUNES.find(tune => tune.title === 'Mankunku Blues')!.id, 2, 'swing', 180);
		h.session.start();
		for (let bar = 2; bar <= 21; bar++) h.advance(h.origin + bar * 240 / 180 - .21);
		const generated = aggregateRollingBacking(h.renderer.snapshot());
		const decision = generated.ensembleDevelopment!.pianoFeedback![21];
		expect(decision).toMatchObject({ barIndex: 21, action: 'yield', reason: 'drum_statement',
			originalMaxAttacks: 1, effectiveMaxAttacks: 0, acceptedAttacks: [], source: { barIndex: 20 } });
		expect(h.session.snapshot().receipts).toEqual([]);
		expect(decision.source!.hits.length).toBeGreaterThanOrEqual(2);
		for (const event of decision.source!.hits) {
			expect(event.role).toBe('commentary');
			expect(generated.drumEvents).toContainEqual(event);
		}
		expect(generated.compEvents.filter(event => Math.floor(event.absBeat! / 4) === 21)).toEqual([]);
	});
});

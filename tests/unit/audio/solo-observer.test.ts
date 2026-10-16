import { describe, expect, it } from 'vitest';
import { createSoloObserver, type SoloObservationFrame, type SoloObserver } from '$lib/audio/solo-observer';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildSchedule } from '$lib/audio/backing-track-schedule';

const config = { sessionId: 'microphone-observer', tempo: 120, beatsPerBar: 4 as const, totalBars: 16 };
const frame = (timeSeconds: number, extra: Partial<SoloObservationFrame> = {}): SoloObservationFrame => ({
	timeSeconds, availableAtSeconds: timeSeconds, rms: 0.08, midi: 72, clarity: 0.97,
	inputAvailable: true, backingMidi: [], nearBackingTransient: false, ...extra
});
function feed(observer: SoloObserver, seconds: number, extra: (time: number) => Partial<SoloObservationFrame> = () => ({})): void {
	for (let index = 0; index <= Math.round(seconds * 60); index++) {
		const time = index / 60;
		observer.push(frame(time, extra(time)));
	}
}

describe('causal solo observation windows', () => {
	it('counts a held note once, publishes only a completed bar and targets a later decision', () => {
		const observer = createSoloObserver(config);
		feed(observer, 1.9);
		expect(observer.snapshot()).toEqual([]);
		for (let index = 115; index <= 120; index++) observer.push(frame(index / 60));
		const window = observer.snapshot()[0];
		expect(window).toMatchObject({ barIndex: 0, status: 'active', attackCount: 1, registerCenter: 72 });
		expect(window.noteDensity).toBe(1 / 8);
		expect(window.feature).toMatchObject({ barIndex: 1, observedAtBar: 1, source: 'microphone' });
	});

	it('distinguishes dense pitch changes from held frames and reliably observed quiet', () => {
		const dense = createSoloObserver(config);
		feed(dense, 2, (time) => ({ midi: 72 + Math.floor(time / 0.25) % 2 }));
		expect(dense.snapshot()[0]).toMatchObject({ status: 'active', attackCount: 8, noteDensity: 1, restBeats: 0 });
		const quiet = createSoloObserver(config);
		feed(quiet, 2, () => ({ rms: 0.001, midi: null, clarity: 0 }));
		expect(quiet.snapshot()[0]).toMatchObject({ status: 'resting', attackCount: 0, noteDensity: 0, restBeats: 4 });
	});

	it('counts a silence-separated repeated pitch but not a brief tracking failure as a new attack', () => {
		const repeated = createSoloObserver(config);
		feed(repeated, 2, (time) => time >= 0.8 && time < 1 ? { rms: 0.001, midi: null, clarity: 0 } : {});
		expect(repeated.snapshot()[0]).toMatchObject({ status: 'active', attackCount: 2, noteDensity: 0.25 });
		const uncertain = createSoloObserver(config);
		feed(uncertain, 2, (time) => time >= 0.8 && time < 1 ? { midi: null, clarity: 0.4 } : {});
		expect(uncertain.snapshot()[0]).toMatchObject({ status: 'active', reason: 'observed_activity', attackCount: 1, restBeats: 0 });
		expect(uncertain.snapshot()[0].feature?.restBeats).toBe(0);
	});

	it('never turns missing input, suspended tracks, unpitched noise or low-level pure bleed into a confident rest', () => {
		for (const extra of [
			{ inputAvailable: false, rms: 0, midi: null, clarity: 0 },
			{ rms: 0.08, midi: null, clarity: 0.3 },
			{ rms: 0.006, midi: 72, clarity: 0.99 },
			{ rms: 0.08, midi: 72, clarity: 0.8 }
		]) {
			const observer = createSoloObserver(config);
			feed(observer, 2, () => extra);
			const window = observer.snapshot()[0];
			expect(window.status).toBe('unknown');
			expect(window.confidence).toBeLessThan(0.7);
			expect(window.restBeats).toBe(0);
			expect(window.feature).toBeUndefined();
		}
		const missing = createSoloObserver(config);
		missing.push(frame(0, { rms: 0, midi: null }));
		missing.push(frame(2, { rms: 0, midi: null }));
		expect(missing.snapshot()[0]).toMatchObject({ status: 'unknown', reason: 'missing_frames', restBeats: 0 });
		expect(missing.snapshot()[0].coverage).toBeCloseTo(0.05);
	});

	it('rejects nonquiet backing fundamentals, harmonics and transients without masking healthy quiet', () => {
		for (const midi of [48, 60, 67, 72, 76, 79, 82, 84]) {
			const observer = createSoloObserver(config);
			feed(observer, 2, () => ({ midi, backingMidi: [48], clarity: 0.99 }));
			expect(observer.snapshot()[0]).toMatchObject({ status: 'unknown', reason: 'backing_ambiguity', restBeats: 0 });
			expect(observer.snapshot()[0].feature).toBeUndefined();
		}
		const transient = createSoloObserver(config);
		feed(transient, 2, () => ({ nearBackingTransient: true }));
		expect(transient.snapshot()[0]).toMatchObject({ status: 'unknown', reason: 'backing_ambiguity' });
		const headphonesQuiet = createSoloObserver(config);
		feed(headphonesQuiet, 2, () => ({ rms: 0.001, midi: 72, backingMidi: [60], nearBackingTransient: true }));
		expect(headphonesQuiet.snapshot()[0]).toMatchObject({ status: 'resting', reason: 'observed_rest', restBeats: 4 });
	});

	it('recognizes a supported nonmatching solo through real scheduled quarter and skip transient masks', () => {
		for (const tempo of [90, 160, 240]) {
			const ppq = 192;
			const beat = 60 / tempo;
			const quarter = Array.from({ length: 16 }, (_, absBeat) => ({ time: `${absBeat * ppq}i` }));
			const skips = Array.from({ length: 4 }, (_, bar) => [1.5, 3.5].map((offset) => ({ time: `${(bar * 4 + offset) * ppq}i` }))).flat();
			const schedule = buildSchedule(quarter.map((event) => ({ ...event, midi: 36, duration: beat * 0.9 })),
				Array.from({ length: 4 }, (_, bar) => ({ time: `${bar * 4 * ppq}i`, notes: [48, 52, 55], duration: beat })),
				[...quarter, ...skips], 0, ppq, tempo);
			for (const dense of [false, true]) {
				const observer = createSoloObserver({ ...config, tempo });
				feed(observer, 4 * beat * 3, (time) => ({ midi: dense ? 73 + 2 * (Math.floor(time / (beat / 2) + 1e-7) % 2) : 73,
					backingMidi: schedule.activeMidiAt(time),
					nearBackingTransient: schedule.bleedEventsIn(time, 0.03).some((onset) => onset >= -(4096 / 48000 + 0.05) && onset <= 0.03) }));
				const observed = observer.snapshot()[1];
				// At a burner tempo these deliberately conservative masks merge
				// across skips. Do not manufacture confidence without independent
				// evidence just to force a result at every tempo.
				if (tempo === 240) {
					expect(observed).toMatchObject({ status: 'unknown', reason: 'backing_ambiguity', restBeats: 0 });
					expect(observed.feature).toBeUndefined();
					continue;
				}
				expect(observed, `tempo ${tempo}, dense ${dense}`).toMatchObject({ status: 'active', restBeats: 0 });
				expect(observed.feature).toBeDefined();
				if (dense) expect(observed.noteDensity).toBeGreaterThanOrEqual(0.75);
				else expect(observed.attackCount).toBe(0);
			}
		}
	});

	it('does not use partly ambiguous activity to advertise a subsequent quiet tail as a rest', () => {
		const observer = createSoloObserver(config);
		feed(observer, 2, (time) => time < 0.6 ? {} : time < 0.8 ? { nearBackingTransient: true, midi: null }
			: { rms: 0.001, midi: null, clarity: 0 });
		const window = observer.snapshot()[0];
		expect(window.status).toBe('active');
		expect(window.restBeats).toBe(0);
		expect(window.feature?.restBeats).toBe(0);
	});

	it('cannot renew independent pitch confidence forever from continuously masked frames', () => {
		const observer = createSoloObserver(config);
		feed(observer, 2, (time) => ({ nearBackingTransient: time >= 0.2 }));
		const window = observer.snapshot()[0];
		expect(window).toMatchObject({ status: 'unknown', reason: 'backing_ambiguity', restBeats: 0 });
		expect(window.feature).toBeUndefined();
	});

	it('does not bridge a brief unobserved interval into a confident rest even with high total coverage', () => {
		const observer = createSoloObserver(config);
		for (let index = 0; index <= 120; index++) {
			const time = index / 60;
			if (time > 1 && time < 1.2) continue;
			observer.push(frame(time, { rms: 0.001, midi: null }));
		}
		const window = observer.snapshot()[0];
		expect(window.coverage).toBeGreaterThan(0.8);
		expect(window).toMatchObject({ status: 'unknown', reason: 'missing_frames', restBeats: 0 });
		expect(window.feature).toBeUndefined();
	});

	it('publishes delayed evidence only for a later decision and never rewrites a committed prefix', () => {
		const observer = createSoloObserver(config);
		feed(observer, 2, (time) => ({ availableAtSeconds: time + 0.01 }));
		const prefix = observer.snapshot();
		expect(prefix[0]).toMatchObject({ barIndex: 0, availableAtSeconds: 2.01 });
		expect(prefix[0].feature).toMatchObject({ barIndex: 2, observedAtBar: 1 });
		for (let index = 121; index <= 240; index++) {
			const time = index / 60;
			observer.push(frame(time, { availableAtSeconds: time + 0.01, rms: 0.001, midi: null }));
		}
		expect(observer.snapshot()[0]).toBe(prefix[0]);
		expect(observer.snapshot()[0]).toEqual(prefix[0]);
		expect(observer.snapshot()[1].feature).toMatchObject({ barIndex: 3, observedAtBar: 2 });
		const late = createSoloObserver({ ...config, totalBars: 1 });
		feed(late, 2);
		expect(late.snapshot()[0].feature).toBeUndefined();
	});

	it('keeps a delayed observation trace but cannot relabel old complete evidence as fresh for the planner', () => {
		const observer = createSoloObserver(config);
		feed(observer, 2, (time) => ({ availableAtSeconds: time + 6 }));
		const window = observer.snapshot()[0];
		expect(window.coverage).toBeCloseTo(1);
		expect(window).toMatchObject({ barIndex: 0, endSeconds: 2, availableAtSeconds: 8, status: 'unknown', reason: 'stale_observation' });
		expect(window.feature).toBeUndefined();
	});

	it('finishes only complete observed bars and does not invent quiet while draining a delayed stop', () => {
		const partial = createSoloObserver(config);
		feed(partial, 1.5);
		expect(partial.finish(1.5)).toEqual([]);
		expect(partial.snapshot()).toEqual([]);
		expect(partial.finish(1.6)).toEqual([]);
		expect(() => partial.push(frame(1.6))).toThrow(/finished/);
		const abandoned = createSoloObserver(config);
		feed(abandoned, 0.5, () => ({ rms: 0.001, midi: null }));
		const completed = abandoned.finish(4.5);
		expect(completed).toHaveLength(2);
		expect(completed.every((window) => window.status === 'unknown' && !window.feature && window.restBeats === 0)).toBe(true);
	});

	it('bounds the session, freezes records and features, and yields deterministic finite JSON', () => {
		const observers = [createSoloObserver(config), createSoloObserver(config)];
		for (const observer of observers) feed(observer, 4);
		const snapshot = observers[0].snapshot();
		expect(observers[1].snapshot()).toEqual(snapshot);
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(Object.isFrozen(snapshot)).toBe(true);
		for (const window of snapshot) {
			expect(Object.isFrozen(window)).toBe(true);
			if (window.feature) expect(Object.isFrozen(window.feature)).toBe(true);
			for (const value of Object.values(window)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
		}
		const bounded = createSoloObserver({ ...config, totalBars: 128 });
		bounded.finish(1e12);
		expect(bounded.snapshot()).toHaveLength(128);
	});

	it('rejects invalid or reordered input atomically, including observations from the future', () => {
		for (const change of [{ totalBars: 129 }, { totalBars: 0 }, { totalBars: 2.5 }, { tempo: NaN }, { tempo: 29 }, { tempo: 321 }, { sessionId: '' }]) {
			expect(() => createSoloObserver({ ...config, ...change })).toThrow(/requires/);
		}
		for (const extra of [{ timeSeconds: NaN }, { availableAtSeconds: -1 }, { timeSeconds: 2, availableAtSeconds: 1 },
			{ rms: -1 }, { rms: Infinity }, { clarity: 2 }, { midi: 128 }, { backingMidi: [NaN] }]) {
			const observer = createSoloObserver(config);
			expect(() => observer.push(frame(0, extra))).toThrow(/finite causal/);
			expect(observer.snapshot()).toEqual([]);
		}
		const observer = createSoloObserver(config);
		feed(observer, 2);
		const before = observer.snapshot();
		expect(() => observer.push(frame(1))).toThrow(/ordered/);
		expect(() => observer.finish(Infinity)).toThrow(/finite current/);
		expect(() => observer.finish(1)).toThrow(/finite current/);
		expect(observer.snapshot()).toEqual(before);
	});

	it('replays recorded dense observations through actual accompaniment with less commentary and stable bass time', () => {
		const preset = BACKING_LAB_PRESETS.find((entry) => entry.id === 'lab-aaba-c')!;
		const observer = createSoloObserver({ ...config, totalBars: preset.bars });
		feed(observer, preset.bars * 2, (time) => ({ midi: 72 + Math.floor(time / 0.25) % 2 }));
		const soloFeatures = observer.snapshot().flatMap((window) => window.feature ? [window.feature] : []);
		expect(soloFeatures).toHaveLength(preset.bars - 1);
		const params = { phraseId: 'observed-dense-replay', tempo: 120, ppq: 192, beatsPerBar: 4,
			swing: 0.733, sectionMap: preset.phrase.sectionMap, performanceForm: preset.phrase.performanceForm };
		const ordinary = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, { ...params, ensemble: {} });
		const observed = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, { ...params, ensemble: { soloFeatures } });
		expect(observed.compEvents.length).toBeLessThan(ordinary.compEvents.length);
		expect(observed.drumEvents.filter((event) => event.role === 'commentary').length)
			.toBeLessThan(ordinary.drumEvents.filter((event) => event.role === 'commentary').length);
		expect(observed.bassEvents.filter((event) => Number.isInteger(event.absBeat)).map((event) => event.absBeat))
			.toEqual(ordinary.bassEvents.filter((event) => Number.isInteger(event.absBeat)).map((event) => event.absBeat));
	});
});

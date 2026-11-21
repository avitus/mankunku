import { describe, it, expect } from 'vitest';
import { resolveBleedEvidence } from '$lib/audio/bleed-evidence';
import { buildSchedule } from '$lib/audio/backing-track-schedule';
import { getMetronomeBleedOnsets } from '$lib/audio/note-segmenter';

const PPQ = 480;
const TEMPO = 120;

// Bass on the count-in-adjacent beat: tick 0 + offset 480 → 0.5s transport.
const schedule = buildSchedule(
	[{ time: '0i', midi: 40, duration: 0.5 }],
	[],
	[{ time: '960i' }],
	480,
	PPQ,
	TEMPO
);

const base = {
	schedule,
	recordingTransportSeconds: 0.4,
	tempo: TEMPO,
	recordingDuration: 2.0
};

describe('resolveBleedEvidence', () => {
	it('backing on + schedule → backing transient onsets (drums included)', () => {
		const onsets = resolveBleedEvidence({
			...base,
			backingTrackEnabled: true,
			metronomeEnabled: true // irrelevant: clicks are count-in only under backing
		});
		expect(onsets?.map((t) => Number(t.toFixed(4)))).toEqual([0.1, 1.1]);
	});

	it('backing on but no schedule → falls back to the metronome grid', () => {
		const onsets = resolveBleedEvidence({
			...base,
			schedule: null,
			backingTrackEnabled: true,
			metronomeEnabled: true
		});
		expect(onsets).toEqual(getMetronomeBleedOnsets(0.4, TEMPO, 2.0));
	});

	it('backing off + metronome on → metronome grid (unchanged behavior)', () => {
		const onsets = resolveBleedEvidence({
			...base,
			backingTrackEnabled: false,
			metronomeEnabled: true
		});
		expect(onsets).toEqual(getMetronomeBleedOnsets(0.4, TEMPO, 2.0));
	});

	it('backing on + metronome OFF → backing onsets (closes the old gating hole)', () => {
		const onsets = resolveBleedEvidence({
			...base,
			backingTrackEnabled: true,
			metronomeEnabled: false
		});
		expect(onsets?.length).toBe(2);
	});

	it('nothing audible → undefined', () => {
		const onsets = resolveBleedEvidence({
			...base,
			schedule: null,
			backingTrackEnabled: false,
			metronomeEnabled: false
		});
		expect(onsets).toBeUndefined();
	});
});

it('uses the written click unit in compound meter without changing quarter-note BPM',()=>{
 const eighths=resolveBleedEvidence({schedule:null,recordingTransportSeconds:0,tempo:120,recordingDuration:1.5,backingTrackEnabled:false,metronomeEnabled:true,metronomeDenominator:8});
 expect(eighths).toEqual([-.25,0,.25,.5,.75,1,1.25,1.5]);
 expect(resolveBleedEvidence({...base,backingTrackEnabled:true,metronomeEnabled:true,metronomeDenominator:8})).toEqual(resolveBleedEvidence({...base,backingTrackEnabled:true,metronomeEnabled:true}));
});

it('anchors the click grid to the scheduled downbeat after a mixed-meter handoff', () => {
 const onsets = resolveBleedEvidence({ ...base, schedule: null, backingTrackEnabled: false, metronomeEnabled: true,
  tempo: 120, metronomeDenominator: 4, metronomeGridOriginSeconds: 3.25, recordingTransportSeconds: 3.375, recordingDuration: 1 });
 expect(onsets).toEqual([-.125, .375, .875]);
});

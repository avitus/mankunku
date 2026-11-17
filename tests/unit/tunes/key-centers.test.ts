import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tuneKeyCenters, keyCenterBarSpan, keyCenterLabelStartsRow } from '$lib/tunes/key-centers';
import { INSTRUMENTS } from '$lib/types/instruments';
import { PITCH_CLASSES } from '$lib/types/music';
import { transposeTune } from '$lib/tunes/book-loader';
import { analyzeHarmony } from '$lib/tunes/harmonic-analysis';
import { flattenTune } from '$lib/tunes/flatten';
import { section, sheet, seg, threeLaneSheet } from '../../helpers/tune-fixtures';
const autumn = sheet(JSON.parse(readFileSync('tests/fixtures/leadsheets/autumn-in-new-york.json', 'utf8')));

describe('key-center chart evidence', () => {
	it('exposes all three overlapping lanes as stable layout capacity', () => {
		const display = tuneKeyCenters(threeLaneSheet(), INSTRUMENTS.concert);
		expect(display.laneCount).toBe(3);
		expect(display.markers.some(marker => marker.keyCenter?.lane === 2 && marker.endBarExclusive === 5)).toBe(true);
	});
	it('labels the first fitting span on desktop, mobile and section rows after a narrow entrance', () => {
		const marker = { id: 'late-center', startBar: 0, endBarExclusive: 7, status: 'upcoming' as const, timeRange: { start: .75, end: 6.25 } };
		expect([0, 1, 2, 3].map(bar => keyCenterLabelStartsRow(marker, bar, 0, 1))).toEqual([false, true, false, false]);
		expect(keyCenterLabelStartsRow(marker, 2, 2, 1)).toBe(true);
		expect(keyCenterLabelStartsRow(marker, 4, 4, 1)).toBe(true);
		expect(keyCenterLabelStartsRow(marker, 5, 5, 1)).toBe(true);
		expect(keyCenterLabelStartsRow(marker, 6, 6, 1)).toBe(false);
	});
	it('finds several local centers in the stored All the Things You Are chart', () => {
		const tune = sheet(JSON.parse(readFileSync('tests/fixtures/leadsheets/pdf-vs-musescore/all-the-things-you-are.musescore-import.json', 'utf8')));
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		expect(display.legend.length).toBeGreaterThan(3);
		expect(display.readings.some(r => r.key !== tune.key && r.reason.includes('progression center'))).toBe(true);
	});
	it('retains Autumn’s shared chord and minor arrival without changing cornerstone practice boundaries', () => {
		const before = structuredClone(autumn);
		const display = tuneKeyCenters(autumn, INSTRUMENTS['tenor-sax']);
		const major = display.markers.find(m => m.keyCenter?.label === 'G major' && m.timeRange?.start === 0)!;
		const minor = display.markers.find(m => m.keyCenter?.label === 'A minor' && m.timeRange?.start === 3)!;
		expect(major.timeRange?.end).toBe(3.5);
		expect(minor.timeRange?.end).toBeGreaterThan(3.5);
		expect(major.keyCenter?.lane).not.toBe(minor.keyCenter?.lane);
		expect(keyCenterBarSpan(major, 3, 1)).toEqual({ left: 0, width: 50 });
		expect(analyzeHarmony(flattenTune(autumn), autumn, { reservationScope: 'form' }).majorRegions[0].duration).toEqual([3, 1]);
		expect(autumn).toEqual(before);
	});
	it.each(PITCH_CLASSES)('preserves analysis boundaries when transposing the tune to %s', key => {
		const display = tuneKeyCenters(transposeTune(autumn, key), INSTRUMENTS.concert);
		expect(display.markers.some(m => m.keyCenter?.label === `${key} major` && m.timeRange?.start === 0 && m.timeRange.end === 3.5)).toBe(true);
	});
	it('keeps competing compatible collections instead of forcing the tune signature', () => {
		const tune = sheet({ key: 'D', sections: [section({ bars: 2, harmony: [seg('C', 'maj6', [0, 1], [1, 1]), seg('F', 'maj6', [1, 1], [1, 1])] })] });
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		expect(display.legend.map(l => l.label).sort()).toEqual(['C major', 'F major']);
		expect(display.markers.map(m => m.keyCenter?.lane)).toEqual([0, 1]);
		expect(display.readings.every(r => r.reason.includes('other readings'))).toBe(true);
	});
	it('does not invent a key from an isolated chord, unknown symbol, or malformed timeline', () => {
		for (const harmony of [[seg('C', 'maj7', [0, 1], [2, 1])],
			[seg('C', 'maj7', [0, 1], [1, 1], 'unknown'), seg('F', 'maj7', [1, 1], [1, 1])],
			[seg('C', 'maj7', [0, 1], [2, 1]), seg('F', 'maj7', [1, 1], [1, 1])]]) {
			expect(tuneKeyCenters(sheet({ sections: [section({ bars: 2, harmony })] }), INSTRUMENTS.concert).markers).toEqual([]);
		}
	});
	it('projects second-ending cadences without painting the skipped first ending', () => {
		const tune = sheet({ sections: [
			section({ bars: 1, repeatStart: true, harmony: [seg('D', 'min7', [0, 1], [1, 2]), seg('G', '7', [1, 2], [1, 2])] }),
			section({ bars: 1, ending: 1, repeatEnd: true, harmony: [seg('Db', 'maj7', [0, 1], [1, 1])] }),
			section({ bars: 1, ending: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] })
		] });
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		const c = display.markers.filter(m => m.keyCenter?.label === 'C major');
		expect(c.map(m => m.timeRange)).toEqual([{ start: 0, end: 1 }, { start: 2, end: 3 }]);
		expect(display.readings.some(r => r.start === 0 && r.repeated && r.visits.includes(2))).toBe(true);
	});
	it('combines duplicate repeat coverage while retaining both visits and competing readings', () => {
		const tune = sheet({ sections: [section({ bars: 2, repeatStart: true, repeatEnd: true,
			harmony: [seg('C', 'maj6', [0, 1], [1, 1]), seg('F', 'maj6', [1, 1], [1, 1])] })] });
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		expect(display.markers).toHaveLength(2);
		expect(display.readings).toHaveLength(2);
		expect(display.readings.every(r => r.repeated && r.visits.join(',') === '1,2')).toBe(true);
	});
	it('keeps gaps, partial bars and 3/4 timing exact', () => {
		const tune = sheet({ timeSignature: [3, 4], sections: [section({ bars: 4, harmony: [
			seg('C', 'maj7', [1, 4], [1, 2]), seg('F', 'maj7', [3, 4], [1, 2]),
			seg('C', 'maj7', [2, 1], [1, 2]), seg('F', 'maj7', [5, 2], [1, 2])
		] })] });
		const c = tuneKeyCenters(tune, INSTRUMENTS.concert).markers.filter(m => m.keyCenter?.label === 'C major');
		expect(c.map(m => m.timeRange)).toEqual([{ start: .25, end: 1.25 }, { start: 2, end: 3 }]);
		expect(keyCenterBarSpan(c[0], 1, .75)).toEqual({ left: 0, width: 2 / 3 * 100 });
	});
	it('uses the solo form without painting an omitted section between ii–V and I', () => {
		const tune = sheet({ sections: [
			section({ bars: 1, harmony: [seg('D', 'min7', [0, 1], [1, 2]), seg('G', '7', [1, 2], [1, 2])] }),
			section({ bars: 1, omitFromSolos: true, harmony: [seg('Db', 'maj7', [0, 1], [1, 1])] }),
			section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] })
		] });
		// The ii–V already implies C; only the solo form reaches its later tonic.
		expect(tuneKeyCenters(tune, INSTRUMENTS.concert).markers.map(m => m.timeRange)).toEqual([{ start: 0, end: 1 }]);
		expect(tuneKeyCenters(tune, INSTRUMENTS.concert).readings[0].reason).toContain('implied progression center');
		const solo = tuneKeyCenters(tune, INSTRUMENTS.concert, { solo: true });
		expect(solo.markers.map(m => m.timeRange)).toEqual([{ start: 0, end: 1 }, { start: 2, end: 3 }]);
		expect(solo.legend.map(l => l.label)).toEqual(['C major']);
	});
	it('labels the first full bar after a pickup without treating its silent prefix as harmony', () => {
		const tune = sheet({ sections: [section({ label: '', bars: 1, pickupLength: [1, 4],
			notes: [{ pitch: 60, offset: [3, 4], duration: [1, 4] }], harmony: [] }),
			section({ bars: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1]), seg('F', 'maj7', [1, 1], [1, 1])] })] });
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		expect(display.markers.every(m => m.timeRange?.start === 1)).toBe(true);
		expect(display.readings[0].rangeLabel).toBe('Bar 1, beat 1 → Bar 2 end');
		expect(tuneKeyCenters(tune, INSTRUMENTS.concert, { solo: true }).markers).toEqual(display.markers);
	});
});

import { MANKUNKU_BLUES } from '../../src/lib/data/tunes/mankunku-blues';
import { flattenTune } from '../../src/lib/tunes/flatten';
import { addFractions, fractionToFloat } from '../../src/lib/music/intervals';
import { buildPerformanceForm } from '../../src/lib/audio/performance-form';

export function buildNativeBluesFixture() {
	// The source's expanded repeat is intro + first-ending head + resolved solo.
	// The listening desk appends one more resolved solo, then the resolved head
	// out: 4 + 12 + 12 + 12 + 12 = 52 bars. Use the chart's actual harmony and
	// section provenance, without importing listening-tunes' reactive UI stores
	// into Playwright's Node discovery process.
	const flat = flattenTune(MANKUNKU_BLUES, { expandRepeats: true });
	if (flat.totalBars !== 28) throw new Error('Native Blues fixture expects the 28-bar expanded source chart');
	const resolvedHarmony = flat.harmony.filter(segment => fractionToFloat(segment.startOffset) >= 16);
	const resolvedSections = flat.sectionMap.filter(section => section.barOffset >= 16);
	const harmony = [...flat.harmony, ...[12, 24].flatMap(shift => resolvedHarmony.map(segment => ({
		...segment, chord: { ...segment.chord }, startOffset: addFractions(segment.startOffset, [shift, 1])
	})))];
	const sectionMap = [...flat.sectionMap, ...[12, 24].flatMap(shift => resolvedSections.map(section => ({
		...section, barOffset: section.barOffset + shift
	})))];
	return { id: `musicality-${MANKUNKU_BLUES.id}-F-2`, harmony, sectionMap,
		performanceForm: buildPerformanceForm({ totalBars: 52, sectionMap, choruses: [
			{ role: 'head', startBar: 0, endBarExclusive: 16 },
			{ role: 'solo', startBar: 16, endBarExclusive: 28 },
			{ role: 'solo', startBar: 28, endBarExclusive: 40 },
			{ role: 'head', startBar: 40, endBarExclusive: 52 }
		] }) };
}


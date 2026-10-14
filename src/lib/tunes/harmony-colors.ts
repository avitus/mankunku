import type { Tune } from '$lib/types/tune';
import { PITCH_CLASSES, type HarmonicSegment } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import type { RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';

/** Only familiar, unambiguous chord roles receive a tint; other harmony stays neutral. */
export function harmonyRole(segment: HarmonicSegment, key: Tune['key']): 'tonic' | 'subdominant' | 'dominant' | null {
	const root = (PITCH_CLASSES.indexOf(segment.chord.root) - PITCH_CLASSES.indexOf(key) + 12) % 12;
	const quality = segment.chord.quality;
	if (quality.startsWith('7')) return 'dominant';
	if (root === 0 && ['maj6', 'maj7', 'min6', 'min7', 'minMaj7'].includes(quality)) return 'tonic';
	if ((root === 5 && ['maj6', 'maj7', 'min6', 'min7'].includes(quality)) || (root === 2 && ['min7', 'min7b5'].includes(quality))) return 'subdominant';
	return null;
}

/** Notation-order overlays, preserving partial-bar harmony and declared meter. */
export function tuneHarmonyMarkers(tune: Tune): RangeMarker[] {
	const markers: RangeMarker[] = [];
	const barLength = tune.timeSignature[0] / tune.timeSignature[1];
	let base = 0;
	for (const [sectionIndex, section] of tune.sections.entries()) {
		for (const [index, segment] of section.harmony.entries()) {
			const role = harmonyRole(segment, tune.key);
			if (!role) continue;
			const start = Math.max(0, fractionToFloat(segment.startOffset));
			const end = Math.min(section.bars * barLength, start + fractionToFloat(segment.duration));
			if (end <= start) continue;
			markers.push({ id: `harmony-${sectionIndex}-${index}`, startBar: base + Math.floor(start / barLength), endBarExclusive: base + Math.ceil(end / barLength), timeRange: { start: base * barLength + start, end: base * barLength + end }, status: 'upcoming', color: `var(--tune-${role})` });
		}
		base += section.bars;
	}
	return markers;
}

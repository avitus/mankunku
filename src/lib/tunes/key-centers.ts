import type { Tune } from '$lib/types/tune';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
import { fractionToFloat } from '$lib/music/intervals';
import { concertKeyToWritten } from '$lib/music/transposition';
import { keyLabel, keyLabelLong } from '$lib/music/notation';
import { isInPickupLeadIn } from '$lib/music/pickup';
import { chordEvidence } from '$lib/music/chord-evidence';
import { progressionMode, PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import { analyzeHarmony } from './harmonic-analysis';
import { flattenTune } from './flatten';
import { soloPlaybackFlat } from './solo-form';

export interface KeyCenterReading {
	key: PitchClass;
	mode: 'major' | 'minor' | 'blues';
	label: string;
	color: string;
	start: number;
	end: number;
	/** Visit to this printed passage, preserving alternate repeat contexts. */
	visits: number[];
	repeated: boolean;
	reason: string;
	rangeLabel: string;
}

export interface KeyCenterDisplay {
	readings: KeyCenterReading[];
	markers: RangeMarker[];
	legend: { label: string; color: string }[];
	barLength: number;
}

/** Stable written-tonic hues. Text labels carry the identity independently of color. */
function centerColor(key: PitchClass): string {
	return `hsl(${[42, 195, 115, 285, 15, 165, 330, 75, 235, 145, 310, 215][PITCH_CLASSES.indexOf(key)]} 25% var(--key-center-lightness, 58%))`;
}

/**
 * Analyze performed repeat contexts, then project each contiguous piece through
 * section/bar provenance. Never bridge a skipped ending or a repeat jump.
 * This display reads full compatible collections, never reserved exercise regions.
 */
export function tuneKeyCenters(tune: Tune, instrument: InstrumentConfig, options: { solo?: boolean } = {}): KeyCenterDisplay {
	const barLength = tune.timeSignature[0] / tune.timeSignature[1];
	const display: KeyCenterDisplay = { readings: [], markers: [], legend: [], barLength };
	const expanded = flattenTune(tune, { expandRepeats: true });
	const notation = flattenTune(tune);
	let pickupBars = 0;
	while (pickupBars < expanded.totalBars && isInPickupLeadIn(tune, pickupBars)) pickupBars++;
	const played = options.solo ? soloPlaybackFlat(expanded, tune.timeSignature, pickupBars)
		: { flat: expanded, sourceBars: Array.from({ length: expanded.totalBars }, (_, i) => i) };
	const { flat } = played;
	const analysis = analyzeHarmony(flat, tune, { cyclic: false });
	if (analysis.issues.length) return display;
	const counts = new Map<number, number>();
	const sourceMap: { bar: number; visit: number; section: number }[] = [];
	for (const entry of expanded.sectionMap) {
		const visit = (counts.get(entry.sourceSection) ?? 0) + 1;
		counts.set(entry.sourceSection, visit);
		const base = notation.sectionMap[entry.sourceSection].barOffset;
		for (let bar = 0; bar < tune.sections[entry.sourceSection].bars; bar++) {
			sourceMap[entry.barOffset + bar] = { bar: base + bar, visit, section: entry.sourceSection };
		}
	}
	/** Project one evidenced interpretation, retaining its separate functional explanation. */
	function add(key: PitchClass, mode: KeyCenterReading['mode'], indices: number[], reason: string): void {
		if (indices.some(i => !chordEvidence(flat.harmony[i]))) return;
		const written = concertKeyToWritten(key, instrument);
		const label = mode === 'blues' ? `${keyLabel(written)} blues` : keyLabelLong(written, mode);
		let piece: KeyCenterReading | undefined;
		for (const index of indices) {
			const segment = flat.harmony[index];
			const from = fractionToFloat(segment.startOffset);
			const to = from + fractionToFloat(segment.duration);
			for (let bar = Math.floor(from / barLength); bar * barLength < to - 1e-8; bar++) {
				const source = sourceMap[played.sourceBars[bar]];
				if (!source) continue;
				const start = source.bar * barLength + Math.max(0, from - bar * barLength);
				const end = source.bar * barLength + Math.min(barLength, to - bar * barLength);
				const repeated = (counts.get(source.section) ?? 0) > 1;
				if (piece && Math.abs(piece.end - start) < 1e-8 && piece.visits[0] === source.visit) {
					piece.end = end;
					piece.repeated ||= repeated;
				} else {
					piece = { key, mode, label, color: centerColor(written), start, end, visits: [source.visit], repeated, reason, rangeLabel: '' };
					display.readings.push(piece);
				}
			}
		}
	}
	for (const region of analysis.compatibleMajorRegions) {
		add(region.key, 'major', region.segmentIndices, region.evidence.cadences.length
			? 'Compatible major collection with a V–I arrival.'
			: 'Compatible major collection with a tonic chord; other readings may also fit.');
	}
	for (const cornerstone of analysis.cornerstones) {
		if (cornerstone.kind === 'minor-arrival') add(cornerstone.localKey, 'minor', cornerstone.segmentIndices,
			'Minor arrival: ii–V–i. A local destination, not one minor scale over every chord.');
		else {
			const detection = cornerstone.detection;
			const hasTonic = detection.segmentIndices.some(i => flat.harmony[i].chord.root === detection.localKey);
			add(detection.localKey, detection.type === 'blues' ? 'blues' : progressionMode(detection.type), detection.segmentIndices,
				`${PROGRESSION_TEMPLATES[detection.type].shortName}: ${hasTonic ? 'local progression center with a tonic chord' : 'implied progression center; the tonic is not present in this span'}. Cornerstone priority is retained for practice.`);
		}
	}
	const unique = new Map<string, KeyCenterReading>();
	for (const reading of display.readings) {
		const id = `${reading.key}/${reading.mode}/${reading.start}/${reading.end}/${reading.reason}`;
		const existing = unique.get(id);
		if (existing) {
			existing.visits = [...new Set([...existing.visits, ...reading.visits])];
			existing.repeated ||= reading.repeated;
		} else unique.set(id, reading);
	}
	display.readings = [...unique.values()].sort((a, b) => a.start - b.start || b.end - a.end || a.label.localeCompare(b.label));
	let printed = 0;
	const barLabels = Array.from({ length: notation.totalBars }, (_, i) => isInPickupLeadIn(tune, i) ? 'Pickup' : `Bar ${++printed}`);
	/** End labels name the exclusive boundary, not the chord after it. */
	const position = (time: number, end = false): string => {
		const bar = Math.floor(time / barLength + 1e-8);
		const beat = Math.round((time - bar * barLength) * tune.timeSignature[1] * 1000) / 1000 + 1;
		if (end && beat === 1) return `${barLabels[bar - 1]} end`;
		return `${barLabels[bar]}, beat ${beat}`;
	};
	for (const reading of display.readings) reading.rangeLabel = `${position(reading.start)} → ${position(reading.end, true)}`;
	// Union duplicate coverage of the SAME center only; keep all evidence above.
	const spans: KeyCenterReading[] = [];
	for (const label of new Set(display.readings.map(r => r.label))) {
		const readings = display.readings.filter(r => r.label === label);
		display.legend.push({ label, color: readings[0].color });
		let previous: KeyCenterReading | undefined;
		for (const reading of readings) {
			if (previous && reading.start <= previous.end + 1e-8) previous.end = Math.max(previous.end, reading.end);
			else { previous = { ...reading }; spans.push(previous); }
		}
	}
	const laneEnds: number[] = [];
	for (const [index, span] of spans.sort((a, b) => a.start - b.start || b.end - a.end || a.label.localeCompare(b.label)).entries()) {
		let lane = laneEnds.findIndex(end => end <= span.start + 1e-8);
		if (lane === -1) lane = laneEnds.length;
		laneEnds[lane] = span.end;
		display.markers.push({ id: `key-center-${index}`, startBar: Math.floor(span.start / barLength),
			endBarExclusive: Math.ceil(span.end / barLength), timeRange: { start: span.start, end: span.end },
			status: 'upcoming', color: span.color, keyCenter: { lane, lanes: 0, label: span.label, minor: span.mode === 'minor' } });
	}
	for (const marker of display.markers) marker.keyCenter!.lanes = laneEnds.length;
	return display;
}

/** Half-open coverage within an individual chart bar, including split-bar transitions. */
export function keyCenterBarSpan(marker: RangeMarker, bar: number, barLength: number): { left: number; width: number } {
	const start = Math.max(bar * barLength, marker.timeRange?.start ?? marker.startBar * barLength);
	const end = Math.min((bar + 1) * barLength, marker.timeRange?.end ?? marker.endBarExclusive * barLength);
	return { left: (start / barLength - bar) * 100, width: Math.max(0, (end - start) / barLength * 100) };
}

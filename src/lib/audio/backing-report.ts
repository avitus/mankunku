/**
 * Deterministic backing-generation statistics report.
 *
 * Runs the generator over the lab presets × the protocol tempi × several
 * seeds and renders ASCII histograms of the musical surface: bass interval
 * content, comping density and placement, drum voice activity. The snapshot
 * lives at documentation/reference/backing-report.txt (written by
 * `npm run backing:report`, verified by a unit test) so every engine PR
 * shows its statistical drift as a reviewable text diff.
 *
 * Distribution judgments stay HUMAN judgments: nothing here is a CI
 * tolerance. The test only asserts the committed snapshot matches the
 * current engine, i.e. that the diff was looked at.
 */

import { BACKING_STYLES } from './backing-styles';
import {
	generateBacking,
	resolveEffectiveSwing,
	type GeneratedBacking
} from './backing-generation';
import { pitchClassToNumber } from './voicings';
import { fractionToFloat } from '$lib/music/intervals';
import {
	BACKING_LAB_PRESETS,
	LAB_TEMPO_PRESETS,
	labPhraseWithSeed,
	type BackingLabPreset
} from './backing-lab-presets';

const REPORT_PRESET_IDS = ['lab-blues-f', 'lab-aaba-c'] as const;
const REPORT_SEEDS = [0, 1, 2, 3, 4];
const REPORT_PPQ = 192;

function bar(fraction: number, width = 24): string {
	const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
	return '█'.repeat(filled).padEnd(width, '·');
}

function pct(fraction: number): string {
	return `${(fraction * 100).toFixed(1)}%`.padStart(6);
}

interface PresetStats {
	swing: number;
	bassIntervals: Map<string, number>;
	bassTotalIntervals: number;
	bassStepwise: number;
	bassDownbeats: number;
	bassDownbeatRoots: number;
	bassRepeatRuns: number;
	compHitsPerBar: Map<number, number>;
	compOffbeatHits: number;
	compTotalHits: number;
	compBars: number;
	compRestBars: number;
	drumHitsByVoice: Map<string, number>;
	drumOffbeatHits: number;
	drumTotalHits: number;
	totalBars: number;
}

const INTERVAL_BUCKETS = ['0', '1', '2', '3-4', '5-7', '8+'] as const;

function intervalBucket(semitones: number): string {
	const a = Math.abs(semitones);
	if (a <= 2) return String(a);
	if (a <= 4) return '3-4';
	if (a <= 7) return '5-7';
	return '8+';
}

function collect(preset: BackingLabPreset, tempo: number, seeds: number[]): PresetStats {
	const style = BACKING_STYLES.swing;
	const swing = resolveEffectiveSwing(0.5, style);
	const beatsPerBar = 4;
	const totalBars = preset.bars;

	const stats: PresetStats = {
		swing,
		bassIntervals: new Map(),
		bassTotalIntervals: 0,
		bassStepwise: 0,
		bassDownbeats: 0,
		bassDownbeatRoots: 0,
		bassRepeatRuns: 0,
		compHitsPerBar: new Map(),
		compOffbeatHits: 0,
		compTotalHits: 0,
		compBars: 0,
		compRestBars: 0,
		drumHitsByVoice: new Map(),
		drumOffbeatHits: 0,
		drumTotalHits: 0,
		totalBars
	};

	// Root pitch class sounding at each downbeat, from the preset harmony.
	const rootAtBeat = (beat: number): number | null => {
		for (const seg of preset.phrase.harmony) {
			const start = fractionToFloat(seg.startOffset) * 4;
			const dur = fractionToFloat(seg.duration) * 4;
			if (beat >= start && beat < start + dur) return pitchClassToNumber(seg.chord.root);
		}
		return null;
	};

	for (const seed of seeds) {
		const phrase = labPhraseWithSeed(preset, seed);
		const generated: GeneratedBacking = generateBacking(phrase.harmony, style, {
			phraseId: phrase.id,
			tempo,
			ppq: REPORT_PPQ,
			beatsPerBar,
			swing,
			sectionMap: phrase.sectionMap
		});

		// Bass: quarters only (ghosts/pickups decorate, they aren't the line).
		const quarters = generated.bassEvents
			.filter((e) => e.absBeat % 1 === 0)
			.sort((a, b) => a.absBeat - b.absBeat);
		let runLength = 1;
		for (let i = 0; i < quarters.length; i++) {
			const e = quarters[i];
			if (e.absBeat % beatsPerBar === 0) {
				stats.bassDownbeats++;
				const root = rootAtBeat(e.absBeat);
				if (root !== null && ((e.midi % 12) + 12) % 12 === root) stats.bassDownbeatRoots++;
			}
			if (i > 0) {
				const interval = e.midi - quarters[i - 1].midi;
				const bucket = intervalBucket(interval);
				stats.bassIntervals.set(bucket, (stats.bassIntervals.get(bucket) ?? 0) + 1);
				stats.bassTotalIntervals++;
				if (Math.abs(interval) > 0 && Math.abs(interval) <= 2) stats.bassStepwise++;
				if (interval === 0) {
					runLength++;
					if (runLength === 3) stats.bassRepeatRuns++;
				} else {
					runLength = 1;
				}
			}
		}

		// Comp: hits per bar + placement.
		const compBarCounts = new Array<number>(totalBars).fill(0);
		for (const e of generated.compEvents) {
			const barIdx = Math.floor(e.absBeat / beatsPerBar);
			if (barIdx < totalBars) compBarCounts[barIdx]++;
			if (e.absBeat % 1 !== 0) stats.compOffbeatHits++;
			stats.compTotalHits++;
		}
		for (const count of compBarCounts) {
			const bucket = Math.min(count, 4);
			stats.compHitsPerBar.set(bucket, (stats.compHitsPerBar.get(bucket) ?? 0) + 1);
			stats.compBars++;
			if (count === 0) stats.compRestBars++;
		}

		// Drums: per-voice totals + off-beat share.
		for (const e of generated.drumEvents) {
			stats.drumHitsByVoice.set(e.drum, (stats.drumHitsByVoice.get(e.drum) ?? 0) + 1);
			if (e.absBeat % 1 !== 0) stats.drumOffbeatHits++;
			stats.drumTotalHits++;
		}
	}

	return stats;
}

function renderPreset(preset: BackingLabPreset, tempo: number, stats: PresetStats): string[] {
	const lines: string[] = [];
	const seedCount = REPORT_SEEDS.length;
	lines.push(`── ${preset.label} @ ${tempo} BPM (swing ${stats.swing.toFixed(3)}, ${seedCount} seeds) ──`);

	lines.push('  bass interval |Δst| distribution:');
	for (const bucket of INTERVAL_BUCKETS) {
		const count = stats.bassIntervals.get(bucket) ?? 0;
		const frac = stats.bassTotalIntervals > 0 ? count / stats.bassTotalIntervals : 0;
		lines.push(`    ${bucket.padStart(3)} ${bar(frac)} ${pct(frac)}`);
	}
	lines.push(
		`  bass: stepwise ${pct(stats.bassStepwise / Math.max(1, stats.bassTotalIntervals))}` +
			` · downbeat-root ${pct(stats.bassDownbeatRoots / Math.max(1, stats.bassDownbeats))}` +
			` · 3+-repeat runs ${stats.bassRepeatRuns}`
	);

	lines.push('  comp hits/bar distribution:');
	for (let bucket = 0; bucket <= 4; bucket++) {
		const count = stats.compHitsPerBar.get(bucket) ?? 0;
		const frac = stats.compBars > 0 ? count / stats.compBars : 0;
		lines.push(`    ${String(bucket === 4 ? '4+' : bucket).padStart(3)} ${bar(frac)} ${pct(frac)}`);
	}
	lines.push(
		`  comp: off-beat share ${pct(stats.compOffbeatHits / Math.max(1, stats.compTotalHits))}` +
			` · rest bars ${pct(stats.compRestBars / Math.max(1, stats.compBars))}`
	);

	const voices = [...stats.drumHitsByVoice.keys()].sort();
	const perBar = (v: string) =>
		((stats.drumHitsByVoice.get(v) ?? 0) / (stats.totalBars * seedCount)).toFixed(2);
	lines.push(`  drums hits/bar: ${voices.map((v) => `${v} ${perBar(v)}`).join(' · ')}`);
	lines.push(
		`  drums: off-beat share ${pct(stats.drumOffbeatHits / Math.max(1, stats.drumTotalHits))}`
	);
	lines.push('');
	return lines;
}

/** Build the full deterministic report text (no timestamps, stable ordering). */
export function buildBackingReport(): string {
	const lines: string[] = [
		'BACKING GENERATION REPORT',
		'Deterministic statistics over the listening-lab presets. Regenerate with',
		'`npm run backing:report` after any engine change and review the diff.',
		''
	];
	for (const id of REPORT_PRESET_IDS) {
		const preset = BACKING_LAB_PRESETS.find((p) => p.id === id);
		if (!preset) continue;
		for (const tempo of LAB_TEMPO_PRESETS) {
			lines.push(...renderPreset(preset, tempo, collect(preset, tempo, REPORT_SEEDS)));
		}
	}
	return lines.join('\n');
}

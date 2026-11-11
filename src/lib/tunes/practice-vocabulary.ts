import type { Mode, PitchClass } from '$lib/types/music';
import type { InsertionPoint } from '$lib/state/tune-practice-plan';
import { baseLickId } from '$lib/phrases/library-loader';
import type { PracticeTargetType } from './practice-target';

export interface VocabularyPlacement {
	key: PitchClass;
	mode: Mode;
	context: string;
	progressionType: PracticeTargetType;
	startBar: number;
	endBarExclusive: number;
	timeRange: { start: number; end: number };
	closingPass: boolean;
	keyReady: boolean;
	tempoReady: boolean;
	practicedTempo: number;
}

export interface FittingLick {
	id: string;
	name: string;
	ready: boolean;
	placements: VocabularyPlacement[];
}

/** Group every fitting alternative, preserving key-specific availability and chart provenance. */
export function practiceVocabulary(alternatives: readonly InsertionPoint[]): FittingLick[] {
	const licks = new Map<string, FittingLick>();
	for (const point of alternatives) {
		for (const suggestion of point.suggestions) {
			const id = baseLickId(suggestion.lickId);
			const entry = licks.get(id) ?? { id, name: suggestion.lickName, ready: false, placements: [] };
			const availability = suggestion.readiness ?? {
				keyReady: suggestion.masteryTier !== 'unknown', tempoReady: true, practicedTempo: 60
			};
			const placement: VocabularyPlacement = {
				key: suggestion.targetKey, mode: suggestion.mode,
				context: suggestion.placement === 'progression' ? 'Whole ii–V–I' : point.bandName,
				progressionType: point.progressionType,
				startBar: point.notationBarRange.start, endBarExclusive: point.notationBarRange.endExclusive,
				timeRange: point.notationTimeRange, closingPass: !!point.closingPass, ...availability
			};
			if (!entry.placements.some(p => p.key === placement.key && p.context === placement.context &&
				p.timeRange.start === placement.timeRange.start && p.timeRange.end === placement.timeRange.end &&
				p.closingPass === placement.closingPass)) entry.placements.push(placement);
			entry.ready ||= availability.keyReady && availability.tempoReady;
			licks.set(id, entry);
		}
	}
	return [...licks.values()].sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name));
}

/**
 * The PDF import's review loop (phase 4 of the score-editing plan,
 * 2026-10-16). The import flags SUSPECT bars — 1-based absolute bar numbers
 * in notation order — and the editor draws them on the chart, jumps between
 * them (`N`) and lets them go once the user has edited their melody. Nothing
 * here is persisted; the list lives with the import draft.
 */

import type { Tune } from '$lib/types/tune';
import { fractionToFloat } from '$lib/music/intervals';

/**
 * The PITCHED notes overlapping absolute bar `absBar` (0-based), as a
 * comparable string. Rests are left out on purpose: a page's first commit
 * stores its synthesized gap rests, and a note typed past the content end
 * bridges the gap with one — neither is the user reviewing a bar.
 */
function barSignature(tune: Tune, absBar: number): string {
	const barLen = tune.timeSignature[0] / tune.timeSignature[1];
	let base = 0;
	for (const sec of tune.sections) {
		if (absBar < base + sec.bars) {
			const start = (absBar - base) * barLen;
			const end = start + barLen;
			return sec.notes
				.filter((n) => {
					if (n.pitch === null) return false;
					const o = fractionToFloat(n.offset);
					return o < end - 1e-9 && o + fractionToFloat(n.duration) > start + 1e-9;
				})
				.map((n) => `${n.pitch ?? 'z'}@${fractionToFloat(n.offset)}x${fractionToFloat(n.duration)}${n.tied ? '~' : ''}`)
				.join('|');
		}
		base += sec.bars;
	}
	return '';
}

/**
 * Suspect bars (1-based) whose melody is the same in `before` and `after`:
 * a bar the user has edited has been reviewed, and leaves the list.
 */
export function clearEditedSuspectBars(before: Tune, after: Tune, suspectBars: number[]): number[] {
	return suspectBars.filter((bar) => barSignature(before, bar - 1) === barSignature(after, bar - 1));
}

/** The first suspect bar after `currentBar` (1-based), wrapping to the first; null when none. */
export function nextSuspectBar(suspectBars: number[], currentBar: number): number | null {
	if (suspectBars.length === 0) return null;
	const sorted = [...suspectBars].sort((a, b) => a - b);
	return sorted.find((b) => b > currentBar) ?? sorted[0];
}

/** Section and bar-in-section of a 0-based absolute bar; null past the form's end. */
export function absoluteBarToSection(
	tune: Pick<Tune, 'sections'>,
	absBar: number
): { sectionIdx: number; barInSection: number } | null {
	let remaining = absBar;
	for (let i = 0; i < tune.sections.length; i++) {
		if (remaining < tune.sections[i].bars) return { sectionIdx: i, barInSection: remaining };
		remaining -= tune.sections[i].bars;
	}
	return null;
}

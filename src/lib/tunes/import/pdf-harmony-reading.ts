/** Validate independently read harmony without losing its measure alignment. */
import { parseChordSymbol } from '$lib/music/chord-symbol';
import type { Harmony } from './pdf-recognition';

export interface HarmonyReading {
	bars: Harmony;
	issues: string[][];
}

export function screenHarmonyReading(raw: unknown, count: number, beats: number): HarmonyReading {
	const bars = raw && typeof raw === 'object' && 'bars' in raw ? raw.bars : null;
	if (!Array.isArray(bars) || bars.length !== count)
		throw new Error('harmony measure count disagrees with the layout');
	const issues: string[][] = Array.from({ length: count }, () => []);
	const screened: Harmony = bars.map((bar, i) => {
		if (!Array.isArray(bar) || bar.length > 32) {
			issues[i].push('unreadable chord symbols');
			return [];
		}
		return bar
			.filter((chord): chord is [number, string] => {
				const ok =
					Array.isArray(chord) &&
					chord.length === 2 &&
					typeof chord[0] === 'number' &&
					Number.isFinite(chord[0]) &&
					chord[0] >= 0 &&
					chord[0] < beats &&
					typeof chord[1] === 'string' &&
					chord[1].length <= 100 &&
					(chord[1] === 'N.C.' || parseChordSymbol(chord[1]) !== null);
				if (!ok) issues[i].push('a chord could not be read reliably');
				return ok;
			})
			.sort((a, b) => a[0] - b[0]);
	});
	return { bars: screened, issues };
}

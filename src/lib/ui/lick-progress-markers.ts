import type { UnlockMarker } from '$lib/difficulty/lick-phase';

export interface NamedUnlockMarker extends UnlockMarker {
	label: string;
	names: string[];
	left: number;
	width: number;
}

/** Fit written-key labels to the chart, combining nearby unlocks without losing their names. */
export function namedUnlockMarkers(
	markers: readonly UnlockMarker[],
	keyLabels: readonly string[],
	left: number,
	right: number
): NamedUnlockMarker[] {
	function place(marker: UnlockMarker): NamedUnlockMarker {
		const names = keyLabels.slice(marker.from, marker.to);
		const label = names.length > 1 ? `${names[0]}+${names.length - 1}` : names[0];
		// 8px monospace text, with 3px padding on each side.
		const width = label.length * 5 + 6;
		return { ...marker, label, names, width, left: Math.max(left, Math.min(marker.x - width / 2, right - width)) };
	}
	const placed: NamedUnlockMarker[] = [];
	for (const marker of markers) {
		if (marker.from < 0 || marker.to > keyLabels.length || marker.to <= marker.from) continue;
		let next = place(marker);
		while (placed.length && next.left < placed[placed.length - 1].left + placed[placed.length - 1].width + 3) {
			const previous = placed.pop()!;
			next = place({ ...previous, from: Math.min(previous.from, next.from), to: Math.max(previous.to, next.to) });
		}
		placed.push(next);
	}
	return placed;
}

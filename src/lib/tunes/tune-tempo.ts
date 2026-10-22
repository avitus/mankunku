/** The tune desk's tempo range; practice setup clamps further to its own knob. */
export function clampTuneTempo(value: number): number {
	return Math.max(40, Math.min(240, Math.round(Number.isFinite(value) ? value : 100)));
}

/** Keep only numeric tempos when settings are read from storage or cloud. */
export function cleanTuneTempos(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value)
			.filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
			.map(([id, tempo]) => [id, clampTuneTempo(tempo)])
	);
}

/** The tempo last chosen for this tune, if any; own keys only. */
export function savedTuneTempo(tempos: Record<string, number>, tuneId: string): number | undefined {
	return Object.hasOwn(tempos, tuneId) ? tempos[tuneId] : undefined;
}

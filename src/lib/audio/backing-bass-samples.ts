import type { SmplrGroup, SmplrPreset, SmplrRegion } from 'smplr';

const PIZZICATO_BASE_URL = 'https://smpldsnds.github.io/sfzinstruments-dsmolken-double-bass';

/**
 * Source: d_smolken_rubner_bass_pizz.sfz at PIZZICATO_BASE_URL, SHA-256
 * 0aea1def56753b0dcc89914b1ac24054200bacc01dd696572745c70787eaec4f.
 * D. Smolken, 2013: royalty-free commercial/non-commercial recordings/mapping.
 * These are the 23 source groups used by the backing bass's MIDI 28–55 range.
 * Each stem explicitly names a source cycle; suffixes a/b/c/d are its recorded
 * sequence positions, NOT inferred dynamics (Bb1's medium recordings say f).
 * Other source groups, including noises, are outside this correction. The
 * supported guarantee is MIDI 28–55; the first source group also spans MIDI 27.
 */
const SOURCE_GROUPS: readonly (readonly [stem: string, low: number, high: number, pitch: number,
	choke: number, velLow: number, velHigh: number, length: number])[] = [
	['pizz_g1_f', 27, 33, 31, 1, 121, 127, 4],
	['pizz_g1_p', 28, 31, 31, 2, 0, 74, 4],
	['pizz_g1_m', 28, 31, 31, 2, 75, 120, 4],
	['pizz_bb1_p', 32, 34, 34, 2, 0, 74, 4],
	['pizz_bb1_f', 32, 34, 34, 2, 75, 120, 4],
	['pizz_d2_f', 34, 38, 38, 3, 121, 127, 4],
	['pizz_d2_p', 35, 38, 38, 3, 0, 74, 4],
	['pizz_d2_m', 35, 38, 38, 3, 75, 120, 4],
	['pizz_f2_p', 39, 41, 41, 3, 0, 74, 4],
	['pizz_f2_m', 39, 41, 41, 3, 75, 120, 4],
	['pizz_f2_f', 39, 41, 41, 3, 121, 127, 4],
	['pizz_a2_p', 42, 45, 45, 4, 0, 74, 4],
	['pizz_a2_m', 42, 45, 45, 4, 75, 120, 4],
	['pizz_a2_f', 42, 45, 45, 4, 121, 127, 4],
	['pizz_c3_p', 46, 48, 48, 4, 0, 74, 4],
	['pizz_c3_m', 46, 48, 48, 4, 75, 120, 4],
	['pizz_c3_f', 46, 48, 48, 4, 121, 127, 4],
	['pizz_e3_p', 49, 52, 52, 5, 0, 74, 3],
	['pizz_e3_m', 49, 52, 52, 5, 75, 120, 4],
	['pizz_e3_f', 49, 52, 52, 5, 121, 127, 4],
	['pizz_g3_p', 53, 55, 55, 5, 0, 74, 4],
	['pizz_g3_m', 53, 55, 55, 5, 75, 120, 4],
	['pizz_g3_f', 53, 55, 55, 5, 121, 127, 4]
];

const sourceGroups = SOURCE_GROUPS.map(([stem, low, high, pitch, choke, velLow, velHigh, length]) => ({
	velRange: [velLow, velHigh] as [number, number],
	length,
	group: { group: choke, offBy: choke, ampRelease: 0.4 },
	regions: Array.from({ length }, (_, position): SmplrRegion => ({
		sample: `pizz/${stem}${'abcd'[position]}`, keyRange: [low, high], pitch,
		...(position ? { seqPosition: position + 1 } : {}), group: choke, offBy: choke, ampRelease: 0.4
	}))
}));

function equalFields(actual: object, expected: object): boolean {
	const entries = Object.entries(actual);
	return entries.length === Object.keys(expected).length && entries.every(([key, value]) =>
		Object.hasOwn(expected, key) && JSON.stringify(value) === JSON.stringify((expected as Record<string, unknown>)[key]));
}

function matchesGroup(group: SmplrGroup, source: typeof sourceGroups[number]): boolean {
	const { regions, velRange, seqLength, ...rest } = group;
	if (!equalFields(rest, source.group) || regions.length !== source.length ||
		(velRange !== undefined && JSON.stringify(velRange) !== JSON.stringify(source.velRange)) ||
		(seqLength !== undefined && seqLength !== source.length)) return false;
	return regions.every((region, index) => {
		const { velRange: regionVelocity, ...fields } = region;
		return (regionVelocity === undefined || JSON.stringify(regionVelocity) === JSON.stringify(source.velRange)) &&
			equalFields(fields, source.regions[index]);
	});
}

/**
 * Restore this bank's omitted one-sided velocity limits and region RR lengths.
 * Call synchronously in SampleLoader.load BEFORE Smolken constructs its matcher.
 * Only group selection fields change; audio, gain, release and key mapping do not.
 * The entire active signature must match before any mutation: partial repair
 * could leave unknown overlapping layers sounding alongside corrected groups.
 * A future/modified bank is left intact for a new audit. Existing correct fields
 * are respected, making repeated calls harmless. Source amp_velcurve opcodes
 * remain unsupported by smplr and are deliberately not approximated here.
 */
export function normalizeBackingBassPreset(preset: SmplrPreset): boolean {
	return normalizeBackingBassPresetWithStatus(preset).changed;
}

/** Recognition remains true on an already-correct bank, independently of writes. */
export function normalizeBackingBassPresetWithStatus(preset: SmplrPreset): { recognized: boolean; changed: boolean } {
	if (preset.samples.baseUrl.replace(/\/+$/, '') !== PIZZICATO_BASE_URL ||
		(preset.samples.map && Object.keys(preset.samples.map).length) ||
		(preset.defaults && Object.keys(preset.defaults).length)) return { recognized: false, changed: false };
	const matched = sourceGroups.map((source) => preset.groups.filter((group) => matchesGroup(group, source)));
	if (matched.some((groups) => groups.length !== 1)) return { recognized: false, changed: false };
	const activeGroups = new Set(matched.map(([group]) => group));
	if (preset.groups.some((group) => !activeGroups.has(group) && group.regions.some((region) => {
		const [low, high] = region.keyRange ?? [region.key ?? 0, region.key ?? 127];
		return low <= 55 && high >= 28;
	}))) return { recognized: false, changed: false };
	let changed = false;
	for (let index = 0; index < sourceGroups.length; index++) {
		const source = sourceGroups[index];
		const group = matched[index][0];
		if (group.velRange === undefined) { group.velRange = [...source.velRange]; changed = true; }
		if (group.seqLength === undefined) { group.seqLength = source.length; changed = true; }
	}
	return { recognized: true, changed };
}

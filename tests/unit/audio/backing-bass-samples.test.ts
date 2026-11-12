import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SmplrPreset } from 'smplr';
import { normalizeBackingBassPreset, normalizeBackingBassPresetWithStatus } from '$lib/audio/backing-bass-samples';

const baseUrl = 'https://smpldsnds.github.io/sfzinstruments-dsmolken-double-bass';
// Complete, unmodified D. Smolken source (royalty-free, attribution in header).
// URL: https://smpldsnds.github.io/sfzinstruments-dsmolken-double-bass/d_smolken_rubner_bass_pizz.sfz
const source = readFileSync('tests/fixtures/audio/smolken-pizzicato.sfz', 'utf8');
// Exercise the installed engine's actual private converter/matcher, rather
// than copying their behavior into an oracle. This is test-only introspection
// of smplr 1.0's local CommonJS bundle, with no browser/audio emulation.
const require = createRequire(import.meta.url);
const bundle = readFileSync(require.resolve('smplr'), 'utf8');
const engine = new Function('module', 'exports', `${bundle}\nreturn { sfzToPreset, RegionMatcher };`)({ exports: {} }, {}) as {
	sfzToPreset: (source: string, options: { baseUrl: string; pathFromSampleName: (name: string) => string }) => SmplrPreset;
	RegionMatcher: new (preset: SmplrPreset) => { match: (note: number, velocity: number, cc: Map<number, number>) => { sample: string }[] };
};
function fixture(full = false) {
	const preset = engine.sfzToPreset(source, { baseUrl, pathFromSampleName: (name) => name.replace(/\\/g, '/').replace(/\.wav$/, '') });
	if (!full) preset.groups = preset.groups.filter((group) => group.regions.some((region) =>
		region.keyRange && region.keyRange[0] <= 55 && region.keyRange[1] >= 28));
	return preset;
}

// Expected sample assignments come from the SFZ, including inherited group
// velocity limits and the Bb1 medium layer whose filename misleadingly says f.
const sourceRegions: { sample: string; low: number; high: number; velLow: number; velHigh: number; position: number; length: number }[] = [];
let group: Record<string, string> = {};
for (const scope of source.replace(/\/\/[^\n]*/g, '').split(/(?=<(?:group|region)>)/)) {
	const props = Object.fromEntries([...scope.matchAll(/(\w+)=([^\s]+)/g)].map((m) => [m[1], m[2]]));
	if (scope.startsWith('<group>')) group = props;
	if (!scope.startsWith('<region>')) continue;
	const p = { ...group, ...props };
	if (+p.lokey > 55 || +p.hikey < 28) continue;
	sourceRegions.push({ sample: p.sample.replace(/\\/g, '/').replace(/\.wav$/, ''), low: +p.lokey, high: +p.hikey,
		velLow: +(p.lovel ?? 0), velHigh: +(p.hivel ?? 127), position: +(p.seq_position ?? 1), length: +p.seq_length });
}

describe('Smolken Pizzicato source region selection', () => {
	it('distinguishes strict recognition from whether normalization changed anything', () => {
		const p = fixture(true);
		expect(normalizeBackingBassPresetWithStatus(p)).toEqual({ recognized: true, changed: true });
		expect(normalizeBackingBassPresetWithStatus(p)).toEqual({ recognized: true, changed: false });
		p.groups[29].regions[3].pitch = 54;
		expect(normalizeBackingBassPresetWithStatus(p)).toEqual({ recognized: false, changed: false });
	});
	it('accepts the full pinned source bank and preserves all other groups exactly', () => {
		expect(createHash('sha256').update(source).digest('hex')).toBe('0aea1def56753b0dcc89914b1ac24054200bacc01dd696572745c70787eaec4f');
		const preset = fixture(true);
		const before = structuredClone(preset);
		expect(preset.groups).toHaveLength(33);
		expect(normalizeBackingBassPreset(preset)).toBe(true);
		for (const index of [0, 1, 2, 3, 4, 5, 6, 30, 31, 32]) expect(preset.groups[index]).toEqual(before.groups[index]);
		const matcher = new engine.RegionMatcher(preset);
		for (let note = 28; note <= 55; note++) for (const velocity of [0, 74, 75, 120, 121, 127]) {
			expect(matcher.match(note, velocity, new Map())).toHaveLength(1);
		}
	});
	it('selects exactly one source sample per note at every key and velocity, including complete RR cycles', () => {
		const preset = fixture();
		normalizeBackingBassPreset(preset);
		expect(preset.groups).toHaveLength(23);
		expect(sourceRegions).toHaveLength(91);
		for (let note = 28; note <= 55; note++) for (let velocity = 0; velocity <= 127; velocity++) {
			const matcher = new engine.RegionMatcher(preset);
			const candidates = sourceRegions.filter((r) => note >= r.low && note <= r.high && velocity >= r.velLow && velocity <= r.velHigh);
			expect(candidates.length).toBeGreaterThanOrEqual(3);
			for (let hit = 0; hit < candidates.length * 2; hit++) {
				const expected = candidates.find((r) => r.position === hit % r.length + 1)!;
				expect(matcher.match(note, velocity, new Map()).map((r) => r.sample), `note=${note} velocity=${velocity} hit=${hit}`).toEqual([expected.sample]);
			}
		}
	});

	it('preserves every other property, region object, and unrelated noise group, and is idempotent', () => {
		const preset = fixture();
		preset.groups.push({ regions: [{ sample: 'pizz/noises/unchanged', keyRange: [84, 84], seqPosition: 2 }], seqLength: 5 });
		const original = structuredClone(preset);
		const regions = preset.groups.map((group) => group.regions);
		const samples = preset.samples;
		expect(normalizeBackingBassPreset(preset)).toBe(true);
		for (let index = 0; index < 23; index++) {
			const expected = original.groups[index];
			const source = sourceRegions.find((region) => region.sample === expected.regions[0].sample)!;
			expected.velRange = [source.velLow, source.velHigh];
			expected.seqLength = source.length;
		}
		expect(preset).toEqual(original);
		expect(preset.samples).toBe(samples);
		preset.groups.forEach((group, index) => expect(group.regions).toBe(regions[index]));
		// Already repaired groups require no writes, even if a caller freezes them.
		preset.groups.forEach(Object.freeze);
		expect(normalizeBackingBassPreset(preset)).toBe(false);
		expect(preset).toEqual(original);
	});

	it('retains the native per-group counter behavior across changing notes and velocity bands', () => {
		const preset = fixture();
		normalizeBackingBassPreset(preset);
		const matcher = new engine.RegionMatcher(preset);
		// smplr advances every group passing its group-level filters, even when
		// its regions do not contain this key. Do not add group key ranges here.
		const notes = [[28, 50], [55, 50], [49, 50], [49, 50], [49, 90], [49, 50]];
		expect(notes.map(([note, velocity]) => matcher.match(note, velocity, new Map()).map((region) => region.sample))).toEqual([
			['pizz/pizz_g1_pa'], ['pizz/pizz_g3_pb'], ['pizz/pizz_e3_pc'], ['pizz/pizz_e3_pa'], ['pizz/pizz_e3_ma'], ['pizz/pizz_e3_pb']
		]);
	});

	it.each(['https://samples.example/bass', `${baseUrl}-other`, `${baseUrl}/other`, `${baseUrl}?preset=other`, baseUrl.replace('https:', 'http:')])(
		'leaves a foreign bank unchanged: %s', (url) => {
			const preset = fixture();
			preset.samples.baseUrl = url;
			const before = structuredClone(preset);
			expect(normalizeBackingBassPreset(preset)).toBe(false);
			expect(preset).toEqual(before);
		});

	it('accepts a trailing bank slash and does not depend on group ordering', () => {
		const preset = fixture();
		preset.samples.baseUrl += '/';
		preset.groups.reverse();
		expect(normalizeBackingBassPreset(preset)).toBe(true);
		expect(new engine.RegionMatcher(preset).match(34, 90, new Map()).map((region) => region.sample)).toEqual(['pizz/pizz_bb1_fa']);
	});

	const changes: [string, (preset: SmplrPreset) => void][] = [
		['missing group', (p) => { p.groups.pop(); }],
		['duplicate group', (p) => { p.groups.push(structuredClone(p.groups[0])); }],
		['unknown overlapping layer', (p) => { p.groups.push({ regions: [{ sample: 'unknown', keyRange: [30, 30] }] }); }],
		['changed sample', (p) => { p.groups[0].regions[0].sample += '-new'; }],
		['late signature mismatch', (p) => { p.groups[22].regions[3].sample += '-new'; }],
		['changed pitch', (p) => { p.groups[0].regions[0].pitch = 32; }],
		['changed key range', (p) => { p.groups[0].regions[0].keyRange = [28, 33]; }],
		['changed choke', (p) => { p.groups[0].regions[0].offBy = 99; }],
		['changed release', (p) => { p.groups[0].ampRelease = 0.8; }],
		['changed region position', (p) => { p.groups[0].regions[1].seqPosition = 3; }],
		['incomplete cycle', (p) => { p.groups[0].regions.pop(); }],
		['changed group key filter', (p) => { p.groups[0].keyRange = [27, 33]; }],
		['explicit conflicting RR', (p) => { p.groups[0].seqLength = 2; }],
		['explicit conflicting group dynamics', (p) => { p.groups[0].velRange = [0, 127]; }],
		['explicit conflicting region dynamics', (p) => { p.groups[0].regions[0].velRange = [0, 127]; }],
		['redirected sample asset', (p) => { p.samples.map = { [p.groups[0].regions[0].sample]: 'other-file' }; }],
		['new inherited defaults', (p) => { p.defaults = { volume: -6 }; }]
	];
	it.each(changes)('leaves an unknown bank variant entirely untouched: %s', (_name, change) => {
		const preset = fixture();
		change(preset);
		const before = structuredClone(preset);
		expect(normalizeBackingBassPreset(preset)).toBe(false);
		expect(preset).toEqual(before);
	});
});

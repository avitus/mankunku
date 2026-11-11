import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { fractionToFloat, midiToPitchClass } from '$lib/music/intervals';
import { INSTRUMENTS } from '$lib/types/instruments';
import { concertKeyToWritten } from '$lib/music/transposition';
import { PITCH_CLASSES, type Note, type PitchClass } from '$lib/types/music';
import { cases, corpus, replayTake, recorderComparisons, rhythmHoldout, writtenNoteName, type RecorderCase } from '../helpers/recorder-baseline';

// Longest common subsequence: count ordered one-to-one pitch matches even
// when a missed attack or an extra note shifts the rest of the sequence.
function orderedMatches(expected: number[], actual: number[]) {
	let previous = new Array<number>(actual.length + 1).fill(0);
	for (const pitch of expected) {
		const next = [0];
		for (const [j, played] of actual.entries()) {
			next.push(pitch === played ? previous[j] + 1 : Math.max(previous[j + 1], next[j]));
		}
		previous = next;
	}
	return previous[actual.length];
}

async function measure(take: RecorderCase) {
	const transcription = await replayTake(take);
	const comparison = recorderComparisons(take, transcription);
	const detectedKey = transcription?.detectedKey;
	const shift = detectedKey ? PITCH_CLASSES.indexOf(detectedKey) : 0;
	const actual = (transcription?.phrase.notes ?? []).flatMap(note =>
		note.pitch === null ? [] : [{ ...note, pitch: note.pitch }]
	);
	const concert = actual.map(note => note.pitch + shift);
	const reference = take.expected.map(note => note.pitch);
	const byOnset = new Map(actual.map(note => [fractionToFloat(note.offset), note]));
	// Compare rhythm a second time relative to the first note. Practice files
	// can contain a lead-in that a live recorder's scheduled entrance avoids.
	const firstActual = actual[0] ? fractionToFloat(actual[0].offset) : 0;
	const firstExpected = fractionToFloat(take.expected[0].offset);
	let relativeRhythm = 0;
	let onGrid = 0;
	let durationOnGrid = 0;
	let exactSaved = 0;
	for (const expected of take.expected) {
		const relativeOffset = fractionToFloat(expected.offset) - firstExpected;
		if (actual.some(note =>
			Math.abs(fractionToFloat(note.offset) - firstActual - relativeOffset) < 1e-8 &&
			fractionToFloat(note.duration) === fractionToFloat(expected.duration)
		)) relativeRhythm++;
		const written = byOnset.get(fractionToFloat(expected.offset));
		if (!written) continue;
		onGrid++;
		if (fractionToFloat(written.duration) !== fractionToFloat(expected.duration)) continue;
		durationOnGrid++;
		if (written.pitch === expected.pitch - PITCH_CLASSES.indexOf(take.key)) exactSaved++;
	}
	return {
		take, detectedKey,
		writtenKey: concertKeyToWritten(take.key, INSTRUMENTS[take.instrumentId]),
		writtenInferred: detectedKey && concertKeyToWritten(detectedKey, INSTRUMENTS[take.instrumentId]),
		...comparison, phaseMs: Math.round(1000 * (transcription?.phaseSeconds ?? 0)),
		editorTooLong: (transcription?.phrase.difficulty.lengthBars ?? 0) > 4,
		expected: reference.length, emitted: actual.length,
		pitchClass: orderedMatches(reference.map(midiToPitchClass), concert.map(midiToPitchClass)),
		concertMidi: orderedMatches(reference, concert), onGrid, durationOnGrid, relativeRhythm, exactSaved, actual
	};
}

it('replays one production practice window per lick through the recorder', async () => {
	expect(cases.length).toBeGreaterThan(0);
	expect(new Set(cases.map(take => take.lickId)).size).toBe(cases.length);
	const rows: Awaited<ReturnType<typeof measure>>[] = [];
	for (const take of cases) rows.push(await measure(take));

	const sum = (metric: 'expected' | 'emitted' | 'pitchClass' | 'concertMidi' | 'onGrid' | 'durationOnGrid' | 'relativeRhythm' | 'exactSaved') =>
		rows.reduce((total, row) => total + row[metric], 0);
	const ratio = (n: number, d: number) => `${n}/${d} (${d ? (100 * n / d).toFixed(1) : '0'}%)`;
	const costs = rows.map(r => r.edits.total).sort((a, b) => a - b);
	const median = (costs[Math.floor((costs.length - 1) / 2)] + costs[Math.floor(costs.length / 2)]) / 2;
	const totalEdits = costs.reduce((a, b) => a + b, 0);
	const totals = (subset: typeof rows) => {
		const total = (get: (r: typeof rows[number]) => number) => subset.reduce((sum, row) => sum + get(row), 0);
		return {
			previous: total(r => r.oldEdits.total), aligned: total(r => r.alignedEdits.total),
			current: total(r => r.edits.total), oldResizes: total(r => r.oldEdits.duration),
			resizes: total(r => r.edits.duration), oldCollisions: total(r => r.oldCollisions),
			collisions: total(r => r.collisions)
		};
	};
	expect(10 * totalEdits / sum('expected')).toBeLessThanOrEqual(2.3);
	const priorTotal = rows.reduce((sum, row) => sum + row.priorEdits.total, 0);
	const keyOnlyTotal = rows.reduce((sum, row) => sum + row.keyOnlyEdits.total, 0);
	expect(priorTotal).toBe(24);
	expect(keyOnlyTotal).toBeLessThan(priorTotal);
	const lastTotal = rows.reduce((sum, row) => sum + row.lastEdits.total, 0);
	expect(lastTotal).toBe(16);
	expect(totalEdits).toBeLessThan(lastTotal);
	const find = (name: string) => rows.find(row => row.take.name === name)!;
	expect(find('Sonny Stitt - Indiana').edits.total).toBe(0);
	expect(find('Sharp 9 Flat 9 Dom').edits).toMatchObject({ insert: 0, duration: 0 });
	expect(find('Basis of Everything').edits.remove).toBe(0);
	const all = totals(rows);
	expect(all.resizes).toBeLessThanOrEqual(all.oldResizes / 2);
	const reserved = rows.filter(r => rhythmHoldout.has(r.take.lickId));
	expect(reserved).toHaveLength(4);
	const validation = totals(reserved);
	expect(validation.current).toBeLessThan(validation.previous);
	expect(all.collisions).toBeLessThanOrEqual(all.oldCollisions);
	// Both opening triplet groups have three pitched attacks; preserve
	// their correct notated positions independent of the following phrase.
	const firstOffsets = (id: string) => reserved.find(r => r.take.lickId === id)!
		.actual.slice(0, 3).map(note => note.offset);
	expect(firstOffsets('user-1777416884800-8khg')).toEqual([[3, 4], [5, 6], [11, 12]]);
	expect(firstOffsets('user-1775775003144-sc5m')).toEqual([[0, 1], [1, 12], [1, 6]]);

	const report = [
		'# Lick recorder baseline',
		'',
		'## Estimated editing effort',
		'',
		`- ${totalEdits} logical corrections across ${sum('expected')} reference notes (${(10 * totalEdits / sum('expected')).toFixed(1)} edits per 10 notes).`,
		`- Median: ${median} edits per lick. Ready as recorded: ${costs.filter(cost => cost === 0).length}/${costs.length}.`,
		'',
		'| Lick | Total edits | Whole-line shift (semitones) | Repitch | Resize | Insert | Remove |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
		...rows.map(({ take, edits }) => `| ${take.name} | ${edits.total} | ${edits.shift || '—'} | ${edits.pitch} | ${edits.duration} | ${edits.insert} | ${edits.remove} |`),
		'',
		`Drafts exceeding the recorder editor’s four-bar limit: ${rows.filter(r => r.editorTooLong).map(r => r.take.name).join(', ') || 'none'}.`,
		'',
		'## Comparing recorder versions',
		'',
		`With the previous acoustic recorder, these takes need ${priorTotal} edits. Updating just the tonic guess gives ${keyOnlyTotal}. Adding octave evidence gives ${lastTotal}. Recovering short passing notes and joining sustained endings gives ${totalEdits}. The comparison page uses the ${lastTotal}-edit recorder as its previous version.`,
		'',
		'Previous is the first phrase-level release (59 edits). Clock only is the older beat-local quantizer given that release’s clock offset. Current also considers acoustic support for each boundary. A grid collision and an optional acoustic boundary are counted separately.',
		'',
		`Of ${sum('expected')} reference notes, the original beat-local algorithm required ${rows.reduce((n, r) => n + r.legacyEdits.total, 0)} edits. Current automatic recognition omits ${rows.reduce((n, r) => n + r.omissions, 0)} acoustically uncertain boundaries. With the correct written key supplied separately, ${rows.reduce((n, r) => n + r.withKey.total, 0)} edits remain before charging for key selection. This last number uses user input and is excluded from the automatic result.`,
		'',
		'| Set | Previous edits | Clock only | Current edits | Previous resizes | Current resizes | Previous collisions | Current collisions |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...[
			{ name: 'Development', subset: rows.filter(r => !rhythmHoldout.has(r.take.lickId)) },
			{ name: 'Reserved licks', subset: reserved }, { name: 'All', subset: rows }
		].map(({ name, subset }) => `| ${name} | ${Object.values(totals(subset)).join(' | ')} |`),
		'',
		'| Lick | Reserved | Previous edits | Clock only | Current edits | Clock offset (ms) | Collisions before → after |',
		'| --- | --- | ---: | ---: | ---: | ---: | --- |',
		...rows.map(r => `| ${r.take.name} | ${rhythmHoldout.has(r.take.lickId) ? 'Yes' : ''} | ${r.oldEdits.total} | ${r.alignedEdits.total} | ${r.edits.total} | ${r.phaseMs} | ${r.oldCollisions} → ${r.collisions} |`),
		'',
		'## Note agreement',
		'',
		`- In-order pitch-class recall: ${ratio(sum('pitchClass'), sum('expected'))}.`,
		`- In-order pitch-class precision: ${ratio(sum('pitchClass'), sum('emitted'))}.`,
		`- In-order pitch recall, including octave: ${ratio(sum('concertMidi'), sum('expected'))}.`,
		`- Notated onset present: ${ratio(sum('onGrid'), sum('expected'))}.`,
		`- Notated onset and duration present: ${ratio(sum('durationOnGrid'), sum('expected'))}.`,
		`- Onset and duration relative to the first note: ${ratio(sum('relativeRhythm'), sum('expected'))}.`,
		`- Inferred key equals practice key: ${ratio(rows.filter(r => r.take.key === r.detectedKey).length, rows.length)}.`,
		`- Saved notes matching normalized MIDI, onset and duration: ${ratio(sum('exactSaved'), sum('expected'))}.`,
		'',
		'| Take | Best archived practice score | BPM | Written practice → inferred key | Expected | Emitted | Pitch class | MIDI | Onset | Onset + duration | Relative rhythm | Exact saved |',
		'| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...rows.map(r => `| [${r.take.name}](${r.take.file}) | ${(r.take.practiceScore * 100).toFixed(2)}% | ${r.take.tempo} | ${r.writtenKey} → ${r.writtenInferred ?? '∅'} | ${r.expected} | ${r.emitted} | ${r.pitchClass} | ${r.concertMidi} | ${r.onGrid} | ${r.durationOnGrid} | ${r.relativeRhythm} | ${r.exactSaved} |`),
		'',
		'## Note-level comparison',
		'',
		'Each note shows its written instrument pitch, offset, and duration. Both fractions use whole notes. The two lines are shown as played.',
		'',
		...rows.flatMap(({ take, actual, detectedKey }) => {
			const concertShift = detectedKey ? PITCH_CLASSES.indexOf(detectedKey) : 0;
			const format = (note: Note & { pitch: number }, shift: number, key: PitchClass) =>
				`${writtenNoteName(note.pitch + shift, key, take.instrumentId)}@${note.offset.join('/')} (${note.duration.join('/')})`;
			return [
				`### ${take.name}`, '',
				`- Reference: ${take.expected.map(note => format(note, 0, take.key)).join(', ')}`,
				`- Replay: ${actual.map(note => format(note, concertShift, detectedKey ?? 'C')).join(', ') || 'No notes'}`, ''
			];
		})
	].join('\n');
	await expect(report).toMatchFileSnapshot(fileURLToPath(new URL('baseline.md', corpus)));
}, 120_000);

it('keeps tongued final notes when the reed has already recovered by the reported attack time', async () => {
	const cases = [
		['2026-09-18-blues-curl-up', 100, 61], ['2026-06-24-blues-curl-up', 100, 65],
		['2026-08-01-flat-five-chromatic-down', 105, 63],
	] as const;
	for (const [file, tempo, pitch] of cases) {
		const take = await replayTake({ file: `../recordings/${file}.wav`, tempo });
		const tail = take?.performedNotes.filter(n => n.pitch !== null).slice(-2);
		expect(tail?.map(n => n.pitch), file).toEqual([pitch, pitch]);
	}
});

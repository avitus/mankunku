/** Rescore every saved take (production rows + Firefox takes) under each variant → results/ts_variants.csv */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import { scoreVariant, VARIANTS } from './variants';

const ROOT = join(process.cwd(), 'research/audio-scoring');

interface Saved { noteResults: { expected: Note; detected: DetectedNote | null; extra: boolean; missed: boolean }[]; overall: number }

function fromNoteResults(s: Saved): { expected: Note[]; detected: DetectedNote[] } {
	const expected = s.noteResults.filter((r) => !r.extra).map((r) => r.expected);
	const detected = s.noteResults.filter((r) => r.detected).map((r) => r.detected!).sort((a, b) => a.onsetTime - b.onsetTime);
	return { expected, detected };
}

describe('scorer variants over every saved take', () => {
	it('writes results/ts_variants.csv', () => {
		const rows: string[] = ['set,take,source,tempo,swing,oi,saved,' + Object.keys(VARIANTS).flatMap((v) => [`${v}_overall`, `${v}_charged`, `${v}_hits`, `${v}_wrong`]).join(',')];
		const prod = JSON.parse(readFileSync(join(ROOT, 'takes/prod/raw/session_results.json'), 'utf8')).rows as any[];
		let maxRepro = 0;
		const add = (set: string, id: string, source: string, tempo: number, swing: number, oi: boolean, saved: Saved) => {
			const { expected, detected } = fromNoteResults(saved);
			if (expected.length === 0) return;
			const cells = [set, id, source, tempo, swing, oi ? 1 : 0, saved.overall > 1 ? saved.overall / 100 : saved.overall];
			for (const [name, opts] of Object.entries(VARIANTS)) {
				const r = scoreVariant(expected, detected, tempo, swing, oi, opts);
				if (name === 'current') maxRepro = Math.max(maxRepro, Math.abs(r.overall - (saved.overall > 1 ? saved.overall / 100 : saved.overall)));
				cells.push(r.overall.toFixed(4), r.charged, r.notesHit, r.wrongPairs);
			}
			rows.push(cells.join(','));
		};
		for (const r of prod) add('prod', r.id, r.source ?? 'ear-training', r.tempo, 0.6, false, { noteResults: r.note_results, overall: r.overall });
		const ffDir = join(ROOT, 'takes/firefox');
		for (const f of readdirSync(ffDir).filter((f) => f.endsWith('.json')).sort()) {
			const d = JSON.parse(readFileSync(join(ffDir, f), 'utf8'));
			const s = d.scoring?.savedScore; if (!s?.noteResults?.length) continue;
			add('firefox', f.slice(0, -5), d.context.source, d.context.tempo, d.context.swing ?? 0.6, d.context.source === 'lick-practice', s);
		}
		writeFileSync(join(ROOT, 'results/ts_variants.csv'), rows.join('\n') + '\n');
		console.log(`rows: ${rows.length - 1}; max |current − saved| = ${maxRepro.toExponential(2)}`);
		expect(rows.length).toBeGreaterThan(2000);
	}, 600_000);
});

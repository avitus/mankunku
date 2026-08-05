import { describe, it, expect } from 'vitest';
import {
	COMP_FIGURES,
	compFigureById,
	planCompFigures,
	hitsForPlannedBar
} from '$lib/audio/backing-comp-figures';
import { buildBarInfos, generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';

const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
const infos = buildBarInfos(aaba.bars, aaba.phrase.sectionMap);

describe('figure library', () => {
	it('keeps every hit on the eighth grid (the anticipation convention)', () => {
		for (const f of COMP_FIGURES) {
			for (const barHits of f.hits) {
				for (const h of barHits) {
					expect((h.b * 2) % 1, `${f.id} hit at ${h.b}`).toBe(0);
					expect(h.b).toBeGreaterThanOrEqual(0);
					expect(h.b).toBeLessThan(4);
					expect(h.d).toBeGreaterThan(0);
				}
			}
		}
	});

	it('has unique ids and per-figure bar counts matching their hit lists', () => {
		const ids = COMP_FIGURES.map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const f of COMP_FIGURES) expect(f.hits.length).toBe(f.bars);
	});
});

describe('planCompFigures', () => {
	const seeds = [0, 1, 2, 3, 4, 5];

	it('never deals the same figure three bars running and nothing dominates', () => {
		for (const seed of seeds) {
			const plan = planCompFigures(infos, 4, `comp-probe#${seed}`, 160);
			expect(plan).toHaveLength(infos.length);
			const sounding: string[] = [];
			for (let bar = 0; bar < plan.length; bar++) {
				const id = plan[bar].figureId === 'cont' ? plan[bar - 1].figureId : plan[bar].figureId;
				sounding.push(id as string);
			}
			for (let i = 2; i < sounding.length; i++) {
				// A 2-bar figure legitimately covers two bars; three CHOICES in
				// a row of the same 1-bar figure are what the memory forbids.
				const distinctChoices = plan
					.slice(Math.max(0, i - 2), i + 1)
					.filter((b) => b.figureId !== 'cont')
					.map((b) => b.figureId);
				if (distinctChoices.length === 3) {
					expect(new Set(distinctChoices).size, `bars ${i - 2}–${i} (seed ${seed})`).toBeGreaterThan(1);
				}
			}
			const counts = new Map<string, number>();
			for (const id of sounding) counts.set(id, (counts.get(id) ?? 0) + 1);
			for (const [id, count] of counts) {
				expect(count / sounding.length, `${id} dominates (seed ${seed})`).toBeLessThan(0.4);
			}
		}
	});

	it('opens the phrase with an early figure and strips final-bar pushes', () => {
		for (const seed of seeds) {
			const plan = planCompFigures(infos, 4, `comp-probe#${seed}`, 160);
			const first = compFigureById(plan[0].figureId as string)!;
			expect(first.tags).toContain('early');

			const lastIdx = infos.length - 1;
			const hits = hitsForPlannedBar(plan[lastIdx], plan, lastIdx, infos[lastIdx], 4);
			for (const h of hits) expect(h.b).toBeLessThan(3.5);
		}
	});

	it('keeps 2-bar figures inside one section', () => {
		for (const seed of seeds) {
			const plan = planCompFigures(infos, 4, `comp-probe#${seed}`, 160);
			for (let bar = 0; bar < plan.length; bar++) {
				if (plan[bar].figureId === 'cont') {
					expect(infos[bar].sectionIndex).toBe(infos[bar - 1].sectionIndex);
				}
			}
		}
	});

	it('is deterministic', () => {
		const a = planCompFigures(infos, 4, 'comp-probe#0', 160);
		const b = planCompFigures(infos, 4, 'comp-probe#0', 160);
		expect(a).toEqual(b);
	});
});

describe('planned comp end-to-end', () => {
	it('guide-tone bars voice exactly two notes', () => {
		// Search seeds until a guide-tone bar appears (p≈0.06/bar over 96 bars
		// makes the first seed near-certain; the loop guards the property).
		let found = false;
		for (let seed = 0; seed < 5 && !found; seed++) {
			const phraseId = `${aaba.phrase.id}#g${seed}`;
			const plan = planCompFigures(infos, 4, phraseId, 160);
			const guideBars = plan
				.map((b, i) => (b.guideTones ? i : -1))
				.filter((i) => i >= 0);
			if (guideBars.length === 0) continue;
			found = true;
			const { compEvents } = generateBacking(aaba.phrase.harmony, BACKING_STYLES.swing, {
				phraseId,
				tempo: 160,
				ppq: 192,
				beatsPerBar: 4,
				swing: 0.733,
				sectionMap: aaba.phrase.sectionMap
			});
			for (const bar of guideBars) {
				const inBar = compEvents.filter((e) => Math.floor(e.absBeat / 4) === bar);
				for (const e of inBar) {
					expect(e.notes.length, `guide-tone bar ${bar}`).toBeLessThanOrEqual(2);
				}
			}
		}
		expect(found).toBe(true);
	});

	it('cadence bars carry pushes markedly more often than ordinary bars', () => {
		let cadencePush = 0;
		let cadenceBars = 0;
		let ordinaryPush = 0;
		let ordinaryBars = 0;
		for (let seed = 0; seed < 8; seed++) {
			const plan = planCompFigures(infos, 4, `cad-probe#${seed}`, 160);
			for (let bar = 0; bar < plan.length; bar++) {
				const id = plan[bar].figureId === 'cont' ? plan[bar - 1].figureId : plan[bar].figureId;
				const fig = compFigureById(id as string);
				const isPush = fig?.tags.includes('push') ?? false;
				if (infos[bar].isSectionFinalBar && !infos[bar].isFinalBar) {
					cadenceBars++;
					if (isPush) cadencePush++;
				} else {
					ordinaryBars++;
					if (isPush) ordinaryPush++;
				}
			}
		}
		expect(cadencePush / cadenceBars).toBeGreaterThan((ordinaryPush / ordinaryBars) * 1.5);
	});
});
